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
                    if let Err(err) = server::start_axum_server(work_dir, data_dir, public_port).await {
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
                let _ = window.eval(&format!("window.location.href = '{}';", remote_url));
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
fn save_mode(mode: String, host_address: Option<String>, handle: AppHandle) -> Result<(), String> {
    println!(
        "[TAURI] Modus opslaan: mode={}, host={:?}",
        mode, host_address
    );
    let cfg = AppConfig {
        mode,
        host_address: host_address.unwrap_or_else(default_host_address),
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![save_mode, check_and_install_update])
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
                            let _ = win.eval("window.location.reload();");
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

            let window =
                WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                    .title("Ichtus Workspace")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(900.0, 600.0)
                    .initialization_script("window.__ICHTUS_DESKTOP__ = true;")
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
