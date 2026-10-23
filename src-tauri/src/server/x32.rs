use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use futures_util::future::join_all;
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    net::UdpSocket,
    sync::{oneshot, Mutex},
    task::JoinHandle,
};

use super::{ws::WsHub, ServerState};

const DEFAULT_X32_IP: &str = "192.168.180.198";
const X32_OSC_PORT: u16 = 10023;
const FULL_STRIP_SCOPE_MASK: i32 = 63;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetSlotInfo {
    pub hasdata: bool,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonOscArg {
    #[serde(rename = "type")]
    pub arg_type: String,
    pub value: Value,
}

fn json_arg_to_rosc(arg: &JsonOscArg) -> Option<OscType> {
    match arg.arg_type.as_str() {
        "i" => {
            let v = arg
                .value
                .as_i64()
                .or_else(|| arg.value.as_f64().map(|f| f as i64))
                .or_else(|| arg.value.as_str().and_then(|s| s.parse::<i64>().ok()))
                .unwrap_or(0) as i32;
            Some(OscType::Int(v))
        }
        "f" => {
            let v = arg
                .value
                .as_f64()
                .or_else(|| arg.value.as_i64().map(|i| i as f64))
                .or_else(|| arg.value.as_str().and_then(|s| s.parse::<f64>().ok()))
                .unwrap_or(0.0) as f32;
            Some(OscType::Float(v))
        }
        "s" => {
            let s = match &arg.value {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            };
            Some(OscType::String(s))
        }
        "b" => {
            let bytes = if let Some(arr) = arg.value.as_array() {
                arr.iter()
                    .filter_map(|v| v.as_u64().map(|b| b as u8))
                    .collect()
            } else if let Some(s) = arg.value.as_str() {
                s.as_bytes().to_vec()
            } else {
                Vec::new()
            };
            Some(OscType::Blob(bytes))
        }
        _ => None,
    }
}

fn parse_safe_arg(raw: &Value) -> Option<JsonOscArg> {
    let obj = raw.as_object()?;
    let t = obj
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(t.as_str(), "i" | "f" | "s" | "b") {
        return None;
    }
    let val = obj.get("value").cloned().unwrap_or(Value::Null);
    Some(JsonOscArg {
        arg_type: t,
        value: val,
    })
}

async fn send_osc_to_x32(
    x32_ip: &str,
    messages: &[(String, Vec<OscType>)],
) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Kon UDP socket niet openen: {}", e))?;

    let target = format!("{}:{}", x32_ip, X32_OSC_PORT);

    for (addr, args) in messages {
        let packet = OscPacket::Message(OscMessage {
            addr: addr.clone(),
            args: args.clone(),
        });
        let buf = encoder::encode(&packet).map_err(|e| format!("OSC encode fout: {}", e))?;
        socket
            .send_to(&buf, &target)
            .await
            .map_err(|e| format!("OSC send fout naar {}: {}", target, e))?;
    }

    tokio::time::sleep(Duration::from_millis(50)).await;
    Ok(())
}

fn resolve_target_ip(ip_val: Option<&Value>) -> String {
    if let Some(Value::String(s)) = ip_val {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    DEFAULT_X32_IP.to_string()
}

fn parse_valid_int(val: Option<&Value>, min: i64, max: i64) -> Option<i32> {
    let v = val?;
    let n = match v {
        Value::Number(num) => {
            if let Some(i) = num.as_i64() {
                i
            } else if let Some(f) = num.as_f64() {
                if f.fract() == 0.0 {
                    f as i64
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            trimmed.parse::<i64>().ok()?
        }
        _ => return None,
    };

    if n >= min && n <= max {
        Some(n as i32)
    } else {
        None
    }
}

// ── X32 Persistent Session ─────────────────────────────────────────────

pub struct X32Session {
    pub ip: String,
    pub connected: AtomicBool,
    pub poll_in_progress: AtomicBool,
    pub socket: Arc<UdpSocket>,
    pub presets: Arc<Mutex<BTreeMap<String, PresetSlotInfo>>>,
    pub last_polled: Arc<Mutex<Option<String>>>,
    pub connection_error: Arc<Mutex<Option<String>>>,
    pub console_name: Arc<Mutex<Option<String>>>,
    pub console_model: Arc<Mutex<Option<String>>>,
    pub firmware_version: Arc<Mutex<Option<String>>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Vec<OscType>>>>>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    ws_hub: WsHub,
}

impl X32Session {
    pub async fn connect(ip: String, ws_hub: WsHub) -> Result<Arc<Self>, String> {
        let socket = UdpSocket::bind("0.0.0.0:0")
            .await
            .map_err(|e| format!("Kon UDP socket niet openen: {}", e))?;
        let socket = Arc::new(socket);

        let session = Arc::new(Self {
            ip: ip.clone(),
            connected: AtomicBool::new(true),
            poll_in_progress: AtomicBool::new(false),
            socket: socket.clone(),
            presets: Arc::new(Mutex::new(BTreeMap::new())),
            last_polled: Arc::new(Mutex::new(None)),
            connection_error: Arc::new(Mutex::new(None)),
            console_name: Arc::new(Mutex::new(None)),
            console_model: Arc::new(Mutex::new(None)),
            firmware_version: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            tasks: Mutex::new(Vec::new()),
            ws_hub: ws_hub.clone(),
        });

        // 1. Spawn background UDP receiver task FIRST so it catches responses immediately
        let recv_session = session.clone();
        let recv_task = tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            while recv_session.connected.load(Ordering::Relaxed) {
                match recv_session.socket.recv_from(&mut buf).await {
                    Ok((len, _addr)) => {
                        if let Ok((_, packet)) = rosc::decoder::decode_udp(&buf[..len]) {
                            recv_session.handle_packet(packet).await;
                        }
                    }
                    Err(err) => {
                        // On Windows, ICMP port unreachable generates WSAECONNRESET (10054).
                        // In UDP, we must NEVER terminate the receive loop on connection reset!
                        let is_reset = err.kind() == std::io::ErrorKind::ConnectionReset
                            || err.raw_os_error() == Some(10054);
                        if is_reset {
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            continue;
                        }
                        if recv_session.connected.load(Ordering::Relaxed) {
                            eprintln!("  [X32 SESSION] UDP recv error: {}", err);
                            let mut err_lock = recv_session.connection_error.lock().await;
                            *err_lock = Some(err.to_string());
                            tokio::time::sleep(Duration::from_millis(100)).await;
                            continue;
                        }
                        break;
                    }
                }
            }
        });

        // 2. Perform connection handshake with /xremote and /xinfo
        let mut handshake_ok = false;
        for attempt in 1..=2 {
            let _ = session.send_osc("/xremote", Vec::new()).await;
            match session.query_osc("/xinfo".to_string(), 1500).await {
                Ok(args) => {
                    handshake_ok = true;
                    if let Some(OscType::String(s)) = args.get(1) {
                        *session.console_name.lock().await = Some(s.clone());
                    }
                    if let Some(OscType::String(s)) = args.get(2) {
                        *session.console_model.lock().await = Some(s.clone());
                    }
                    if let Some(OscType::String(s)) = args.get(3) {
                        *session.firmware_version.lock().await = Some(s.clone());
                    }
                    break;
                }
                Err(_) => {
                    println!("  [X32 SESSION] /xinfo attempt {}/2 on {} timed out", attempt, ip);
                }
            }
        }

        if !handshake_ok {
            session.connected.store(false, Ordering::SeqCst);
            recv_task.abort();
            return Err(format!(
                "Geen reactie van X32 mixer op {}:10023. Controleer of de mixer aan staat, op hetzelfde netwerk zit en het IP-adres ({}) klopt.",
                ip, ip
            ));
        }

        println!("  [X32 SESSION] Connected to {}:{}", ip, X32_OSC_PORT);

        // 3. Background /xremote heartbeat task (every 1500ms)
        let hb_session = session.clone();
        let hb_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(1500));
            loop {
                interval.tick().await;
                if !hb_session.connected.load(Ordering::Relaxed) {
                    break;
                }
                let _ = hb_session.send_osc("/xremote", Vec::new()).await;
            }
        });

        {
            let mut tasks = session.tasks.lock().await;
            tasks.push(recv_task);
            tasks.push(hb_task);
        }

        let status = session.get_status().await;
        ws_hub.broadcast("x32:status", status);

        Ok(session)
    }

    pub async fn send_osc(&self, address: &str, args: Vec<OscType>) -> Result<(), String> {
        let packet = OscPacket::Message(OscMessage {
            addr: address.to_string(),
            args,
        });
        let buf = encoder::encode(&packet).map_err(|e| e.to_string())?;
        let target = format!("{}:{}", self.ip, X32_OSC_PORT);
        self.socket
            .send_to(&buf, &target)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn handle_packet(&self, packet: OscPacket) {
        match packet {
            OscPacket::Message(msg) => {
                self.handle_message(msg).await;
            }
            OscPacket::Bundle(bundle) => {
                for p in bundle.content {
                    Box::pin(self.handle_packet(p)).await;
                }
            }
        }
    }

    async fn handle_message(&self, msg: OscMessage) {
        let addr = msg.addr;
        let args = msg.args;

        // 1. Resolve pending query indien aanwezig
        {
            let mut pending = self.pending.lock().await;
            if let Some(tx) = pending.remove(&addr) {
                let _ = tx.send(args.clone());
            }
        }

        if addr == "/xinfo" {
            if let Some(OscType::String(s)) = args.get(1) {
                *self.console_name.lock().await = Some(s.clone());
            }
            if let Some(OscType::String(s)) = args.get(2) {
                *self.console_model.lock().await = Some(s.clone());
            }
            if let Some(OscType::String(s)) = args.get(3) {
                *self.firmware_version.lock().await = Some(s.clone());
            }
        }

        // 2. Check /-libs/ch/<slot>/(hasdata|name)
        if let Some(rest) = addr.strip_prefix("/-libs/ch/") {
            let parts: Vec<&str> = rest.split('/').collect();
            if parts.len() == 2 && parts[0].len() == 3 && parts[0].chars().all(|c| c.is_ascii_digit()) {
                let slot = parts[0].to_string();
                let field = parts[1];
                let mut presets = self.presets.lock().await;
                let entry = presets.entry(slot).or_insert(PresetSlotInfo {
                    hasdata: false,
                    name: String::new(),
                    error: None,
                });
                if field == "hasdata" {
                    entry.hasdata = matches!(args.first(), Some(OscType::Int(1)));
                } else if field == "name" {
                    if let Some(OscType::String(s)) = args.first() {
                        entry.name = s.clone();
                    }
                }
            }
        }
    }

    async fn query_osc(&self, address: String, timeout_ms: u64) -> Result<Vec<OscType>, String> {
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(address.clone(), tx);
        }

        if let Err(err) = self.send_osc(&address, Vec::new()).await {
            let mut pending = self.pending.lock().await;
            pending.remove(&address);
            return Err(err);
        }

        match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(args)) => Ok(args),
            Ok(Err(_)) => Err("Session disconnected".to_string()),
            Err(_) => {
                let mut pending = self.pending.lock().await;
                pending.remove(&address);
                Err(format!("Timeout for \"{}\"", address))
            }
        }
    }

    pub async fn poll_library(self: &Arc<Self>, library: &str) -> Result<Value, String> {
        if self
            .poll_in_progress
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("A poll is already in progress".to_string());
        }

        let slots: Vec<String> = (1..=100).map(|i| format!("{:03}", i)).collect();
        let mut results = BTreeMap::new();
        let concurrency = 10;
        let timeout_ms = 800;
        let mut timeouts_count = 0;

        for chunk in slots.chunks(concurrency) {
            let mut futures = Vec::with_capacity(chunk.len());
            for slot in chunk {
                let slot_str = slot.clone();
                let lib_str = library.to_string();
                let session = self.clone();
                futures.push(async move {
                    let hasdata_addr = format!("/-libs/{}/{}/hasdata", lib_str, slot_str);
                    match session.query_osc(hasdata_addr, timeout_ms).await {
                        Ok(resp) => {
                            let has_data = matches!(resp.first(), Some(OscType::Int(1)));
                            let mut name = String::new();
                            if has_data {
                                let name_addr = format!("/-libs/{}/{}/name", lib_str, slot_str);
                                if let Ok(name_resp) = session.query_osc(name_addr, timeout_ms).await {
                                    if let Some(OscType::String(s)) = name_resp.first() {
                                        name = s.clone();
                                    }
                                }
                            }
                            (
                                slot_str,
                                PresetSlotInfo {
                                    hasdata: has_data,
                                    name,
                                    error: None,
                                },
                            )
                        }
                        Err(err) => (
                            slot_str,
                            PresetSlotInfo {
                                hasdata: false,
                                name: String::new(),
                                error: Some(err),
                            },
                        ),
                    }
                });
            }

            let batch_results = join_all(futures).await;
            for (slot, info) in batch_results {
                if info.error.is_some() {
                    timeouts_count += 1;
                }
                results.insert(slot, info);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        if timeouts_count == 100 {
            self.poll_in_progress.store(false, Ordering::SeqCst);
            return Err("Mixer reageert niet meer tijdens het pollen van de library (alle 100 slots gaven een timeout).".to_string());
        }

        let now_iso = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let occupied = results.values().filter(|r| r.hasdata).count();

        {
            let mut presets = self.presets.lock().await;
            *presets = results.clone();
        }
        {
            let mut last = self.last_polled.lock().await;
            *last = Some(now_iso.clone());
        }
        self.poll_in_progress.store(false, Ordering::SeqCst);

        println!(
            "  [X32 SESSION] Polled {} library: {}/100 slots occupied",
            library, occupied
        );

        let presets_payload = self.get_presets().await;
        self.ws_hub.broadcast("x32:presets", presets_payload);

        Ok(json!({
            "presets": results,
            "occupied": occupied,
            "total": 100,
            "lastPolled": now_iso,
        }))
    }

    pub async fn disconnect(&self) {
        self.connected.store(false, Ordering::SeqCst);
        self.poll_in_progress.store(false, Ordering::SeqCst);

        {
            let mut tasks = self.tasks.lock().await;
            for t in tasks.drain(..) {
                t.abort();
            }
        }
        {
            let mut pending = self.pending.lock().await;
            pending.clear();
        }
        {
            let mut presets = self.presets.lock().await;
            presets.clear();
        }
        {
            let mut last = self.last_polled.lock().await;
            *last = None;
        }
        *self.console_name.lock().await = None;
        *self.console_model.lock().await = None;
        *self.firmware_version.lock().await = None;

        println!("  [X32 SESSION] Disconnected from {}", self.ip);
        let status = self.get_status().await;
        self.ws_hub.broadcast("x32:status", status);
    }

    pub async fn get_status(&self) -> Value {
        let occupied = {
            let presets = self.presets.lock().await;
            presets.values().filter(|r| r.hasdata).count()
        };
        let last_polled = self.last_polled.lock().await.clone();
        let connection_error = self.connection_error.lock().await.clone();
        let console_name = self.console_name.lock().await.clone();
        let console_model = self.console_model.lock().await.clone();
        let firmware = self.firmware_version.lock().await.clone();

        json!({
            "connected": self.connected.load(Ordering::Relaxed),
            "ip": self.ip,
            "connectionError": connection_error,
            "lastPolled": last_polled,
            "pollInProgress": self.poll_in_progress.load(Ordering::Relaxed),
            "occupiedSlots": occupied,
            "totalSlots": 100,
            "consoleName": console_name,
            "model": console_model,
            "firmware": firmware,
        })
    }

    pub async fn get_presets(&self) -> Value {
        let presets = self.presets.lock().await.clone();
        let occupied = presets.values().filter(|r| r.hasdata).count();
        let last_polled = self.last_polled.lock().await.clone();

        json!({
            "presets": presets,
            "occupied": occupied,
            "total": 100,
            "lastPolled": last_polled,
        })
    }
}

#[derive(Clone)]
pub struct X32Manager {
    active_session: Arc<Mutex<Option<Arc<X32Session>>>>,
}

impl X32Manager {
    pub fn new() -> Self {
        Self {
            active_session: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn get_or_create_session(
        &self,
        ip: &str,
        ws_hub: WsHub,
    ) -> Result<Arc<X32Session>, String> {
        let target_ip = if ip.trim().is_empty() {
            DEFAULT_X32_IP.to_string()
        } else {
            ip.trim().to_string()
        };

        let mut lock = self.active_session.lock().await;
        if let Some(existing) = lock.as_ref() {
            if existing.connected.load(Ordering::Relaxed) && existing.ip == target_ip {
                return Ok(existing.clone());
            }
            existing.disconnect().await;
            *lock = None;
        }

        let session = X32Session::connect(target_ip, ws_hub).await?;
        *lock = Some(session.clone());
        Ok(session)
    }

    pub async fn disconnect(&self) {
        let mut lock = self.active_session.lock().await;
        if let Some(existing) = lock.take() {
            existing.disconnect().await;
        }
    }

    pub async fn get_active_session(&self) -> Option<Arc<X32Session>> {
        let lock = self.active_session.lock().await;
        if let Some(s) = lock.as_ref() {
            if s.connected.load(Ordering::Relaxed) {
                return Some(s.clone());
            }
        }
        None
    }
}

// ── Axum Route Handlers ────────────────────────────────────────────────

/// `GET /api/x32/health`
pub async fn x32_health_handler() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "oscTarget": {
            "host": DEFAULT_X32_IP,
            "port": X32_OSC_PORT,
        },
        "timestamp": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

/// `GET /api/x32/osc-info`
pub async fn x32_osc_info_handler() -> impl IntoResponse {
    Json(json!({
        "address": "/load",
        "typeTags": "siii",
        "argSchema": [
            { "index": 0, "type": "s", "role": "type_tag", "values": ["libchan"] },
            { "index": 1, "type": "i", "role": "library_slot", "min": 0, "max": 99 },
            { "index": 2, "type": "i", "role": "channel_input", "min": 0, "max": 31 },
            { "index": 3, "type": "i", "role": "scope_mask", "value": FULL_STRIP_SCOPE_MASK },
        ],
        "oscPort": X32_OSC_PORT,
        "defaultIp": DEFAULT_X32_IP,
    }))
}

/// `POST /api/x32/load-channel-preset`
pub async fn x32_load_channel_preset_handler(
    Json(body): Json<Value>,
) -> Response {
    let target_ip = resolve_target_ip(body.get("ip"));

    let channel = match parse_valid_int(body.get("channel"), 1, 32) {
        Some(c) => c,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig kanaal. Verwacht 1..32." })),
            )
                .into_response();
        }
    };

    let preset_slot = match parse_valid_int(body.get("slot"), 0, 99) {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig preset-slot. Verwacht geheel getal 0..99." })),
            )
                .into_response();
        }
    };

    let osc_target_channel = channel - 1;
    let rosc_args = vec![
        OscType::String("libchan".to_string()),
        OscType::Int(preset_slot),
        OscType::Int(osc_target_channel),
        OscType::Int(FULL_STRIP_SCOPE_MASK),
    ];

    let fired_json = json!([
        {
            "address": "/load",
            "args": [
                { "type": "s", "value": "libchan" },
                { "type": "i", "value": preset_slot },
                { "type": "i", "value": osc_target_channel },
                { "type": "i", "value": FULL_STRIP_SCOPE_MASK },
            ]
        }
    ]);

    match send_osc_to_x32(&target_ip, &[("/load".to_string(), rosc_args)]).await {
        Ok(()) => Json(json!({
            "ok": true,
            "x32": format!("{}:{}", target_ip, X32_OSC_PORT),
            "fired": fired_json,
        }))
        .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err })),
        )
            .into_response(),
    }
}

/// `POST /api/x32/send`
pub async fn x32_send_handler(Json(body): Json<Value>) -> Response {
    let target_ip = resolve_target_ip(body.get("ip"));

    let address = match body.get("address").and_then(|v| v.as_str()) {
        Some(addr) if addr.starts_with('/') => addr.to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig OSC-adres. Moet beginnen met \"/\"." })),
            )
                .into_response();
        }
    };

    let raw_args = match body.get("args") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(arr)) => arr.clone(),
        Some(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "args moet een array zijn, of weggelaten." })),
            )
                .into_response();
        }
    };

    let mut fired_args = Vec::with_capacity(raw_args.len());
    let mut rosc_args = Vec::new();

    for a in &raw_args {
        if let Some(safe) = parse_safe_arg(a) {
            if let Some(r_arg) = json_arg_to_rosc(&safe) {
                rosc_args.push(r_arg);
            }
            fired_args.push(json!({
                "type": safe.arg_type,
                "value": safe.value,
            }));
        } else {
            fired_args.push(Value::Null);
        }
    }

    match send_osc_to_x32(&target_ip, &[(address.clone(), rosc_args)]).await {
        Ok(()) => Json(json!({
            "ok": true,
            "x32": format!("{}:{}", target_ip, X32_OSC_PORT),
            "fired": {
                "address": address,
                "args": fired_args,
            }
        }))
        .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err })),
        )
            .into_response(),
    }
}

/// `POST /api/x32/session/send`
pub async fn x32_session_send_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let session = match state.x32_manager.get_active_session().await {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Geen actieve X32 sessie — klik eerst Connect." })),
            )
                .into_response();
        }
    };

    let raw_messages = match body.get("messages").and_then(|v| v.as_array()) {
        Some(arr) if !arr.is_empty() => arr,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "messages moet een niet-lege array zijn." })),
            )
                .into_response();
        }
    };

    let mut safe_messages: Vec<(String, Vec<OscType>)> = Vec::new();
    for m in raw_messages {
        let Some(obj) = m.as_object() else { continue };
        let Some(addr) = obj.get("address").and_then(|v| v.as_str()) else { continue };
        let mut rosc_args = Vec::new();
        if let Some(arr) = obj.get("args").and_then(|v| v.as_array()) {
            for a in arr {
                if let Some(safe) = parse_safe_arg(a) {
                    if let Some(r_arg) = json_arg_to_rosc(&safe) {
                        rosc_args.push(r_arg);
                    }
                }
            }
        }
        safe_messages.push((addr.to_string(), rosc_args));
    }

    for (addr, args) in &safe_messages {
        if let Err(err) = session.send_osc(addr, args.clone()).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": err })),
            )
                .into_response();
        }
    }

    Json(json!({
        "ok": true,
        "count": safe_messages.len(),
        "ip": session.ip,
    }))
    .into_response()
}

/// `POST /api/x32/presets/connect`
pub async fn x32_presets_connect_handler(
    State(state): State<ServerState>,
    body: Option<Json<Value>>,
) -> Response {
    let ip_val = body.as_ref().and_then(|Json(b)| b.get("ip"));
    let target_ip = resolve_target_ip(ip_val);

    match state
        .x32_manager
        .get_or_create_session(&target_ip, state.ws_hub.clone())
        .await
    {
        Ok(session) => {
            let mut status = session.get_status().await;
            if let Some(obj) = status.as_object_mut() {
                obj.insert("ok".to_string(), Value::Bool(true));
            }
            Json(status).into_response()
        }
        Err(err) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": err })),
        )
            .into_response(),
    }
}

/// `POST /api/x32/presets/disconnect`
pub async fn x32_presets_disconnect_handler(
    State(state): State<ServerState>,
) -> impl IntoResponse {
    state.x32_manager.disconnect().await;
    Json(json!({ "ok": true }))
}

/// `POST /api/x32/presets/poll`
pub async fn x32_presets_poll_handler(State(state): State<ServerState>) -> Response {
    let session = match state.x32_manager.get_active_session().await {
        Some(s) => s,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Niet verbonden. Roep eerst /api/x32/presets/connect aan." })),
            )
                .into_response();
        }
    };

    match session.poll_library("ch").await {
        Ok(mut result) => {
            if let Some(obj) = result.as_object_mut() {
                obj.insert("ok".to_string(), Value::Bool(true));
            }
            Json(result).into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err })),
        )
            .into_response(),
    }
}

/// `GET /api/x32/presets`
pub async fn x32_presets_get_handler(State(state): State<ServerState>) -> impl IntoResponse {
    match state.x32_manager.get_active_session().await {
        Some(session) => {
            let mut data = session.get_presets().await;
            if let Some(obj) = data.as_object_mut() {
                obj.insert("connected".to_string(), Value::Bool(true));
                obj.insert("ip".to_string(), Value::String(session.ip.clone()));
            }
            Json(data)
        }
        None => Json(json!({
            "connected": false,
            "presets": {},
            "occupied": 0,
            "total": 100,
            "lastPolled": null,
            "ip": null,
        })),
    }
}

/// `GET /api/x32/presets/status`
pub async fn x32_presets_status_handler(State(state): State<ServerState>) -> impl IntoResponse {
    match state.x32_manager.get_active_session().await {
        Some(session) => Json(session.get_status().await),
        None => Json(json!({ "connected": false })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_target_ip() {
        assert_eq!(resolve_target_ip(None), DEFAULT_X32_IP);
        assert_eq!(resolve_target_ip(Some(&json!(""))), DEFAULT_X32_IP);
        assert_eq!(resolve_target_ip(Some(&json!("   "))), DEFAULT_X32_IP);
        assert_eq!(resolve_target_ip(Some(&json!("192.168.1.100"))), "192.168.1.100");
    }

    #[test]
    fn test_parse_valid_int() {
        assert_eq!(parse_valid_int(Some(&json!(1)), 1, 32), Some(1));
        assert_eq!(parse_valid_int(Some(&json!(32)), 1, 32), Some(32));
        assert_eq!(parse_valid_int(Some(&json!(0)), 1, 32), None);
        assert_eq!(parse_valid_int(Some(&json!(33)), 1, 32), None);
        assert_eq!(parse_valid_int(Some(&json!("15")), 1, 32), Some(15));
        assert_eq!(parse_valid_int(Some(&json!("invalid")), 1, 32), None);
    }
}
