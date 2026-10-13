use axum::{extract::State, response::IntoResponse, Json};
use chrono::Utc;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::net::UdpSocket;
use tokio::sync::Mutex;

use super::ServerState;

const CACHE_TTL: Duration = Duration::from_secs(10);
const NDI_SERVICE_TYPE: &str = "_ndi._tcp.local.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiSource {
    pub name: String,
    pub address: String,
    pub port: u16,
    #[serde(rename = "type")]
    pub source_type: String,
    pub metadata: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiResponse {
    pub sources: Vec<NdiSource>,
    pub count: usize,
    pub timestamp: String,
    pub scanning: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct NdiManager {
    inner: Arc<Mutex<NdiManagerInner>>,
}

struct NdiManagerInner {
    cache: Option<Vec<NdiSource>>,
    cache_time: Option<Instant>,
    scanning: bool,
}

impl NdiManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(NdiManagerInner {
                cache: None,
                cache_time: None,
                scanning: false,
            })),
        }
    }

    pub async fn discover(&self) -> NdiResponse {
        // 1. Check cache
        {
            let lock = self.inner.lock().await;
            if let (Some(cache), Some(t)) = (&lock.cache, lock.cache_time) {
                if !lock.scanning && t.elapsed() < CACHE_TTL {
                    return NdiResponse {
                        sources: cache.clone(),
                        count: cache.len(),
                        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        scanning: false,
                        error: None,
                    };
                }
            }
            if lock.scanning {
                // Scan is already in progress, wait a little and return current cache
                drop(lock);
                tokio::time::sleep(Duration::from_millis(1500)).await;
                let lock = self.inner.lock().await;
                let sources = lock.cache.clone().unwrap_or_default();
                return NdiResponse {
                    count: sources.len(),
                    sources,
                    timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    scanning: lock.scanning,
                    error: None,
                };
            }
        }

        // 2. Mark scanning = true
        {
            let mut lock = self.inner.lock().await;
            lock.scanning = true;
        }

        let scan_result = run_ndi_scan().await;

        // 3. Update cache & mark scanning = false
        let mut lock = self.inner.lock().await;
        lock.scanning = false;
        match scan_result {
            Ok(sources) => {
                lock.cache = Some(sources.clone());
                lock.cache_time = Some(Instant::now());
                NdiResponse {
                    count: sources.len(),
                    sources,
                    timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    scanning: false,
                    error: None,
                }
            }
            Err(err) => {
                let existing = lock.cache.clone().unwrap_or_default();
                NdiResponse {
                    count: existing.len(),
                    sources: existing,
                    timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    scanning: false,
                    error: Some(err),
                }
            }
        }
    }
}

async fn run_ndi_scan() -> Result<Vec<NdiSource>, String> {
    // Probeer eerst mDNS via mdns-sd
    let mdns_sources = scan_mdns().await;
    if !mdns_sources.is_empty() {
        return Ok(mdns_sources);
    }

    // Fallback: UDP broadcast op 5960 en 5961
    let udp_sources = scan_udp().await;
    Ok(udp_sources)
}

async fn scan_mdns() -> Vec<NdiSource> {
    tokio::task::spawn_blocking(|| {
        let mut sources = Vec::new();
        let mut seen = HashSet::new();

        let daemon = match ServiceDaemon::new() {
            Ok(d) => d,
            Err(_) => return sources,
        };

        let receiver = match daemon.browse(NDI_SERVICE_TYPE) {
            Ok(r) => r,
            Err(_) => {
                let _ = daemon.shutdown();
                return sources;
            }
        };

        let deadline = Instant::now() + Duration::from_millis(3000);
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match receiver.recv_timeout(remaining.min(Duration::from_millis(500))) {
                Ok(ServiceEvent::ServiceResolved(info)) => {
                    let port = info.get_port();
                    let name = info.get_fullname().trim_end_matches('.').to_string();

                    for addr in info.get_addresses_v4() {
                        let ip_str = addr.to_string();
                        if !seen.contains(&ip_str) {
                            seen.insert(ip_str.clone());
                            sources.push(NdiSource {
                                name: name.clone(),
                                address: ip_str,
                                port,
                                source_type: "NDI Source".to_string(),
                                metadata: format!("Port: {}", port),
                            });
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }

        let _ = daemon.stop_browse(NDI_SERVICE_TYPE);
        let _ = daemon.shutdown();
        sources
    })
    .await
    .unwrap_or_default()
}

async fn scan_udp() -> Vec<NdiSource> {
    let mut sources = Vec::new();
    let mut discovered = HashSet::new();

    let socket = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(s) => s,
        Err(_) => return sources,
    };

    if socket.set_broadcast(true).is_err() {
        return sources;
    }

    let packet = b"NDI_LIST";
    let _ = socket.send_to(packet, "255.255.255.255:5961").await;
    let _ = socket.send_to(packet, "255.255.255.255:5960").await;

    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut buf = [0u8; 2048];

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }

        match tokio::time::timeout(remaining, socket.recv_from(&mut buf)).await {
            Ok(Ok((_len, addr))) => {
                let ip_str = match addr {
                    SocketAddr::V4(v4) => v4.ip().to_string(),
                    SocketAddr::V6(v6) => v6.ip().to_string(),
                };
                if !discovered.contains(&ip_str) {
                    discovered.insert(ip_str.clone());
                    sources.push(NdiSource {
                        name: format!("NDI Device@{}", ip_str),
                        address: ip_str,
                        port: 5961,
                        source_type: "NDI Source (UDP)".to_string(),
                        metadata: "Discovered via UDP broadcast".to_string(),
                    });
                }
            }
            _ => break,
        }
    }

    sources
}

pub async fn ndi_sources_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let resp = state.ndi_manager.discover().await;
    Json(resp)
}
