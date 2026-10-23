use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use super::ServerState;

fn silent_git_cmd() -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("git");
    #[cfg(windows)]
    {
        // 0x08000000 = CREATE_NO_WINDOW prevents Windows console popup windows
        cmd.creation_flags(0x08000000);
    }
    cmd
}

// ── Tockify ICS Proxy ───────────────────────────────────────────────────

pub async fn tockify_ics_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let url = "https://tockify.com/api/feeds/ics/ichtus";
    let resp = match state
        .http_client
        .get(url)
        .header(header::USER_AGENT, "Ichtus-Workspace")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("Tockify unreachable: {}", e) })),
            )
                .into_response();
        }
    };

    if !resp.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("Tockify HTTP {}", resp.status()) })),
        )
            .into_response();
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("Tockify leesfout: {}", e) })),
            )
                .into_response();
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/calendar; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(axum::body::Body::from(text))
        .unwrap()
}

// ── Song ID Assigner Library ────────────────────────────────────────────

#[derive(Serialize)]
pub struct LibraryFileInfo {
    pub name: String,
    pub size: u64,
    pub modified: String,
}

#[derive(Deserialize, Serialize, Default)]
pub struct LibraryConfig {
    #[serde(default, rename = "libraryPath")]
    pub library_path: Option<String>,
    #[serde(default, rename = "updatedAt")]
    pub updated_at: Option<String>,
}

fn get_library_config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("library-config.json")
}

fn load_library_config(data_dir: &Path) -> LibraryConfig {
    let path = get_library_config_path(data_dir);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<LibraryConfig>(&content) {
                return cfg;
            }
        }
    }
    LibraryConfig::default()
}

fn get_library_path(root_dir: &Path, data_dir: &Path) -> PathBuf {
    let cfg = load_library_config(data_dir);
    if let Some(configured) = cfg.library_path {
        let configured = configured.trim();
        if !configured.is_empty() {
            let p = PathBuf::from(configured);
            if let Some(parent) = p.parent() {
                if parent.exists() {
                    return p;
                }
            }
        }
    }
    root_dir.join("song-id-assigner").join("library-ids.json")
}

/// `GET /api/library/files`
pub async fn library_files_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let lib_dir = state.root_dir.join("song-id-assigner");
    let mut files = Vec::new();

    if lib_dir.exists() {
        if let Ok(entries) = fs::read_dir(&lib_dir) {
            let mut sorted_entries = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.to_lowercase().ends_with(".json") {
                    sorted_entries.push((name, entry));
                }
            }
            sorted_entries.sort_by(|a, b| a.0.cmp(&b.0));

            for (name, entry) in sorted_entries {
                if let Ok(meta) = entry.metadata() {
                    let size = meta.len();
                    let modified = meta
                        .modified()
                        .ok()
                        .map(|t| {
                            let dt: chrono::DateTime<Utc> = t.into();
                            dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                        })
                        .unwrap_or_else(|| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));

                    files.push(LibraryFileInfo { name, size, modified });
                }
            }
        }
    }

    Json(json!({ "success": true, "files": files }))
}

/// `GET /api/library/config`
pub async fn library_config_get_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let cfg = load_library_config(&state.data_dir);
    let lib_path = get_library_path(&state.root_dir, &state.data_dir);
    let path_str = lib_path.to_string_lossy().to_string();

    Json(json!({
        "success": true,
        "libraryPath": cfg.library_path.unwrap_or_default(),
        "resolvedPath": path_str,
        "fileExists": lib_path.exists(),
    }))
}

/// `POST /api/library/config`
pub async fn library_config_post_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let raw_path = body
        .get("libraryPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if raw_path.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": "libraryPath mag niet leeg zijn" })),
        )
            .into_response();
    }

    let lib_path = PathBuf::from(raw_path);
    if let Some(parent) = lib_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if !lib_path.exists() {
        let init_data = json!({
            "schemaVersion": 1,
            "updatedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "songs": []
        });
        if let Ok(pretty) = serde_json::to_string_pretty(&init_data) {
            let _ = fs::write(&lib_path, pretty);
        }
    }

    let cfg_path = get_library_config_path(&state.data_dir);
    let new_cfg = json!({
        "libraryPath": raw_path,
        "updatedAt": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    });

    if let Ok(pretty) = serde_json::to_string_pretty(&new_cfg) {
        if let Err(e) = fs::write(&cfg_path, pretty) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": e.to_string() })),
            )
                .into_response();
        }
    }

    let file_name = lib_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    Json(json!({
        "success": true,
        "libraryPath": raw_path,
        "message": format!("Bibliotheek gekoppeld aan {}", file_name),
    }))
    .into_response()
}

#[derive(Deserialize)]
pub struct LibraryLoadQuery {
    pub file: Option<String>,
}

/// `GET /api/library/load`
pub async fn library_load_handler(
    State(state): State<ServerState>,
    Query(query): Query<LibraryLoadQuery>,
) -> impl IntoResponse {
    let lib_path = if let Some(f) = query.file {
        let clean = Path::new(&f)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let file_name = if clean.to_lowercase().ends_with(".json") {
            clean
        } else {
            format!("{}.json", clean)
        };
        state.root_dir.join("song-id-assigner").join(file_name)
    } else {
        get_library_path(&state.root_dir, &state.data_dir)
    };

    let data = if lib_path.exists() {
        match fs::read_to_string(&lib_path) {
            Ok(content) => serde_json::from_str::<Value>(&content).unwrap_or_else(|_| {
                json!({ "schemaVersion": 1, "songs": [] })
            }),
            Err(_) => json!({ "schemaVersion": 1, "songs": [] }),
        }
    } else {
        json!({ "schemaVersion": 1, "songs": [] })
    };

    let file_name = lib_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_str = lib_path.to_string_lossy().to_string();

    Json(json!({
        "success": true,
        "library": data,
        "file": file_name,
        "path": path_str,
    }))
}

/// `POST /api/library/save`
pub async fn library_save_handler(
    State(state): State<ServerState>,
    Json(data): Json<Value>,
) -> Response {
    let songs_arr = match data.get("songs").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "songs moet een lijst zijn" })),
            )
                .into_response();
        }
    };

    let mut clean = Vec::new();
    for s in songs_arr {
        if !s.is_object() {
            continue;
        }
        let title = s.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
        if title.is_empty() {
            continue;
        }

        let prefix = s.get("prefix").and_then(|v| v.as_str()).unwrap_or("").trim();
        let number = s.get("number").and_then(|v| v.as_str()).unwrap_or("").trim();

        // Validatie volgens regex in Node.js
        if !prefix.is_empty() {
            if prefix.len() > 4 || !prefix.chars().all(|c| c.is_ascii_alphabetic()) {
                continue;
            }
        }
        if !number.is_empty() {
            let digits_part = number.trim_end_matches(|c: char| c.is_ascii_alphabetic());
            let alpha_suffix = &number[digits_part.len()..];
            if digits_part.is_empty()
                || digits_part.len() > 4
                || !digits_part.chars().all(|c| c.is_ascii_digit())
                || alpha_suffix.len() > 1
            {
                continue;
            }
        }
        if (!prefix.is_empty() && number.is_empty()) || (prefix.is_empty() && !number.is_empty()) {
            continue;
        }

        let mut alt_titles = Vec::new();
        let mut seen_lower = std::collections::HashSet::new();
        if let Some(arr) = s.get("altTitles").and_then(|v| v.as_array()) {
            for t in arr.iter().take(50) {
                let str_val = t.as_str().unwrap_or("").trim();
                let lower = str_val.to_lowercase();
                if !str_val.is_empty() && !seen_lower.contains(&lower) {
                    seen_lower.insert(lower);
                    alt_titles.push(Value::String(str_val.to_string()));
                }
            }
        }

        let id_val = if !prefix.is_empty() && !number.is_empty() {
            format!("{}{}", prefix, number)
        } else {
            String::new()
        };

        let mut item = serde_json::Map::new();
        item.insert("uid".to_string(), json!(s.get("uid").and_then(|v| v.as_str()).unwrap_or("")));
        item.insert("id".to_string(), json!(id_val));
        item.insert("prefix".to_string(), json!(prefix));
        item.insert("number".to_string(), json!(number));
        item.insert("title".to_string(), json!(title));
        item.insert("artist".to_string(), json!(s.get("artist").and_then(|v| v.as_str()).unwrap_or("")));
        item.insert("altTitles".to_string(), Value::Array(alt_titles));

        if let Some(wt_id) = s.get("wtId").and_then(|v| v.as_str()) {
            item.insert("wtId".to_string(), json!(wt_id));
        }

        clean.push(Value::Object(item));
    }

    let file_param = data
        .get("file")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let lib_path = if !file_param.is_empty() {
        let clean_name = Path::new(file_param)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let file_name = if clean_name.to_lowercase().ends_with(".json") {
            clean_name
        } else {
            format!("{}.json", clean_name)
        };
        let cfg = load_library_config(&state.data_dir);
        if cfg.library_path.is_none() {
            let dir = state.root_dir.join("song-id-assigner");
            let _ = fs::create_dir_all(&dir);
            dir.join(file_name)
        } else {
            get_library_path(&state.root_dir, &state.data_dir)
        }
    } else {
        get_library_path(&state.root_dir, &state.data_dir)
    };

    if let Some(parent) = lib_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Veiligheidscheck: voorkom per ongeluk leegmaken
    let mut existing_count = 0;
    if lib_path.exists() {
        if let Ok(c) = fs::read_to_string(&lib_path) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&c) {
                if let Some(arr) = parsed.get("songs").and_then(|v| v.as_array()) {
                    existing_count = arr.len();
                }
            }
        }
    }
    if existing_count > 50 && clean.len() < 5 {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "error": format!("Weigering: bestand heeft {} liederen, maar payload maar {}. Bewuste leegmaak? Verwijder eerst {}.", existing_count, clean.len(), file_param),
            })),
        )
            .into_response();
    }

    let backup_path = format!("{}.bak", lib_path.to_string_lossy());
    if lib_path.exists() {
        let _ = fs::copy(&lib_path, &backup_path);
    }

    let schema_ver = data
        .get("schemaVersion")
        .and_then(|v| v.as_i64())
        .unwrap_or(1);
    let updated_at = data
        .get("updatedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));

    let out = json!({
        "schemaVersion": schema_ver,
        "updatedAt": updated_at,
        "songs": clean,
    });

    if let Ok(pretty) = serde_json::to_string_pretty(&out) {
        if let Err(e) = fs::write(&lib_path, pretty) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": e.to_string() })),
            )
                .into_response();
        }
    }

    let count = clean.len();
    let file_name = lib_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let path_str = lib_path.to_string_lossy().to_string();

    state.system_manager.log(&format!("Library opgeslagen: {} songs → {}", count, file_name));

    Json(json!({
        "success": true,
        "count": count,
        "file": file_name,
        "path": path_str,
        "backup": backup_path,
    }))
    .into_response()
}

// ── Status & Logs ───────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SystemManager {
    log_buffer: Arc<Mutex<Vec<String>>>,
    start_time: std::time::Instant,
    started_at_utc: chrono::DateTime<Utc>,
}

impl SystemManager {
    pub fn new() -> Self {
        Self {
            log_buffer: Arc::new(Mutex::new(Vec::new())),
            start_time: std::time::Instant::now(),
            started_at_utc: Utc::now(),
        }
    }

    pub fn log(&self, msg: &str) {
        let line = format!("[{}] {}", Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), msg);
        let mut buf = self.log_buffer.lock().unwrap();
        buf.push(line);
        if buf.len() > 50 {
            buf.remove(0);
        }
        println!("  {}", msg);
    }

    pub fn get_logs(&self) -> Vec<String> {
        self.log_buffer.lock().unwrap().clone()
    }

    pub fn uptime_sec(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }

    pub fn started_at(&self) -> String {
        self.started_at_utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }
}

pub async fn status_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let uptime = state.system_manager.uptime_sec();
    let logs = state.system_manager.get_logs();
    let count = state.request_count.load(std::sync::atomic::Ordering::Relaxed);

    // Git update check
    let mut update = json!({ "update_available": false, "behind_count": 0, "branch": "master" });
    let root = state.root_dir.clone();
    if root.join(".git").exists() {
        if let Ok(branch_out) = silent_git_cmd()
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&root)
            .output()
            .await
        {
            let branch = String::from_utf8_lossy(&branch_out.stdout).trim().to_string();
            if !branch.is_empty() {
                if let Ok(count_out) = silent_git_cmd()
                    .args(["rev-list", "--count", &format!("HEAD..origin/{}", branch)])
                    .current_dir(&root)
                    .output()
                    .await
                {
                    let count_str = String::from_utf8_lossy(&count_out.stdout).trim().to_string();
                    let behind_count: u64 = count_str.parse().unwrap_or(0);
                    update = json!({
                        "update_available": behind_count > 0,
                        "behind_count": behind_count,
                        "branch": branch,
                    });
                }
            }
        }
    }

    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string());

    let services = vec![json!({
        "key": "server",
        "label": "Ichtus Server (Rust Axum)",
        "state": "running",
        "pid": std::process::id(),
        "uptime_sec": uptime,
        "restart_count": 0,
        "last_exit_code": Value::Null,
        "default_port": 8080,
        "log_path": "logs/service-output.log",
    })];

    Json(json!({
        "service": "ichtus-spa",
        "status": "ok",
        "pid": std::process::id(),
        "uptime_sec": uptime,
        "started_at": state.system_manager.started_at(),
        "requests_served": count,
        "hostname": hostname,
        "version": env!("CARGO_PKG_VERSION"),
        "services": services,
        "update": update,
        "log_tail": logs,
        "log_tail_size": logs.len(),
        "log_buffer_capacity": 50,
        "timestamp": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

pub async fn logs_handler(
    State(state): State<ServerState>,
    axum::extract::Path(key): axum::extract::Path<String>,
) -> impl IntoResponse {
    let logs = state.system_manager.get_logs();
    let tail: Vec<Value> = logs
        .into_iter()
        .map(|line| {
            json!({
                "ts": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "line": line,
            })
        })
        .collect();

    Json(json!({ "tail": tail, "key": key }))
}

pub async fn restart_handler(
    State(state): State<ServerState>,
    axum::extract::Path(key): axum::extract::Path<String>,
) -> impl IntoResponse {
    state.system_manager.log(&format!("restart requested for: {}", key));
    Json(json!({
        "success": true,
        "message": format!("Restart {} aangevraagd. Server herstart binnen 500ms...", key),
    }))
}

pub async fn restart_all_handler(State(state): State<ServerState>) -> impl IntoResponse {
    state.system_manager.log("restart-all requested");
    Json(json!({
        "success": true,
        "message": "Server herstart binnen 500ms...",
    }))
}

pub async fn check_update_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let root = state.root_dir.clone();
    let mut branch = "master".to_string();
    let mut behind_count = 0;

    if root.join(".git").exists() {
        if let Ok(branch_out) = silent_git_cmd()
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&root)
            .output()
            .await
        {
            let b = String::from_utf8_lossy(&branch_out.stdout).trim().to_string();
            if !b.is_empty() {
                branch = b;
            }
        }

        let _ = silent_git_cmd()
            .args(["fetch", "origin"])
            .current_dir(&root)
            .output()
            .await;

        if let Ok(count_out) = silent_git_cmd()
            .args(["rev-list", "--count", &format!("HEAD..origin/{}", branch)])
            .current_dir(&root)
            .output()
            .await
        {
            let count_str = String::from_utf8_lossy(&count_out.stdout).trim().to_string();
            behind_count = count_str.parse().unwrap_or(0);
        }
    }

    Json(json!({
        "update_available": behind_count > 0,
        "behind_count": behind_count,
        "branch": branch,
        "current_version": env!("CARGO_PKG_VERSION"),
        "version_name": "Ichtus Workspace",
        "latest_tag": Value::Null,
        "head_remote": Value::Null,
        "commits": [],
        "checked_at": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

pub async fn check_update_now_handler() -> impl IntoResponse {
    Json(json!({ "success": true, "message": "Update check gestart." }))
}

pub async fn update_git_handler(State(state): State<ServerState>) -> impl IntoResponse {
    state.system_manager.log("git pull aangevraagd");
    let root = state.root_dir.clone();

    let fetch_out = silent_git_cmd()
        .args(["fetch", "origin"])
        .current_dir(&root)
        .output()
        .await;

    let pull_out = silent_git_cmd()
        .args(["pull"])
        .current_dir(&root)
        .output()
        .await;

    let success = fetch_out.as_ref().map(|o| o.status.success()).unwrap_or(false)
        && pull_out.as_ref().map(|o| o.status.success()).unwrap_or(false);

    let output = match pull_out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(e) => e.to_string(),
    };

    let msg = if success { "git pull voltooid." } else { "git pull had fouten." };

    if success {
        state.ws_hub.broadcast("app:update", json!({ "state": "pulled", "success": true }));
    } else {
        state.ws_hub.broadcast("app:update", json!({ "state": "failed", "success": false, "message": msg }));
    }

    Json(json!({
        "success": success,
        "exit_code": if success { 0 } else { 1 },
        "output": output,
        "message": msg,
    }))
}
