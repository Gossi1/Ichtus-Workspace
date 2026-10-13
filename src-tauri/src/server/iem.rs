use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::RwLock;

use super::{ws::WsHub, ServerState};

const MAX_X32_NAME_LENGTH: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HardwareItem {
    pub mic_id: i64,
    pub iem_pack: String,
    pub frequency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChannelItem {
    pub mic_id: i64,
    pub iem_pack: String,
    pub frequency: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IemStateFile {
    pub hardware: Vec<HardwareItem>,
    pub channels: Vec<ChannelItem>,
    #[serde(rename = "x32Library")]
    pub x32_library: BTreeMap<String, i64>,
    #[serde(rename = "x32LastUpdated")]
    pub x32_last_updated: Option<String>,
    #[serde(rename = "lastUpdated")]
    pub last_updated: Option<String>,
}

fn default_hardware() -> Vec<HardwareItem> {
    vec![
        HardwareItem {
            mic_id: 1,
            iem_pack: "IEM Pack 1".to_string(),
            frequency: "495.200 MHz".to_string(),
        },
        HardwareItem {
            mic_id: 2,
            iem_pack: "IEM Pack 2".to_string(),
            frequency: "492.700 MHz".to_string(),
        },
        HardwareItem {
            mic_id: 3,
            iem_pack: "IEM Pack 3".to_string(),
            frequency: "500.000 MHz".to_string(),
        },
        HardwareItem {
            mic_id: 4,
            iem_pack: "IEM Pack 4".to_string(),
            frequency: "505.100 MHz".to_string(),
        },
    ]
}

fn build_default_channels(hw: &[HardwareItem]) -> Vec<ChannelItem> {
    hw.iter()
        .map(|h| ChannelItem {
            mic_id: h.mic_id,
            iem_pack: h.iem_pack.clone(),
            frequency: h.frequency.clone(),
            name: "Unassigned / Standby".to_string(),
            avatar_url: None,
            active: false,
        })
        .collect()
}

struct IemStateInner {
    hardware: Vec<HardwareItem>,
    channels: Vec<ChannelItem>,
    x32_library: BTreeMap<String, i64>,
    x32_last_updated: Option<String>,
    last_updated: Option<String>,
}

#[derive(Clone)]
pub struct IemManager {
    file_path: PathBuf,
    inner: Arc<RwLock<IemStateInner>>,
    ws_hub: WsHub,
}

impl IemManager {
    pub fn new(data_dir: PathBuf, ws_hub: WsHub) -> Self {
        let file_path = data_dir.join("iem-state.json");
        let mut initial_state = None;

        if file_path.exists() {
            if let Ok(content) = fs::read_to_string(&file_path) {
                if let Ok(parsed) = serde_json::from_str::<IemStateFile>(&content) {
                    println!("  [IEM] Status geladen van {}", file_path.display());
                    initial_state = Some(IemStateInner {
                        hardware: parsed.hardware,
                        channels: parsed.channels,
                        x32_library: parsed.x32_library,
                        x32_last_updated: parsed.x32_last_updated,
                        last_updated: parsed.last_updated,
                    });
                }
            }
        }

        let inner_state = match initial_state {
            Some(s) => s,
            None => {
                println!("  [IEM] Initiële status aangemaakt (defaults)");
                let hw = default_hardware();
                let ch = build_default_channels(&hw);
                let s = IemStateInner {
                    hardware: hw,
                    channels: ch,
                    x32_library: BTreeMap::new(),
                    x32_last_updated: None,
                    last_updated: None,
                };
                let to_save = IemStateFile {
                    hardware: s.hardware.clone(),
                    channels: s.channels.clone(),
                    x32_library: s.x32_library.clone(),
                    x32_last_updated: s.x32_last_updated.clone(),
                    last_updated: s.last_updated.clone(),
                };
                if let Ok(json_str) = serde_json::to_string_pretty(&to_save) {
                    let _ = fs::write(&file_path, json_str);
                }
                s
            }
        };

        Self {
            file_path,
            inner: Arc::new(RwLock::new(inner_state)),
            ws_hub,
        }
    }

    fn persist_locked(&self, state: &IemStateInner) {
        let to_save = IemStateFile {
            hardware: state.hardware.clone(),
            channels: state.channels.clone(),
            x32_library: state.x32_library.clone(),
            x32_last_updated: state.x32_last_updated.clone(),
            last_updated: state.last_updated.clone(),
        };
        if let Ok(json_str) = serde_json::to_string_pretty(&to_save) {
            let _ = fs::write(&self.file_path, json_str);
        }
    }

    pub async fn get_status(&self) -> Value {
        let r = self.inner.read().await;
        json!({
            "hardware": r.hardware,
            "channels": r.channels,
            "x32Library": r.x32_library,
            "lastUpdated": r.last_updated,
        })
    }

    pub async fn assign(&self, raw_channels: &[Value]) -> Result<Vec<ChannelItem>, String> {
        let mut new_channels = Vec::new();
        for ch in raw_channels {
            let obj = ch.as_object().ok_or("Ongeldig kanaal")?;
            let mic_id = obj
                .get("mic_id")
                .and_then(|v| v.as_i64())
                .ok_or("Ongeldig kanaal: mic_id (number) is verplicht.")?;
            let iem_pack = obj
                .get("iem_pack")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let frequency = obj
                .get("frequency")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Unassigned / Standby")
                .to_string();
            let avatar_url = obj
                .get("avatar_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let active = obj
                .get("active")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            new_channels.push(ChannelItem {
                mic_id,
                iem_pack,
                frequency,
                name,
                avatar_url,
                active,
            });
        }

        let now_iso = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        {
            let mut w = self.inner.write().await;
            w.channels = new_channels.clone();
            w.last_updated = Some(now_iso.clone());
            self.persist_locked(&w);
        }

        self.ws_hub.broadcast(
            "iem:status",
            json!({
                "channels": new_channels,
                "lastUpdated": now_iso,
            }),
        );

        Ok(new_channels)
    }

    pub async fn update_roster(&self, roster: &[Value]) -> Result<Vec<ChannelItem>, String> {
        let r = self.inner.read().await;
        let hardware = r.hardware.clone();
        drop(r);

        let worship_leader = roster.iter().find(|p| {
            p.get("role_name")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case("worship leader"))
                .unwrap_or(false)
        });

        let piano_player = roster.iter().find(|p| {
            p.get("role_name")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case("piano"))
                .unwrap_or(false)
        });

        let leader_is_on_piano = match (worship_leader, piano_player) {
            (Some(wl), Some(pp)) => {
                let wl_name = wl.get("display_name").and_then(|v| v.as_str()).unwrap_or("");
                let pp_name = pp.get("display_name").and_then(|v| v.as_str()).unwrap_or("");
                !wl_name.is_empty() && wl_name == pp_name
            }
            _ => false,
        };

        let mut wireless_users = Vec::new();
        if let Some(wl) = worship_leader {
            if !leader_is_on_piano {
                wireless_users.push(wl);
            }
        }

        let vocalists: Vec<&Value> = roster
            .iter()
            .filter(|p| {
                if let Some(role) = p.get("role_name").and_then(|v| v.as_str()) {
                    let lower = role.to_ascii_lowercase();
                    lower.contains("vocalist") || lower == "vocal"
                } else {
                    false
                }
            })
            .collect();

        wireless_users.extend(vocalists);

        let final_state: Vec<ChannelItem> = hardware
            .iter()
            .enumerate()
            .map(|(idx, hw)| {
                let person = wireless_users.get(idx).copied();
                let (name, avatar_url, active) = if let Some(p) = person {
                    (
                        p.get("display_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unassigned / Standby")
                            .to_string(),
                        p.get("image_url")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        true,
                    )
                } else {
                    ("Unassigned / Standby".to_string(), None, false)
                };

                ChannelItem {
                    mic_id: hw.mic_id,
                    iem_pack: hw.iem_pack.clone(),
                    frequency: hw.frequency.clone(),
                    name,
                    avatar_url,
                    active,
                }
            })
            .collect();

        let now_iso = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        {
            let mut w = self.inner.write().await;
            w.channels = final_state.clone();
            w.last_updated = Some(now_iso.clone());
            self.persist_locked(&w);
        }

        self.ws_hub.broadcast(
            "iem:status",
            json!({
                "channels": final_state,
                "lastUpdated": now_iso,
            }),
        );

        Ok(final_state)
    }

    pub async fn save_hardware_config(&self, new_config: Vec<HardwareItem>) {
        let now_iso = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let updated_channels = {
            let mut w = self.inner.write().await;
            w.hardware = new_config.clone();
            w.last_updated = Some(now_iso.clone());

            if !w.channels.is_empty() {
                w.channels = w
                    .channels
                    .iter()
                    .map(|ch| {
                        if let Some(hw) = new_config.iter().find(|h| h.mic_id == ch.mic_id) {
                            let mut updated = ch.clone();
                            updated.iem_pack = hw.iem_pack.clone();
                            updated.frequency = hw.frequency.clone();
                            updated
                        } else {
                            ch.clone()
                        }
                    })
                    .collect();
            } else {
                w.channels = build_default_channels(&new_config);
            }

            self.persist_locked(&w);
            w.channels.clone()
        };

        self.ws_hub.broadcast(
            "iem:status",
            json!({
                "channels": updated_channels,
                "lastUpdated": now_iso,
            }),
        );
    }

    pub async fn get_x32_library(&self) -> Value {
        let r = self.inner.read().await;
        json!({
            "map": r.x32_library,
            "lastUpdated": r.x32_last_updated,
        })
    }

    pub async fn save_x32_library(&self, map: BTreeMap<String, i64>) -> String {
        let now_iso = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut w = self.inner.write().await;
        w.x32_library = map;
        w.x32_last_updated = Some(now_iso.clone());
        self.persist_locked(&w);
        now_iso
    }
}

// ── Validation Helpers ─────────────────────────────────────────────────

fn validate_x32_library_map(raw: Option<&Value>) -> Result<BTreeMap<String, i64>, String> {
    let raw_val = raw.ok_or_else(|| "Ongeldig lichaam. Verwacht { map: { naam: libSlot, ... }}.".to_string())?;
    let obj = match raw_val {
        Value::Object(map) => map,
        _ => return Err("Ongeldig lichaam. Verwacht { map: { naam: libSlot, ... }}.".to_string()),
    };

    let mut cleaned = BTreeMap::new();
    for (k, v) in obj {
        let trimmed = k.trim();
        if trimmed.is_empty() {
            return Err("Lege naam gevonden.".to_string());
        }
        if trimmed.len() > MAX_X32_NAME_LENGTH {
            return Err(format!(
                "Naam \"{}\" is te lang (max {} tekens).",
                trimmed, MAX_X32_NAME_LENGTH
            ));
        }
        if v.is_null() {
            return Err(format!("Waarde voor {} ontbreekt.", trimmed));
        }

        let num = match v {
            Value::Number(n) => n
                .as_i64()
                .or_else(|| n.as_f64().and_then(|f| if f.fract() == 0.0 { Some(f as i64) } else { None })),
            Value::String(s) => s.trim().parse::<i64>().ok(),
            _ => return Err(format!("Waarde voor {} moet number of numerieke string zijn.", trimmed)),
        };

        let slot = match num {
            Some(n) if (0..=99).contains(&n) => n,
            _ => return Err(format!("Waarde voor \"{}\" moet geheel getal 0..99 zijn.", trimmed)),
        };

        cleaned.insert(trimmed.to_string(), slot);
    }

    if cleaned.is_empty() {
        return Err("Map is leeg. Voeg minstens één naam met een library-slot toe.".to_string());
    }

    Ok(cleaned)
}

// ── Route Handlers ─────────────────────────────────────────────────────

/// `GET /api/iem/status`
pub async fn iem_status_handler(State(state): State<ServerState>) -> impl IntoResponse {
    Json(state.iem_manager.get_status().await)
}

/// `POST /api/iem/assign`
pub async fn iem_assign_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let channels = match body.get("channels").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig payload. Verwacht channels array." })),
            )
                .into_response();
        }
    };

    match state.iem_manager.assign(channels).await {
        Ok(assigned) => Json(json!({ "success": true, "channels": assigned })).into_response(),
        Err(err) => (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    }
}

/// `POST /api/iem/update-roster`
pub async fn iem_update_roster_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let roster = match body.get("roster").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig roster payload. Verwacht array." })),
            )
                .into_response();
        }
    };

    match state.iem_manager.update_roster(roster).await {
        Ok(live_status) => {
            Json(json!({ "success": true, "live_status": live_status })).into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err })),
        )
            .into_response(),
    }
}

/// `POST /api/iem/save-hardware-config`
pub async fn iem_save_hardware_config_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let arr = match body.as_array() {
        Some(a) => a,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldige data. Verwacht array van mic configuraties." })),
            )
                .into_response();
        }
    };

    let mut new_config = Vec::new();
    for item in arr {
        let obj = match item.as_object() {
            Some(o) => o,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Ongeldig item: mic_id, iem_pack en frequency zijn verplicht." })),
                )
                    .into_response();
            }
        };

        let mic_id = obj.get("mic_id").and_then(|v| v.as_i64());
        let iem_pack = obj.get("iem_pack").and_then(|v| v.as_str());
        let frequency = obj.get("frequency").and_then(|v| v.as_str());

        match (mic_id, iem_pack, frequency) {
            (Some(m), Some(p), Some(f)) => {
                new_config.push(HardwareItem {
                    mic_id: m,
                    iem_pack: p.to_string(),
                    frequency: f.to_string(),
                });
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Ongeldig item: mic_id, iem_pack en frequency zijn verplicht." })),
                )
                    .into_response();
            }
        }
    }

    state.iem_manager.save_hardware_config(new_config).await;
    Json(json!({ "success": true })).into_response()
}

/// `GET /api/iem/x32-library`
pub async fn iem_get_x32_library_handler(
    State(state): State<ServerState>,
) -> impl IntoResponse {
    Json(state.iem_manager.get_x32_library().await)
}

/// `POST /api/iem/x32-library`
pub async fn iem_save_x32_library_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let map = match validate_x32_library_map(body.get("map")) {
        Ok(m) => m,
        Err(err) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response(),
    };

    let last_updated = state.iem_manager.save_x32_library(map.clone()).await;
    Json(json!({
        "ok": true,
        "map": map,
        "lastUpdated": last_updated,
    }))
    .into_response()
}
