use axum::{
    extract::State,
    http::{header, HeaderValue, Method},
    response::IntoResponse,
    routing::{any, get, post},
    Json, Router,
};
use chrono::Utc;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::net::TcpListener;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

pub mod iem;
pub mod ndi;
pub mod propresenter;
pub mod setlist;
pub mod state_topics;
pub mod system;
pub mod topic_store;
pub mod worshiptools;
pub mod ws;
pub mod x32;

#[derive(Clone)]
#[allow(dead_code)]
pub struct ServerState {
    pub root_dir: PathBuf,
    pub spa_dir: PathBuf,
    pub data_dir: PathBuf,
    pub start_time: Instant,
    pub request_count: Arc<AtomicU64>,
    pub http_client: reqwest::Client,
    pub ws_hub: ws::WsHub,
    pub topic_store: topic_store::TopicStore,
    pub ndi_manager: ndi::NdiManager,
    pub x32_manager: x32::X32Manager,
    pub iem_manager: iem::IemManager,
    pub worshiptools_manager: worshiptools::WorshipToolsManager,
    pub system_manager: system::SystemManager,
    pub app_handle: Option<tauri::AppHandle>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    engine: &'static str,
    dev_mode: bool,
    pid: u32,
    uptime_sec: u64,
    requests_served: u64,
    timestamp: String,
}

/// Native Rust `/api/health` endpoint (Fase 4.1)
async fn health_handler(State(state): State<ServerState>) -> impl IntoResponse {
    state.request_count.fetch_add(1, Ordering::Relaxed);
    let uptime = state.start_time.elapsed().as_secs();
    let count = state.request_count.load(Ordering::Relaxed);

    Json(HealthResponse {
        status: "ok",
        service: "ichtus-spa",
        engine: "rust-axum",
        dev_mode: cfg!(debug_assertions),
        pid: std::process::id(),
        uptime_sec: uptime,
        requests_served: count,
        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    })
}

#[cfg(debug_assertions)]
fn collect_watched_files(
    dir: &std::path::Path,
    out: &mut std::collections::HashMap<PathBuf, std::time::SystemTime>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') || name_str == "data" || name_str == "node_modules" {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_dir() {
                collect_watched_files(&path, out);
            } else if meta.is_file() {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(ext.as_str(), "js" | "css" | "html" | "svg") {
                    if let Ok(mtime) = meta.modified() {
                        out.insert(path, mtime);
                    }
                }
            }
        }
    }
}

#[cfg(debug_assertions)]
fn spawn_dev_file_watcher(root_dir: PathBuf, ws_hub: ws::WsHub) {
    tokio::spawn(async move {
        let watch_dirs = [root_dir.join("Ichtus_SPA"), root_dir.join("assets")];
        let mut known = std::collections::HashMap::new();
        for d in &watch_dirs {
            collect_watched_files(d, &mut known);
        }
        println!(
            "  [DEV-WATCH] Live-reload actief voor Ichtus_SPA/ en assets/ ({} bestanden gevolgd)",
            known.len()
        );

        let mut interval = tokio::time::interval(Duration::from_millis(350));
        loop {
            interval.tick().await;
            let mut current = std::collections::HashMap::with_capacity(known.len());
            for d in &watch_dirs {
                collect_watched_files(d, &mut current);
            }

            let mut changed_files = Vec::new();
            for (path, mtime) in &current {
                match known.get(path) {
                    Some(prev) if prev == mtime => {}
                    _ => {
                        let rel = path
                            .strip_prefix(&root_dir)
                            .unwrap_or(path)
                            .to_string_lossy()
                            .replace('\\', "/");
                        changed_files.push(rel);
                    }
                }
            }

            if !changed_files.is_empty() {
                known = current;
                let all_css = changed_files.iter().all(|f| f.ends_with(".css"));
                let reload_type = if all_css { "css" } else { "full" };
                println!(
                    "  [DEV-WATCH] Wijziging gedetecteerd ({}) -> {:?}",
                    reload_type, changed_files
                );
                ws_hub.broadcast(
                    "dev:reload",
                    serde_json::json!({
                        "type": reload_type,
                        "files": changed_files,
                    }),
                );
            }
        }
    });
}

/// Start de Rust Axum server op `0.0.0.0:{public_port}` (100% Native Rust)
fn is_allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(s) = origin.to_str() else { return false };
    if s == "tauri://localhost" {
        return true;
    }
    let Some(stripped) = s.strip_prefix("http://") else {
        return false;
    };
    let host = stripped
        .split(':')
        .next()
        .unwrap_or(stripped)
        .split('/')
        .next()
        .unwrap_or(stripped);

    if host == "localhost" || host == "127.0.0.1" || host.ends_with(".local") {
        return true;
    }

    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return ip.is_loopback() || ip.is_private();
    }

    false
}

pub async fn start_axum_server(
    root_dir: PathBuf,
    data_dir: PathBuf,
    public_port: u16,
    app_handle: Option<tauri::AppHandle>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _ = rustls::crypto::ring::default_provider().install_default();

    let spa_dir = root_dir.join("Ichtus_SPA");
    let index_file = spa_dir.join("index.html");

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let ws_hub = ws::WsHub::new();
    let topic_store = topic_store::TopicStore::new();
    let ndi_manager = ndi::NdiManager::new();
    let x32_manager = x32::X32Manager::new();
    let iem_manager = iem::IemManager::new(data_dir.clone(), ws_hub.clone());
    let worshiptools_manager =
        worshiptools::WorshipToolsManager::new(data_dir.clone(), ws_hub.clone(), http_client.clone());
    let system_manager = system::SystemManager::new();

    let state = ServerState {
        root_dir: root_dir.clone(),
        spa_dir: spa_dir.clone(),
        data_dir,
        start_time: Instant::now(),
        request_count: Arc::new(AtomicU64::new(0)),
        http_client,
        ws_hub,
        topic_store,
        ndi_manager,
        x32_manager,
        iem_manager,
        worshiptools_manager,
        system_manager,
        app_handle,
    };

    #[cfg(debug_assertions)]
    spawn_dev_file_watcher(root_dir.clone(), state.ws_hub.clone());

    // Static file services:
    // 1. /Ichtus_SPA/* -> serveert vanuit root_dir/Ichtus_SPA met index.html fallback
    // 2. /assets/* -> serveert gedeelde branding CSS, fonts en JS vanuit root_dir/assets
    // 3. Fallback -> SPA index.html (voorkomt ongeautoriseerde toegang tot server-config.json, etc.)
    let spa_service = ServeDir::new(&spa_dir)
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(&index_file));

    let assets_dir = root_dir.join("assets");
    let assets_service = ServeDir::new(&assets_dir)
        .not_found_service(ServeFile::new(&index_file));

    let no_cache_header = SetResponseHeaderLayer::overriding(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate"),
    );

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(|origin, _| {
            is_allowed_origin(origin)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
            Method::HEAD,
        ])
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        // Fase 4.1: Native Rust health endpoint
        .route("/api/health", get(health_handler))
        // Fase 4.2: Native Rust ProPresenter proxy (/api/pro/* -> http://<proHost>:<proPort>/v1/*)
        .route("/api/pro/{*path}", any(propresenter::pro_proxy_handler))
        // Fase 4.4: Native Rust NDI discovery (/api/ndi/sources)
        .route("/api/ndi/sources", get(ndi::ndi_sources_handler))
        // Fase 4.5: Native Rust X32 OSC bridge (/api/x32/*)
        .route("/api/x32/health", get(x32::x32_health_handler))
        .route("/api/x32/osc-info", get(x32::x32_osc_info_handler))
        .route(
            "/api/x32/load-channel-preset",
            post(x32::x32_load_channel_preset_handler),
        )
        .route("/api/x32/send", post(x32::x32_send_handler))
        .route("/api/x32/session/send", post(x32::x32_session_send_handler))
        .route(
            "/api/x32/presets/connect",
            post(x32::x32_presets_connect_handler),
        )
        .route(
            "/api/x32/presets/disconnect",
            post(x32::x32_presets_disconnect_handler),
        )
        .route(
            "/api/x32/presets/poll",
            post(x32::x32_presets_poll_handler),
        )
        .route("/api/x32/presets", get(x32::x32_presets_get_handler))
        .route(
            "/api/x32/presets/status",
            get(x32::x32_presets_status_handler),
        )
        // Fase 4.6: Native Rust IEM / Mic-monitor (/api/iem/*)
        .route("/api/iem/status", get(iem::iem_status_handler))
        .route("/api/iem/assign", post(iem::iem_assign_handler))
        .route("/api/iem/update-roster", post(iem::iem_update_roster_handler))
        .route(
            "/api/iem/save-hardware-config",
            post(iem::iem_save_hardware_config_handler),
        )
        .route(
            "/api/iem/x32-library",
            get(iem::iem_get_x32_library_handler).post(iem::iem_save_x32_library_handler),
        )
        // Fase 4.7: Native Rust Setlist templates (/api/setlist/templates)
        .route(
            "/api/setlist/templates",
            get(setlist::get_templates_handler).post(setlist::save_templates_handler),
        )
        // Fase 4.7: Native Rust Dashboard cloud sync (/api/dashboard/state)
        .route(
            "/api/dashboard/state",
            get(state_topics::dashboard_get_state_handler)
                .post(state_topics::dashboard_set_state_handler),
        )
        // Fase 4.7: Native Rust Patchbay cloud sync (/api/patchbay/state)
        .route(
            "/api/patchbay/state",
            get(state_topics::patchbay_get_state_handler)
                .post(state_topics::patchbay_set_state_handler),
        )
        // Fase 4.7: Native Rust Command Center state & archive (/api/commandcenter/*)
        .route(
            "/api/commandcenter/state",
            get(state_topics::commandcenter_get_state_handler)
                .post(state_topics::commandcenter_post_state_handler),
        )
        .route(
            "/api/commandcenter/archive",
            post(state_topics::commandcenter_archive_handler),
        )
        // Fase 4.8: Native Rust WorshipTools Services API (/api/worshiptools-services/*)
        .route(
            "/api/worshiptools-services/people",
            get(worshiptools::people_list_handler).post(worshiptools::people_save_handler),
        )
        .route(
            "/api/worshiptools-services/people/sync",
            post(worshiptools::people_sync_handler),
        )
        .route(
            "/api/worshiptools-services/people/reload",
            any(worshiptools::people_reload_handler),
        )
        .route(
            "/api/worshiptools-services/services",
            get(worshiptools::services_handler),
        )
        .route(
            "/api/worshiptools-services/services/{id}/setlist",
            get(worshiptools::setlist_handler),
        )
        .route(
            "/api/worshiptools-services/services/{id}/roster",
            get(worshiptools::roster_handler),
        )
        .route(
            "/api/worshiptools-services/library",
            get(worshiptools::library_handler),
        )
        // Fase 4.8: Native Rust WorshipTools Legacy Sync API (/api/worshiptools/*)
        .route(
            "/api/worshiptools/setlist",
            get(worshiptools::legacy_get_setlist_handler).post(worshiptools::legacy_post_setlist_handler),
        )
        .route(
            "/api/worshiptools/roster",
            get(worshiptools::legacy_get_roster_handler).post(worshiptools::legacy_post_roster_handler),
        )
        .route(
            "/api/worshiptools/library",
            get(worshiptools::legacy_get_library_handler).post(worshiptools::legacy_post_library_handler),
        )
        .route(
            "/api/worshiptools/status",
            get(worshiptools::legacy_get_status_handler),
        )
        .route(
            "/api/worshiptools/token",
            post(worshiptools::token_update_handler),
        )
        .route(
            "/api/worshiptools/open-login",
            post(worshiptools::open_login_handler),
        )
        .route(
            "/api/worshiptools/close-login",
            post(worshiptools::close_login_handler),
        )
        .route(
            "/api/worshiptools/config",
            get(worshiptools::config_get_handler).post(worshiptools::config_post_handler),
        )
        .route(
            "/api/worshiptools/test",
            post(worshiptools::config_test_handler),
        )
        // Fase 4.9: Native Rust Tockify ICS proxy (/api/tockify/ics)
        .route("/api/tockify/ics", get(system::tockify_ics_handler))
        // Fase 4.9: Native Rust Song ID Assigner Library (/api/library/*)
        .route("/api/library/files", get(system::library_files_handler))
        .route(
            "/api/library/config",
            get(system::library_config_get_handler).post(system::library_config_post_handler),
        )
        .route("/api/library/load", get(system::library_load_handler))
        .route("/api/library/save", post(system::library_save_handler))
        // Fase 4.9: Native Rust Supervisor Status, Logs & Update (/api/status, /api/logs/*, etc.)
        .route("/api/status", get(system::status_handler))
        .route("/api/logs/{key}", get(system::logs_handler))
        .route("/api/restart/{key}", post(system::restart_handler))
        .route("/api/restart-all", post(system::restart_all_handler))
        .route("/api/check-update", get(system::check_update_handler))
        .route("/api/check-update-now", post(system::check_update_now_handler))
        .route("/api/update", post(system::update_git_handler))
        // Fase 4.3: Native Rust WebSocket hub op /ws (axum::ws + tokio::broadcast)
        .route("/ws", get(ws::ws_handler))
        // Root redirect/serve naar SPA index.html
        .route_service("/", ServeFile::new(&index_file))
        .nest_service("/Ichtus_SPA", spa_service.clone())
        .nest_service("/assets", assets_service)
        .fallback_service(spa_service)
        .layer(no_cache_header)
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", public_port);
    println!("[AXUM] 100% Native Rust HTTP + WS server luistert op http://{}", addr);

    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
