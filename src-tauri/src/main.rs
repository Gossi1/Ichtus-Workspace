// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server;

use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_mode")]
    pub mode: String, // "host" of "client"
    #[serde(default = "default_host_address")]
    pub host_address: String, // bijv. "127.0.0.1" of "192.168.1.50"
}

fn default_mode() -> String {
    "host".to_string()
}

fn default_host_address() -> String {
    "127.0.0.1".to_string()
}

fn get_data_dir() -> PathBuf {
    if let Some(mut app_data) = dirs::data_dir() {
        app_data.push("Ichtus");
        if !app_data.exists() {
            let _ = fs::create_dir_all(&app_data);
        }
        app_data
    } else {
        PathBuf::from(".")
    }
}

fn get_config_path() -> PathBuf {
    get_data_dir().join("app-config.json")
}

fn load_app_config() -> Option<AppConfig> {
    let path = get_config_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&data) {
                return Some(cfg);
            }
        }
    }
    None
}

fn save_app_config(cfg: &AppConfig) {
    let path = get_config_path();
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(path, json);
    }
}

fn find_app_dir(app_handle: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir.parent().unwrap().to_path_buf();
    }

    if let Ok(resource_path) = app_handle.path().resource_dir() {
        let bundled_app = resource_path.join("app");
        if bundled_app.exists() {
            return bundled_app;
        }
    }

    env::current_exe()
        .map(|p| p.parent().unwrap_or(Path::new(".")).to_path_buf())
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn check_port_open(host: &str, port: u16) -> bool {
    let addr = format!("{}:{}", host, port);
    if let Ok(mut addrs) = std::net::ToSocketAddrs::to_socket_addrs(&addr) {
        if let Some(sock_addr) = addrs.next() {
            return TcpStream::connect_timeout(&sock_addr, Duration::from_millis(200)).is_ok();
        }
    }
    false
}

fn start_app_workflow(
    handle: AppHandle,
    config: AppConfig,
) {
    let window_opt = handle.get_webview_window("main");
    if window_opt.is_none() {
        return;
    }
    let window = window_opt.unwrap();

    thread::spawn(move || {
        if config.mode == "host" {
            // 100% Native Rust Axum server op poort 8080 (of 8090 als dev/bezet)
            let public_port: u16 = if check_port_open("127.0.0.1", 8080) {
                8090
            } else {
                8080
            };

            let _ = window.eval(&format!(
                "if (window.ichtusStatus) window.ichtusStatus('Rust server op poort {} starten…');",
                public_port
            ));

            if !check_port_open("127.0.0.1", public_port) {
                let work_dir = find_app_dir(&handle);
                let data_dir = get_data_dir();
                tauri::async_runtime::spawn(async move {
                    let handle_clone = handle.clone();
                    if let Err(err) = server::start_axum_server(work_dir, data_dir, public_port, Some(handle_clone)).await {
                        eprintln!("[AXUM] Fout bij starten Rust HTTP server: {}", err);
                    }
                });
            }

            // Wacht tot de Rust server luistert
            let mut attempts = 0;
            let mut is_ready = false;
            while attempts < 60 {
                if check_port_open("127.0.0.1", public_port) {
                    is_ready = true;
                    break;
                }
                thread::sleep(Duration::from_millis(250));
                attempts += 1;
            }

            if is_ready {
                let spa_url = format!("http://localhost:{}/Ichtus_SPA/", public_port);
                println!("[TAURI] Host gereed (100% Native Rust Axum)! Navigeren naar {}", spa_url);
                let _ = window.eval(&format!("window.location.href = '{}';", spa_url));
            } else {
                let err_msg = format!(
                    "Timeout: Server op poort {} reageert niet na 15 seconden.",
                    public_port
                );
                let _ = window.eval(&format!(
                    "if (window.ichtusError) window.ichtusError({});",
                    serde_json::to_string(&err_msg).unwrap_or_default()
                ));
            }
        } else {
            // Client mode: verbinden met host
            let host = config.host_address;
            let target_port: u16 = 8080;
            println!(
                "[TAURI] Client-modus: wachten op host {}:{}...",
                host, target_port
            );

            let _ = window.eval(&format!(
                "if (window.ichtusStatus) window.ichtusStatus('Verbinden met Beamer PC op {}…');",
                host
            ));

            let mut attempts = 0;
            let mut connected = false;
            while attempts < 40 {
                if check_port_open(&host, target_port) {
                    connected = true;
                    break;
                }
                thread::sleep(Duration::from_millis(500));
                attempts += 1;
            }

            if connected {
                let remote_url = format!("http://{}:{}/Ichtus_SPA/", host, target_port);
                println!("[TAURI] Verbonden met host! Navigeren naar {}", remote_url);
                let safe_url = serde_json::to_string(&remote_url).unwrap_or_default();
                let _ = window.eval(&format!("window.location.href = {};", safe_url));
            } else {
                let err_msg = format!(
                    "Kon niet verbinden met Beamer PC op {}:{}. Controleer of de Beamer PC aan staat en verbonden is met hetzelfde netwerk.",
                    host, target_port
                );
                let _ = window.eval(&format!(
                    "if (window.ichtusError) window.ichtusError({});",
                    serde_json::to_string(&err_msg).unwrap_or_default()
                ));
            }
        }
    });
}

#[tauri::command]
fn save_mode(
    mode: String,
    host_address: Option<String>,
    #[allow(non_snake_case)]
    hostAddress: Option<String>,
    handle: AppHandle,
) -> Result<(), String> {
    let resolved_host = host_address.or(hostAddress).unwrap_or_else(default_host_address);
    let trimmed_host = resolved_host.trim();

    if trimmed_host.parse::<std::net::IpAddr>().is_err()
        && trimmed_host != "localhost"
        && !trimmed_host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err("Ongeldig host IP-adres of computernaam".to_string());
    }

    println!(
        "[TAURI] Modus opslaan: mode={}, host={:?}",
        mode, trimmed_host
    );
    let cfg = AppConfig {
        mode,
        host_address: trimmed_host.to_string(),
    };
    save_app_config(&cfg);
    start_app_workflow(handle, cfg);
    Ok(())
}

#[tauri::command]
async fn check_and_install_update(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    println!("[TAURI-UPDATER] Handmatige updatecontrole gestart...");
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            println!(
                "[TAURI-UPDATER] Nieuwe update gevonden: v{}!",
                update.version
            );
            update
                .download_and_install(|_chunk_length, _content_length| {}, || {})
                .await
                .map_err(|e| format!("Installatiefout: {}", e))?;

            Ok(format!("Update v{} succesvol geïnstalleerd. Start opnieuw op om toe te passen.", update.version))
        }
        Ok(None) => Ok("Je draait al de nieuwste versie.".to_string()),
        Err(e) => Err(format!("Fout bij controleren op updates: {}", e)),
    }
}

#[tauri::command]
async fn open_worshiptools_login(app: AppHandle) -> Result<String, String> {
    if let Some(win) = app.get_webview_window("worshiptools_login") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok("Venster reeds geopend".into());
    }

    let init_script = r#"
        (function() {
            console.log('[WT-EXTRACTOR] Token extractor injected');

            function reportToken(tok, accId) {
                if (!tok || tok.length < 40) return;
                console.log('[WT-EXTRACTOR] Token gevonden! Doorgeven aan server...');
                fetch('http://127.0.0.1:8080/api/worshiptools/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiToken: tok, accountId: accId })
                }).then(function(r) {
                    if (r.ok) {
                        console.log('[WT-EXTRACTOR] Token succesvol opgeslagen op de server!');
                    }
                }).catch(function(err) {
                    console.error('[WT-EXTRACTOR] Fout bij doorgeven:', err);
                });
            }

            // 1. Hook window.fetch
            var origFetch = window.fetch;
            window.fetch = function() {
                try {
                    var args = arguments;
                    var url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                    var opts = args[1] || {};
                    var headers = opts.headers || {};
                    var auth = '';
                    if (headers instanceof Headers) {
                        auth = headers.get('Authorization') || headers.get('authorization') || '';
                    } else if (typeof headers === 'object') {
                        auth = headers['Authorization'] || headers['authorization'] || '';
                    }
                    if (auth && auth.indexOf('Bearer eyJ') === 0) {
                        var token = auth.replace(/^Bearer\s+/i, '').trim();
                        var acc = null;
                        var m = url.match(/account\/([a-f0-9\-]+)/i);
                        if (m) acc = m[1];
                        reportToken(token, acc);
                    }
                } catch(e) {}
                return origFetch.apply(this, arguments);
            };

            // 2. Hook XMLHttpRequest
            var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
                try {
                    if (header && header.toLowerCase() === 'authorization' && value && value.indexOf('Bearer eyJ') === 0) {
                        var token = value.replace(/^Bearer\s+/i, '').trim();
                        reportToken(token, null);
                    }
                } catch(e) {}
                return origSetHeader.apply(this, arguments);
            };

            // 3. Scan localStorage
            setInterval(function() {
                try {
                    for (var i = 0; i < localStorage.length; i++) {
                        var k = localStorage.key(i);
                        var v = localStorage.getItem(k);
                        if (v && v.indexOf('eyJ') !== -1 && (v.indexOf('wePlanning') !== -1 || v.indexOf('user.info.read') !== -1)) {
                            try {
                                var parsed = JSON.parse(v);
                                var token = parsed.token || parsed.accessToken || parsed.idToken || parsed.jwt;
                                if (token && typeof token === 'string' && token.indexOf('eyJ') === 0) {
                                    reportToken(token, null);
                                }
                            } catch(e) {
                                if (v.indexOf('eyJ') === 0) reportToken(v, null);
                            }
                        }
                    }
                } catch(e) {}
            }, 1500);
        })();
    "#;

    let target_url: tauri::Url = "https://planning.worshiptools.com/app/"
        .parse()
        .map_err(|e: <tauri::Url as std::str::FromStr>::Err| e.to_string())?;

    let win = WebviewWindowBuilder::new(
        &app,
        "worshiptools_login",
        WebviewUrl::External(target_url),
    )
    .title("WorshipTools Inloggen — Ichtus Workspace")
    .inner_size(960.0, 720.0)
    .initialization_script(init_script)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.show();
    let _ = win.set_focus();

    Ok("WorshipTools venster geopend".into())
}

#[tauri::command]
async fn close_worshiptools_login(app: AppHandle) -> Result<String, String> {
    if let Some(win) = app.get_webview_window("worshiptools_login") {
        let _ = win.close();
        return Ok("Venster gesloten".into());
    }
    Ok("Geen venster actief".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        


        .invoke_handler(tauri::generate_handler![save_mode, check_and_install_update, open_worshiptools_login, close_worshiptools_login])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Tray menu setup
            let item_show =
                MenuItem::with_id(&handle, "show", "Open Ichtus Workspace", true, None::<&str>)?;
            let item_reload = MenuItem::with_id(&handle, "reload", "Herladen", true, None::<&str>)?;
            let item_quit = MenuItem::with_id(&handle, "quit", "Afsluiten", true, None::<&str>)?;

            let tray_menu = Menu::with_items(&handle, &[&item_show, &item_reload, &item_quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .tooltip("Ichtus Workspace")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "reload" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.eval("if (window.ichtusDevReload) { window.ichtusDevReload(); } else { window.location.reload(); }");
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(&handle)?;

            let init_script = if cfg!(debug_assertions) {
                "window.__ICHTUS_DESKTOP__ = true; window.__ICHTUS_DEV__ = true;"
            } else {
                "window.__ICHTUS_DESKTOP__ = true;"
            };

            let window =
                WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                    .title(if cfg!(debug_assertions) { "Ichtus Workspace [DEV]" } else { "Ichtus Workspace" })
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(900.0, 600.0)
                    .initialization_script(init_script)
                    .build()?;

            let handle_for_init = handle.clone();

            if let Some(cfg) = load_app_config() {
                start_app_workflow(handle_for_init, cfg);
            } else {
                let win_clone = window.clone();
                let handle_fallback = handle_for_init.clone();

                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(400));
                    let _ = win_clone
                        .eval("if (window.ichtusShowSetup) window.ichtusShowSetup('127.0.0.1');");

                    // Fallback polling mocht IPC invoke geblokkeerd zijn door capabilities
                    for _ in 0..1200 {
                        thread::sleep(Duration::from_millis(250));
                        if let Some(cfg) = load_app_config() {
                            println!("[TAURI] Config gedetecteerd via save_mode!");
                            start_app_workflow(handle_fallback, cfg);
                            return;
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use serde_json::json;
    use tauri_plugin_updater::UpdaterExt;

    const TEST_PAYLOAD: &[u8] = b"ICHTUS_TEST_UPDATE_PAYLOAD_V3_1_0";
    const VALID_SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSWkU5SUMxaW9JVHUvdzUxV2hwR0JLR2pXalArN0lMd3BFSDRlOXh6b1hFTzFyNFFwNlVTMTBiT0V0ZElHRWY2bStEaFZqZzk4VHhJaE5SZTZjMzY2QmJOUGQ1UTBRN0FjPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyNTI2Mzk4CWZpbGU6dGVzdF9wYXlsb2FkLmJpbgp5em9OZGxoVkpHVjNBV0tSZUZsZGZwNkxoRHVsemxnQWYzMVFDck1QUThLNEpaYXVCQlBXcHllelR6TndNdEVhVXVGNGNiUGFHd0dsR3dSeWpNWlhBQT09Cg==";
    const BAD_SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSWkU5SUMxaW9JVHUvdzUxV2hwR0JLR2pXalArN0lMd3BFSDRlOXh6b1hFTzFyNFFwNlVTMTBiT0V0ZElHRWY2bStEaFZqZzk4VHhJaE5SZTZjMzY2QmJOUGQ1UTBRN0FjPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyNTI2Mzk4CWZpbGU6dGVzdF9wYXlsb2FkLmJpbgpBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE9Cg==";

    #[tokio::test]
    async fn test_tauri_v2_updater_workflow() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("failed to bind mock server");
        let addr = listener.local_addr().unwrap();

        let router = Router::new()
            .route(
                "/latest.json",
                get(move || async move {
                    Json(json!({
                        "version": "3.1.0",
                        "notes": "Test release v3.1.0 for Ichtus Workspace",
                        "pub_date": "2026-10-20T20:00:00Z",
                        "platforms": {
                            "windows-x86_64": {
                                "signature": VALID_SIG,
                                "url": format!("http://{}/download/payload.bin", addr)
                            }
                        }
                    }))
                }),
            )
            .route(
                "/latest_uptodate.json",
                get(move || async move {
                    Json(json!({
                        "version": "3.0.3",
                        "notes": "Already on this version",
                        "pub_date": "2026-10-20T20:00:00Z",
                        "platforms": {
                            "windows-x86_64": {
                                "signature": VALID_SIG,
                                "url": format!("http://{}/download/payload.bin", addr)
                            }
                        }
                    }))
                }),
            )
            .route(
                "/latest_bad_sig.json",
                get(move || async move {
                    Json(json!({
                        "version": "3.1.0",
                        "notes": "Release with forged signature",
                        "pub_date": "2026-10-20T20:00:00Z",
                        "platforms": {
                            "windows-x86_64": {
                                "signature": BAD_SIG,
                                "url": format!("http://{}/download/payload.bin", addr)
                            }
                        }
                    }))
                }),
            )
            .route(
                "/download/payload.bin",
                get(|| async { TEST_PAYLOAD }),
            );

        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(tauri::generate_context!())
            .expect("failed to build mock app with updater plugin");

        let handle = app.handle();

        // 1. New version available -> check() succeeds & detects v3.1.0
        let updater_v310 = handle
            .updater_builder()
            .endpoints(vec![format!("http://{}/latest.json", addr).parse().unwrap()])
            .unwrap()
            .build()
            .expect("failed to build updater instance");

        let update = updater_v310.check().await.expect("update check should succeed");
        assert!(update.is_some(), "Update should be detected for newer version 3.1.0");
        let update = update.unwrap();
        assert_eq!(update.version, "3.1.0");
        assert_eq!(update.current_version, "3.0.3");
        println!("[TEST] Update detected: current={} -> target={}", update.current_version, update.version);

        // 2. Download artifact & verify minisign signature matches pubkey
        let downloaded_bytes = update
            .download(|chunk_len, total| {
                println!("[TEST] Download chunk: {} bytes (total: {:?})", chunk_len, total);
            }, || {
                println!("[TEST] Download completed, verifying minisign signature...");
            })
            .await
            .expect("download and signature verification must succeed with valid ichtus.key signature");

        assert_eq!(downloaded_bytes, TEST_PAYLOAD, "Downloaded payload must match expected bytes");
        println!("[TEST] Minisign signature verified successfully against pubkey!");

        // 3. Already up to date (version 3.0.0) -> check() returns None
        let updater_uptodate = handle
            .updater_builder()
            .endpoints(vec![format!("http://{}/latest_uptodate.json", addr).parse().unwrap()])
            .unwrap()
            .build()
            .expect("failed to build updater instance");

        let uptodate_res = updater_uptodate.check().await.expect("check should succeed");
        assert!(uptodate_res.is_none(), "When server version equals current version, no update should be returned");
        println!("[TEST] Already up-to-date check verified (returns None).");

        // 4. Tampered signature rejection -> download() must fail verification
        let updater_bad_sig = handle
            .updater_builder()
            .endpoints(vec![format!("http://{}/latest_bad_sig.json", addr).parse().unwrap()])
            .unwrap()
            .build()
            .expect("failed to build updater instance");

        let bad_sig_update = updater_bad_sig
            .check()
            .await
            .expect("check should succeed")
            .expect("update should be found");

        let bad_sig_res = bad_sig_update.download(|_, _| {}, || {}).await;
        assert!(
            bad_sig_res.is_err(),
            "Tampered signature must be rejected by minisign verification"
        );
        println!("[TEST] Security check: tampered signature correctly rejected!");
    }
}

