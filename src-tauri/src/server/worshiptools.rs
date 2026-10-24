use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Datelike, Local, NaiveDateTime, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use super::{ws::WsHub, ServerState};

const MAX_PAGES: usize = 5;
const CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const SONG_CACHE_TTL: Duration = Duration::from_secs(60);
const PEOPLE_SYNC_TTL: Duration = Duration::from_secs(30 * 60);

const DAGNAMEN: [&str; 7] = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const MAANDEN: [&str; 12] = [
    "jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec",
];

// ── Role Mapping ────────────────────────────────────────────────────────
#[derive(Clone, Debug)]
struct RoleInfo {
    role: &'static str,
    team: &'static str,
    team_order: u32,
    role_order: u32,
}

fn get_role_map() -> HashMap<&'static str, RoleInfo> {
    let mut map = HashMap::new();

    // Tech Team (order 1)
    map.insert("cbb79b68-2e6f-46e4-9d32-917a71d8236e", RoleInfo { role: "Tech Director", team: "Tech Team", team_order: 1, role_order: 1 });
    map.insert("bfd25f3f-ef53-4a7b-813a-fdede2b1f0b8", RoleInfo { role: "Audio", team: "Tech Team", team_order: 1, role_order: 2 });
    map.insert("63354086-2a9d-451f-ab86-75d0f67f68ae", RoleInfo { role: "Beamer", team: "Tech Team", team_order: 1, role_order: 3 });
    map.insert("412d2989-bd3a-4988-8d09-3f7fd4367843", RoleInfo { role: "Stream", team: "Tech Team", team_order: 1, role_order: 4 });
    map.insert("7c7461bd-bfd0-4215-a180-e376ffb8d1b0", RoleInfo { role: "Lighting", team: "Tech Team", team_order: 1, role_order: 5 });
    map.insert("d7b38845-2e13-4a56-86e6-69c49ff4c6f3", RoleInfo { role: "In-Ear Mixer", team: "Tech Team", team_order: 1, role_order: 6 });
    map.insert("84a10f22-52ef-43cc-9025-f3a3ccc2ac85", RoleInfo { role: "Backstage Assistant", team: "Tech Team", team_order: 1, role_order: 7 });

    // Worship Team (order 2)
    map.insert("da8c7f47-c974-41ee-ab2a-3809f8f5d26e", RoleInfo { role: "Worship Leader", team: "Worship Team", team_order: 2, role_order: 1 });
    map.insert("9ccf7768-505d-4612-b058-0c6b5a773b4e", RoleInfo { role: "Vocalist", team: "Worship Team", team_order: 2, role_order: 2 });
    map.insert("18645fa3-d48a-4c48-b51a-afd3652f3927", RoleInfo { role: "Piano", team: "Worship Team", team_order: 2, role_order: 3 });
    map.insert("dd360357-71f6-4892-8405-5d748080c6fd", RoleInfo { role: "Keys", team: "Worship Team", team_order: 2, role_order: 4 });
    map.insert("5799674f-da38-4b6a-9825-32e41d2c8755", RoleInfo { role: "Guitar", team: "Worship Team", team_order: 2, role_order: 5 });
    map.insert("ab4bc739-d984-45af-929a-53a2673876a7", RoleInfo { role: "Electric Guitar", team: "Worship Team", team_order: 2, role_order: 6 });
    map.insert("ecf3052e-115b-40e0-a247-6b9772722296", RoleInfo { role: "Bass Guitar", team: "Worship Team", team_order: 2, role_order: 7 });
    map.insert("5530795a-bd30-454e-99fe-a5073c93b620", RoleInfo { role: "Drums", team: "Worship Team", team_order: 2, role_order: 8 });
    map.insert("36b4098b-096e-4e94-ad3e-f51b35a8e670", RoleInfo { role: "Saxophone", team: "Worship Team", team_order: 2, role_order: 9 });

    map
}

// ── Types ───────────────────────────────────────────────────────────────
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WtConfig {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub api_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientService {
    pub id: String,
    pub name: String,
    pub datetime: String,
    #[serde(rename = "displayDate")]
    pub display_date: String,
    pub time: String,
    #[serde(rename = "isToday")]
    pub is_today: bool,
    #[serde(rename = "isPast")]
    pub is_past: bool,
    #[serde(rename = "cuesCount")]
    pub cues_count: usize,
    pub rehearsals: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClientSong {
    pub position: usize,
    #[serde(rename = "cueId")]
    pub cue_id: String,
    #[serde(rename = "songId", skip_serializing_if = "Option::is_none")]
    pub song_id: Option<String>,
    pub title: String,
    pub key: String,
    pub bpm: Option<i64>,
    pub meter: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LibrarySong {
    #[serde(rename = "songId")]
    pub song_id: String,
    pub title: String,
    pub key: String,
    pub bpm: Option<i64>,
    pub meter: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RosterMember {
    pub role: String,
    #[serde(rename = "roleOrder")]
    pub role_order: u32,
    pub name: String,
    pub status: String,
    #[serde(rename = "userId")]
    pub user_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RosterFlatMember {
    pub name: String,
    pub role: String,
    pub status: String,
    pub team: String,
    #[serde(rename = "userId")]
    pub user_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamRoster {
    pub name: String,
    pub order: u32,
    pub accepted: usize,
    pub declined: usize,
    pub pending: usize,
    pub members: Vec<RosterMember>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RosterCounts {
    pub total: usize,
    pub accepted: usize,
    pub pending: usize,
    pub declined: usize,
}

// ── In-Memory Manager ───────────────────────────────────────────────────
struct CachedToken {
    token: String,
    expires_at: Instant,
}

struct ServicesCacheData {
    upcoming: Vec<ClientService>,
    past: Vec<ClientService>,
    fetched_at: Instant,
}

pub struct LibraryCacheData {
    pub songs: Vec<LibrarySong>,
    pub fetched_at: Instant,
    pub fetched_at_utc: DateTime<Utc>,
}

#[derive(Clone)]
pub struct WorshipToolsManager {
    data_dir: PathBuf,
    ws_hub: WsHub,
    http_client: reqwest::Client,
    token_cache: Arc<Mutex<Option<CachedToken>>>,
    services_cache: Arc<Mutex<Option<ServicesCacheData>>>,
    full_doc_cache: Arc<Mutex<HashMap<String, Value>>>,
    song_doc_cache: Arc<Mutex<HashMap<String, (Value, Instant)>>>,
    song_library_cache: Arc<Mutex<Option<LibraryCacheData>>>,
    people_cache: Arc<Mutex<HashMap<String, String>>>,
    last_people_sync: Arc<Mutex<Option<Instant>>>,
    // Legacy /api/worshiptools/* in-memory cache
    legacy_setlist: Arc<Mutex<Option<(Value, String)>>>,
    legacy_roster: Arc<Mutex<Option<(Value, String)>>>,
    legacy_library: Arc<Mutex<Option<(Value, String)>>>,
}

impl WorshipToolsManager {
    pub fn new(data_dir: PathBuf, ws_hub: WsHub, http_client: reqwest::Client) -> Self {
        let mgr = Self {
            data_dir,
            ws_hub,
            http_client,
            token_cache: Arc::new(Mutex::new(None)),
            services_cache: Arc::new(Mutex::new(None)),
            full_doc_cache: Arc::new(Mutex::new(HashMap::new())),
            song_doc_cache: Arc::new(Mutex::new(HashMap::new())),
            song_library_cache: Arc::new(Mutex::new(None)),
            people_cache: Arc::new(Mutex::new(HashMap::new())),
            last_people_sync: Arc::new(Mutex::new(None)),
            legacy_setlist: Arc::new(Mutex::new(None)),
            legacy_roster: Arc::new(Mutex::new(None)),
            legacy_library: Arc::new(Mutex::new(None)),
        };
        mgr.load_people_cache(false);
        mgr
    }

    pub fn get_config(&self) -> Result<WtConfig, String> {
        let config_paths = [
            self.data_dir.join("server-config.json"),
            PathBuf::from("server-config.json"),
        ];
        let mut from_file = serde_json::Map::new();

        for config_path in &config_paths {
            if config_path.exists() {
                if let Ok(content) = fs::read_to_string(config_path) {
                    if let Ok(Value::Object(map)) = serde_json::from_str(&content) {
                        if let Some(Value::Object(wt)) = map.get("worshiptools") {
                            from_file = wt.clone();
                            break;
                        }
                    }
                }
            }
        }

        let api_key = std::env::var("WT_API_KEY").unwrap_or_else(|_| {
            from_file.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").to_string()
        });
        let account_id = std::env::var("WT_ACCOUNT_ID").unwrap_or_else(|_| {
            from_file.get("accountId").and_then(|v| v.as_str()).unwrap_or("").to_string()
        });
        let refresh_token = std::env::var("WT_REFRESH_TOKEN").unwrap_or_else(|_| {
            from_file.get("refreshToken").and_then(|v| v.as_str()).unwrap_or("").to_string()
        });
        let api_token = std::env::var("WT_API_TOKEN").unwrap_or_else(|_| {
            from_file
                .get("apiToken")
                .or_else(|| from_file.get("wtToken"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        });

        if api_key.is_empty() || account_id.is_empty() || refresh_token.is_empty() {
            return Err(
                "WorshipTools credentials ontbreken. Zet ze in server-config.json (sectie \"worshiptools\") of als env-vars WT_API_KEY/WT_ACCOUNT_ID/WT_REFRESH_TOKEN. Credentials worden nooit hardcoded in de code gezet.".to_string(),
            );
        }

        Ok(WtConfig {
            api_key,
            account_id,
            refresh_token,
            api_token,
        })
    }

    fn update_persisted_refresh_token(&self, new_token: &str) {
        let config_paths = [
            self.data_dir.join("server-config.json"),
            PathBuf::from("server-config.json"),
        ];
        for config_path in &config_paths {
            if config_path.exists() {
                if let Ok(content) = fs::read_to_string(config_path) {
                    if let Ok(mut val) = serde_json::from_str::<Value>(&content) {
                        if let Some(obj) = val.as_object_mut() {
                            if let Some(wt) = obj.get_mut("worshiptools").and_then(|w| w.as_object_mut()) {
                                wt.insert("refreshToken".to_string(), Value::String(new_token.to_string()));
                                if let Ok(pretty) = serde_json::to_string_pretty(&val) {
                                    let _ = fs::write(config_path, pretty);
                                    println!("  [WT-SVC] Refresh token geroteerd — bijgewerkt in {:?}", config_path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pub async fn get_access_token(&self, force: bool) -> Result<String, String> {
        if !force {
            let lock = self.token_cache.lock().unwrap();
            if let Some(cached) = &*lock {
                if cached.expires_at > Instant::now() + Duration::from_secs(60) {
                    return Ok(cached.token.clone());
                }
            }
        }

        let cfg = self.get_config()?;
        let mut last_err = String::new();

        for attempt in 0..2 {
            if attempt > 0 {
                println!("  [WT-SVC] Auth retry ({}/2)…", attempt + 1);
                tokio::time::sleep(Duration::from_millis(1000 * attempt as u64)).await;
            }

            let url = format!(
                "https://securetoken.googleapis.com/v1/token?key={}",
                cfg.api_key
            );
            let form_body = format!(
                "grant_type=refresh_token&refresh_token={}",
                urlencoding::encode(&cfg.refresh_token)
            );

            let resp = match self
                .http_client
                .post(&url)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(form_body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                let snippet: String = text.chars().take(160).collect();
                last_err = format!(
                    "Authenticatie mislukt (HTTP {}). Refresh token verlopen? {}",
                    status, snippet
                );
                continue;
            }

            let data: Value = match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };

            let id_token = match data.get("id_token").and_then(|v| v.as_str()) {
                Some(tok) => tok.to_string(),
                None => {
                    last_err = "Auth-response zonder id_token".to_string();
                    continue;
                }
            };

            let expires_in_sec = data
                .get("expires_in")
                .and_then(|v| {
                    if let Some(s) = v.as_str() {
                        s.parse::<u64>().ok()
                    } else {
                        v.as_u64()
                    }
                })
                .unwrap_or(3600);

            if let Some(new_refresh) = data.get("refresh_token").and_then(|v| v.as_str()) {
                if new_refresh != cfg.refresh_token {
                    self.update_persisted_refresh_token(new_refresh);
                }
            }

            let mut lock = self.token_cache.lock().unwrap();
            *lock = Some(CachedToken {
                token: id_token.clone(),
                expires_at: Instant::now() + Duration::from_secs(expires_in_sec),
            });

            return Ok(id_token);
        }

        Err(last_err)
    }

    fn cuelists_base_url(&self, account_id: &str) -> String {
        format!(
            "https://firestore.googleapis.com/v1/projects/worship-extreme-datastore/databases/(default)/documents/accounts/{}/cuelists",
            account_id
        )
    }

    fn songs_base_url(&self, account_id: &str) -> String {
        format!(
            "https://firestore.googleapis.com/v1/projects/worship-extreme-datastore/databases/(default)/documents/accounts/{}/songs",
            account_id
        )
    }

    async fn fetch_cuelist_documents(&self, access_token: &str, account_id: &str) -> Result<Vec<Value>, (StatusCode, String)> {
        let mut docs = Vec::new();
        let mut page_token: Option<String> = None;

        for _ in 0..MAX_PAGES {
            let mut url = format!("{}?pageSize=100", self.cuelists_base_url(account_id));
            if let Some(ref pt) = page_token {
                url.push_str("&pageToken=");
                url.push_str(&urlencoding::encode(pt));
            }

            let resp = self
                .http_client
                .get(&url)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

            if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
                return Err((resp.status(), format!("Firestore geweigerd (HTTP {})", resp.status())));
            }
            if !resp.status().is_success() {
                return Err((resp.status(), format!("Firestore HTTP {}", resp.status())));
            }

            let data: Value = resp
                .json()
                .await
                .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

            if let Some(list) = data.get("documents").and_then(|v| v.as_array()) {
                docs.extend(list.clone());
            }

            page_token = data.get("nextPageToken").and_then(|v| v.as_str()).map(|s| s.to_string());
            if page_token.is_none() {
                break;
            }
        }

        Ok(docs)
    }

    pub async fn fetch_single_cuelist(&self, access_token: &str, account_id: &str, id: &str) -> Result<Option<Value>, (StatusCode, String)> {
        let url = format!("{}/{}", self.cuelists_base_url(account_id), urlencoding::encode(id));
        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

        if resp.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
            return Err((resp.status(), format!("Firestore geweigerd (HTTP {})", resp.status())));
        }
        if !resp.status().is_success() {
            return Err((resp.status(), format!("Firestore HTTP {}", resp.status())));
        }

        let doc: Value = resp
            .json()
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
        Ok(Some(doc))
    }

    pub async fn fetch_song_document(&self, access_token: &str, account_id: &str, song_id: &str, force: bool) -> Option<Value> {
        if song_id.is_empty() {
            return None;
        }

        if !force {
            let lock = self.song_doc_cache.lock().unwrap();
            if let Some((doc, ts)) = lock.get(song_id) {
                if ts.elapsed() < SONG_CACHE_TTL {
                    return Some(doc.clone());
                }
            }
        }

        let url = format!("{}/{}", self.songs_base_url(account_id), urlencoding::encode(song_id));
        let resp = match self
            .http_client
            .get(&url)
            .bearer_auth(access_token)
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => return None,
        };

        if !resp.status().is_success() {
            return None;
        }

        if let Ok(doc) = resp.json::<Value>().await {
            let mut lock = self.song_doc_cache.lock().unwrap();
            lock.insert(song_id.to_string(), (doc.clone(), Instant::now()));
            Some(doc)
        } else {
            None
        }
    }

    pub fn load_people_cache(&self, force: bool) -> usize {
        let mut cache = self.people_cache.lock().unwrap();
        if !force && !cache.is_empty() {
            return cache.len();
        }

        let cache_files = [
            self.data_dir.join("people_cache.json"),
            PathBuf::from("people_cache.json"),
        ];
        for cache_file in &cache_files {
            if cache_file.exists() {
                if let Ok(content) = fs::read_to_string(cache_file) {
                    if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                        *cache = map;
                        println!("  [WT-SVC] people_cache.json geladen: {} personen", cache.len());
                        return cache.len();
                    }
                }
            }
        }

        cache.len()
    }

    pub fn save_person(&self, user_id: &str, name: &str) -> usize {
        let mut cache = self.people_cache.lock().unwrap();
        cache.insert(user_id.to_string(), name.to_string());
        let count = cache.len();
        let cache_file = self.data_dir.join("people_cache.json");
        if let Ok(pretty) = serde_json::to_string_pretty(&*cache) {
            let _ = fs::write(&cache_file, pretty);
            println!("  [WT-SVC] Persoon opgeslagen in people_cache.json: {} -> {}", user_id, name);
        }
        count
    }

    pub fn save_people_batch(&self, map: &HashMap<String, String>) -> usize {
        let mut cache = self.people_cache.lock().unwrap();
        for (k, v) in map {
            if !k.is_empty() && !v.is_empty() {
                cache.insert(k.clone(), v.clone());
            }
        }
        let count = cache.len();
        let cache_file = self.data_dir.join("people_cache.json");
        if let Ok(pretty) = serde_json::to_string_pretty(&*cache) {
            let _ = fs::write(&cache_file, pretty);
            println!("  [WT-SVC] {} personen opgeslagen in people_cache.json", count);
        }
        count
    }

    pub fn get_people(&self) -> HashMap<String, String> {
        self.load_people_cache(false);
        self.people_cache.lock().unwrap().clone()
    }

    pub async fn sync_people_cache(&self, force: bool) -> HashMap<String, String> {
        self.load_people_cache(force);
        let cfg = match self.get_config() {
            Ok(c) => c,
            Err(_) => return self.people_cache.lock().unwrap().clone(),
        };

        if cfg.api_token.is_empty() {
            let cache = self.people_cache.lock().unwrap().clone();
            if cache.is_empty() {
                println!("  [WT-SVC] Geen WT_API_TOKEN — people-sync overgeslagen, namen vallen terug op user-ID.");
            }
            return cache;
        }

        {
            let last_sync = self.last_people_sync.lock().unwrap();
            let cache = self.people_cache.lock().unwrap();
            if !force && !cache.is_empty() {
                if let Some(ts) = *last_sync {
                    if ts.elapsed() < PEOPLE_SYNC_TTL {
                        return cache.clone();
                    }
                }
            }
        }

        let url = format!("https://api.worship.tools/v1/account/{}/people", cfg.account_id);
        let resp = match self
            .http_client
            .get(&url)
            .bearer_auth(&cfg.api_token)
            .header("Accept", "application/json")
            .timeout(Duration::from_secs(6))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                println!("  [WT-SVC] People-sync mislukt (cache behouden): {}", e);
                return self.people_cache.lock().unwrap().clone();
            }
        };

        if !resp.status().is_success() {
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                println!("  [WT-SVC] People API HTTP 401 — WT_API_TOKEN is verlopen of ongeldig. Genereer een permanent token via WorshipTools Integraties of sla namen direct op.");
            } else {
                println!("  [WT-SVC] People API HTTP {} — cache behouden", resp.status());
            }
            return self.people_cache.lock().unwrap().clone();
        }

        let json_val: Value = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                println!("  [WT-SVC] People JSON parse mislukt: {}", e);
                return self.people_cache.lock().unwrap().clone();
            }
        };

        let new_people: Vec<Value> = if let Some(arr) = json_val.as_array() {
            arr.clone()
        } else if let Some(arr) = json_val.get("data").and_then(|v| v.as_array()) {
            arr.clone()
        } else if let Some(arr) = json_val.get("people").and_then(|v| v.as_array()) {
            arr.clone()
        } else {
            Vec::new()
        };

        let mut updated = 0;
        {
            let mut cache = self.people_cache.lock().unwrap();
            for p in new_people {
                let pid = p.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
                let first = p.get("firstName").and_then(|v| v.as_str()).unwrap_or("").trim();
                let last = p.get("lastName").and_then(|v| v.as_str()).unwrap_or("").trim();
                let full = format!("{} {}", first, last).trim().to_string();

                if !pid.is_empty() && !full.is_empty() {
                    let prev = cache.get(pid);
                    if prev.map(|s| s.as_str()) != Some(&full) {
                        cache.insert(pid.to_string(), full);
                        updated += 1;
                    }
                }
            }

            let mut last_sync = self.last_people_sync.lock().unwrap();
            *last_sync = Some(Instant::now());

            let cache_file = self.data_dir.join("people_cache.json");
            if let Ok(pretty) = serde_json::to_string_pretty(&*cache) {
                let _ = fs::write(cache_file, pretty);
            }
            println!("  [WT-SVC] People gesynchroniseerd: {} personen ({} nieuw/bijgewerkt)", cache.len(), updated);
            cache.clone()
        }
    }

    pub async fn fetch_roster_people(&self, access_token: &str, account_id: &str, cuelist_id: &str) -> Result<Vec<Value>, (StatusCode, String)> {
        let url = format!("{}/{}/people?pageSize=300", self.cuelists_base_url(account_id), urlencoding::encode(cuelist_id));
        let resp = self
            .http_client
            .get(&url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

        if resp.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
            return Err((resp.status(), format!("Firestore geweigerd (HTTP {})", resp.status())));
        }
        if !resp.status().is_success() {
            return Err((resp.status(), format!("Firestore HTTP {}", resp.status())));
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

        Ok(data.get("documents").and_then(|v| v.as_array()).cloned().unwrap_or_default())
    }

    pub async fn refresh_services(&self, force: bool) -> Result<(Vec<ClientService>, Vec<ClientService>), String> {
        if !force {
            let lock = self.services_cache.lock().unwrap();
            if let Some(cached) = &*lock {
                if cached.fetched_at.elapsed() < CACHE_TTL {
                    return Ok((cached.upcoming.clone(), cached.past.clone()));
                }
            }
        }

        let cfg = self.get_config()?;
        let mut token = self.get_access_token(false).await?;
        let docs = match self.fetch_cuelist_documents(&token, &cfg.account_id).await {
            Ok(d) => d,
            Err((status, _)) if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN => {
                token = self.get_access_token(true).await?;
                self.fetch_cuelist_documents(&token, &cfg.account_id)
                    .await
                    .map_err(|(_, e)| e)?
            }
            Err((_, e)) => return Err(e),
        };

        let now_local = Local::now();
        let mut parsed_events = Vec::new();

        {
            let mut full_docs = self.full_doc_cache.lock().unwrap();
            full_docs.clear();

            for doc in docs {
                if let Some(parsed) = parse_event(&doc) {
                    full_docs.insert(parsed.id.clone(), doc.clone());
                    parsed_events.push(parsed);
                }
            }
        }

        let mut upcoming_events: Vec<_> = parsed_events.iter().filter(|s| s.main_dt >= now_local).cloned().collect();
        upcoming_events.sort_by_key(|s| s.main_dt);
        let upcoming_events = upcoming_events.into_iter().take(10).collect::<Vec<_>>();

        let mut past_events: Vec<_> = parsed_events.iter().filter(|s| s.main_dt < now_local).cloned().collect();
        past_events.sort_by_key(|s| std::cmp::Reverse(s.main_dt));
        let past_events = past_events.into_iter().take(4).collect::<Vec<_>>();

        let upcoming = upcoming_events.iter().map(|s| to_client_service(s, now_local)).collect::<Vec<_>>();
        let past = past_events.iter().map(|s| to_client_service(s, now_local)).collect::<Vec<_>>();

        {
            let mut lock = self.services_cache.lock().unwrap();
            *lock = Some(ServicesCacheData {
                upcoming: upcoming.clone(),
                past: past.clone(),
                fetched_at: Instant::now(),
            });
        }

        println!("  [WT-SVC] Cuelists opgehaald — {} komend, {} afgelopen", upcoming.len(), past.len());
        Ok((upcoming, past))
    }

    pub async fn refresh_song_library(&self, force: bool) -> Result<LibraryCacheData, String> {
        if !force {
            let lock = self.song_library_cache.lock().unwrap();
            if let Some(cached) = &*lock {
                if cached.fetched_at.elapsed() < CACHE_TTL {
                    return Ok(LibraryCacheData {
                        songs: cached.songs.clone(),
                        fetched_at: cached.fetched_at,
                        fetched_at_utc: cached.fetched_at_utc,
                    });
                }
            }
        }

        let cfg = self.get_config()?;
        let mut token = self.get_access_token(false).await?;

        let mut docs = Vec::new();
        let mut page_token: Option<String> = None;

        for _ in 0..20 {
            let mut url = format!("{}?pageSize=500", self.songs_base_url(&cfg.account_id));
            if let Some(ref pt) = page_token {
                url.push_str("&pageToken=");
                url.push_str(&urlencoding::encode(pt));
            }

            let resp = match self.http_client.get(&url).bearer_auth(&token).send().await {
                Ok(r) => r,
                Err(e) => return Err(e.to_string()),
            };

            if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
                token = self.get_access_token(true).await?;
                let retry = self
                    .http_client
                    .get(&url)
                    .bearer_auth(&token)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !retry.status().is_success() {
                    return Err(format!("Firestore HTTP {}", retry.status()));
                }
                let data: Value = retry.json().await.map_err(|e| e.to_string())?;
                if let Some(list) = data.get("documents").and_then(|v| v.as_array()) {
                    docs.extend(list.clone());
                }
                page_token = data.get("nextPageToken").and_then(|v| v.as_str()).map(|s| s.to_string());
                if page_token.is_none() {
                    break;
                }
                continue;
            }

            if !resp.status().is_success() {
                return Err(format!("Firestore HTTP {}", resp.status()));
            }

            let data: Value = resp.json().await.map_err(|e| e.to_string())?;
            if let Some(list) = data.get("documents").and_then(|v| v.as_array()) {
                docs.extend(list.clone());
            }

            page_token = data.get("nextPageToken").and_then(|v| v.as_str()).map(|s| s.to_string());
            if page_token.is_none() {
                break;
            }
        }

        let songs: Vec<LibrarySong> = docs.iter().map(to_library_song).collect();
        let data = LibraryCacheData {
            songs: songs.clone(),
            fetched_at: Instant::now(),
            fetched_at_utc: Utc::now(),
        };

        {
            let mut lock = self.song_library_cache.lock().unwrap();
            *lock = Some(LibraryCacheData {
                songs: data.songs.clone(),
                fetched_at: data.fetched_at,
                fetched_at_utc: data.fetched_at_utc,
            });
        }

        println!("  [WT-SVC] Song library: {} liederen opgehaald", songs.len());
        Ok(data)
    }

    pub fn get_stale_library(&self) -> Option<LibraryCacheData> {
        let lock = self.song_library_cache.lock().unwrap();
        lock.as_ref().map(|c| LibraryCacheData {
            songs: c.songs.clone(),
            fetched_at: c.fetched_at,
            fetched_at_utc: c.fetched_at_utc,
        })
    }

    // ── Legacy WorshipTools cache setters/getters ─────────────────────────
    pub fn set_legacy_setlist(&self, payload: Value) {
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        *self.legacy_setlist.lock().unwrap() = Some((payload.clone(), now));
        self.ws_hub.broadcast("wt:setlist", payload);
    }

    pub fn get_legacy_setlist(&self) -> Option<(Value, String)> {
        self.legacy_setlist.lock().unwrap().clone()
    }

    pub fn set_legacy_roster(&self, payload: Value) {
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        *self.legacy_roster.lock().unwrap() = Some((payload.clone(), now));
        self.ws_hub.broadcast("wt:roster", payload);
    }

    pub fn get_legacy_roster(&self) -> Option<(Value, String)> {
        self.legacy_roster.lock().unwrap().clone()
    }

    pub fn set_legacy_library(&self, payload: Value) {
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        *self.legacy_library.lock().unwrap() = Some((payload.clone(), now));
        self.ws_hub.broadcast("wt:library", payload);
    }

    pub fn get_legacy_library(&self) -> Option<(Value, String)> {
        self.legacy_library.lock().unwrap().clone()
    }
}

// ── Parsing Helpers ─────────────────────────────────────────────────────
#[derive(Clone, Debug)]
struct ParsedEvent {
    id: String,
    name: String,
    main_dt: DateTime<Local>,
    rehearsals: Vec<DateTime<Local>>,
    cues_count: usize,
}

fn v_str<'a>(map: &'a Value, key: &str, dflt: &'a str) -> &'a str {
    map.get(key)
        .and_then(|v| v.get("stringValue"))
        .and_then(|v| v.as_str())
        .unwrap_or(dflt)
}

fn v_map_fields<'a>(map: &'a Value, key: &str) -> &'a Value {
    static EMPTY: Value = Value::Null;
    map.get(key)
        .and_then(|v| v.get("mapValue"))
        .and_then(|v| v.get("fields"))
        .unwrap_or(&EMPTY)
}

fn v_arr_values<'a>(map: &'a Value, key: &str) -> &'a [Value] {
    static EMPTY_ARR: Vec<Value> = Vec::new();
    map.get(key)
        .and_then(|v| v.get("arrayValue"))
        .and_then(|v| v.get("values"))
        .and_then(|v| v.as_array())
        .map(|v| v.as_slice())
        .unwrap_or(&EMPTY_ARR)
}

fn parse_iso_local(val: &str) -> Option<DateTime<Local>> {
    if val.is_empty() {
        return None;
    }
    let mut clean = val.replace('Z', "");
    if let Some(idx) = clean.find('.') {
        clean.truncate(idx);
    }
    let formats = [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ];

    for fmt in formats {
        if let Ok(naive) = NaiveDateTime::parse_from_str(&clean, fmt) {
            if let Some(dt) = Local.from_local_datetime(&naive).single() {
                return Some(dt);
            } else if let Some(dt) = Local.from_local_datetime(&naive).earliest() {
                return Some(dt);
            }
        }
    }
    None
}

fn format_dutch(dt: &DateTime<Local>) -> String {
    let weekday_idx = dt.weekday().num_days_from_monday() as usize;
    let dag = DAGNAMEN[weekday_idx];
    let maand = MAANDEN[(dt.month() - 1) as usize];
    format!(
        "{} {:02} {} {} - {:02}:{:02}",
        dag,
        dt.day(),
        maand,
        dt.year(),
        dt.hour(),
        dt.minute()
    )
}

fn format_rehearsal(dt: &DateTime<Local>) -> String {
    let weekday_idx = dt.weekday().num_days_from_monday() as usize;
    let dag = DAGNAMEN[weekday_idx];
    format!("{} {:02}:{:02}", dag, dt.hour(), dt.minute())
}

fn to_client_service(s: &ParsedEvent, now: DateTime<Local>) -> ClientService {
    ClientService {
        id: s.id.clone(),
        name: s.name.clone(),
        datetime: s.main_dt.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        display_date: format_dutch(&s.main_dt),
        time: format!("{:02}:{:02}", s.main_dt.hour(), s.main_dt.minute()),
        is_today: s.main_dt.date_naive() == now.date_naive(),
        is_past: s.main_dt < now,
        cues_count: s.cues_count,
        rehearsals: s.rehearsals.iter().map(format_rehearsal).collect(),
    }
}

fn parse_event(doc: &Value) -> Option<ParsedEvent> {
    let fields = doc.get("fields").unwrap_or(&Value::Null);
    let doc_name = doc.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let doc_id = doc_name.split('/').last().unwrap_or("").to_string();

    let service_obj = v_map_fields(fields, "service");
    let data_obj = v_map_fields(fields, "data");

    // 1. Excluded type IDs
    let service_type_id = v_str(service_obj, "type", "");
    if service_type_id == "f30f3f88-1e83-4e1a-bc60-ef3974a071fb" {
        return None;
    }

    // 2. Naam bepalen
    let name_candidate = v_str(service_obj, "name", "");
    let event_name = if !name_candidate.is_empty() {
        name_candidate
    } else {
        let f_name = v_str(fields, "name", "");
        if !f_name.is_empty() {
            f_name
        } else {
            let cuelist_title = v_str(data_obj, "cuelist_title", "");
            if !cuelist_title.is_empty() {
                cuelist_title
            } else {
                "Kerkdienst"
            }
        }
    };

    // 3. Tijden verwerken
    let times_array = v_arr_values(service_obj, "times");
    let mut parsed_slots = Vec::new();

    for item in times_array {
        let f = item.get("mapValue").and_then(|v| v.get("fields")).unwrap_or(&Value::Null);
        let time_str = v_str(f, "time", "");
        if let Some(dt) = parse_iso_local(time_str) {
            let slot_type = v_str(f, "type", "");
            parsed_slots.push((dt, slot_type.eq_ignore_ascii_case("rehearsal")));
        }
    }

    let (main_dt, rehearsals) = if !parsed_slots.is_empty() {
        let main = parsed_slots
            .iter()
            .rev()
            .find(|(_, is_reh)| !is_reh)
            .map(|(dt, _)| *dt)
            .unwrap_or(parsed_slots.last().unwrap().0);

        let rehs = parsed_slots
            .iter()
            .filter(|(dt, _)| *dt != main)
            .map(|(dt, _)| *dt)
            .collect();
        (Some(main), rehs)
    } else {
        let cuelist_options = v_map_fields(data_obj, "cuelist_options");
        let alt_str = v_str(cuelist_options, "date", "");
        let date_str = if !alt_str.is_empty() {
            alt_str
        } else {
            let post = v_str(fields, "post", "");
            if !post.is_empty() {
                post
            } else {
                doc.get("createTime").and_then(|v| v.as_str()).unwrap_or("")
            }
        };
        (parse_iso_local(date_str), Vec::new())
    };

    let main_dt = main_dt?;
    let cues = v_arr_values(data_obj, "cues");

    Some(ParsedEvent {
        id: doc_id,
        name: event_name.to_string(),
        main_dt,
        rehearsals,
        cues_count: cues.len(),
    })
}

fn to_library_song(doc: &Value) -> LibrarySong {
    let fields = doc.get("fields").unwrap_or(&Value::Null);
    let s_data = v_map_fields(fields, "data");

    let raw_tempo = s_data
        .get("tempo")
        .and_then(|t| t.get("integerValue").or_else(|| t.get("stringValue")))
        .or_else(|| {
            s_data
                .get("bpm")
                .and_then(|b| b.get("integerValue").or_else(|| b.get("stringValue")))
        })
        .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64()));

    let song_id = doc
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .split('/')
        .last()
        .unwrap_or("")
        .to_string();

    let def_key = v_str(s_data, "defaultKey", "");
    let key = if def_key.is_empty() { "—".to_string() } else { def_key.to_string() };

    let time_sig = v_str(s_data, "timeSignature", "");
    let meter = if time_sig.is_empty() { "4/4".to_string() } else { time_sig.to_string() };

    LibrarySong {
        song_id,
        title: v_str(fields, "name", "").to_string(),
        key,
        bpm: raw_tempo,
        meter,
    }
}

pub async fn extract_songs(
    manager: &WorshipToolsManager,
    doc: &Value,
    access_token: &str,
    account_id: &str,
    force: bool,
) -> Vec<ClientSong> {
    let fields = doc.get("fields").unwrap_or(&Value::Null);
    let data_obj = v_map_fields(fields, "data");
    let cues = v_arr_values(data_obj, "cues");
    let song_meta = v_map_fields(data_obj, "songMeta");

    let mut song_docs = Vec::with_capacity(cues.len());
    for cue in cues {
        let f = cue.get("mapValue").and_then(|v| v.get("fields")).unwrap_or(&Value::Null);
        let song_id = f
            .get("cue_foreground")
            .and_then(|m| m.get("mapValue"))
            .and_then(|m| m.get("fields"))
            .and_then(|f| f.get("text"))
            .and_then(|t| t.get("stringValue"))
            .and_then(|s| s.as_str());

        if let Some(sid) = song_id {
            let doc_opt = manager.fetch_song_document(access_token, account_id, sid, force).await;
            song_docs.push(doc_opt);
        } else {
            song_docs.push(None);
        }
    }

    let mut result = Vec::with_capacity(cues.len());
    for (i, cue) in cues.iter().enumerate() {
        let f = cue.get("mapValue").and_then(|v| v.get("fields")).unwrap_or(&Value::Null);
        let cue_id = v_str(f, "cue_id", "").to_string();
        let display_name = v_str(f, "displayName", "Naamloos");

        let meta = v_map_fields(song_meta, &cue_id);
        let s_doc = song_docs.get(i).and_then(|opt| opt.as_ref());
        let s_data = s_doc
            .and_then(|d| d.get("fields"))
            .map(|f| v_map_fields(f, "data"))
            .unwrap_or(&Value::Null);

        // Key: meta override -> master defaultKey -> '—'
        let meta_key = v_str(meta, "key", "");
        let s_key = v_str(s_data, "defaultKey", "");
        let key = if !meta_key.is_empty() && meta_key != "—" && meta_key != "-" {
            meta_key.to_string()
        } else if !s_key.is_empty() {
            s_key.to_string()
        } else if !meta_key.is_empty() {
            meta_key.to_string()
        } else {
            "—".to_string()
        };

        // BPM: meta -> s_data tempo/bpm -> null
        let raw_tempo = meta
            .get("tempo")
            .and_then(|t| t.get("integerValue").or_else(|| t.get("stringValue")))
            .or_else(|| {
                s_data
                    .get("tempo")
                    .and_then(|t| t.get("integerValue").or_else(|| t.get("stringValue")))
            })
            .or_else(|| {
                s_data
                    .get("bpm")
                    .and_then(|b| b.get("integerValue").or_else(|| b.get("stringValue")))
            })
            .and_then(|v| v.as_str().and_then(|s| s.parse::<i64>().ok()).or_else(|| v.as_i64()));

        // Meter: meta -> s_data timeSignature -> '4/4'
        let meta_meter = v_str(meta, "meter", "");
        let s_meter = v_str(s_data, "timeSignature", "");
        let meter = if !meta_meter.is_empty() {
            meta_meter.to_string()
        } else if !s_meter.is_empty() {
            s_meter.to_string()
        } else {
            "4/4".to_string()
        };

        let master_song_id = f
            .get("cue_foreground")
            .and_then(|m| m.get("mapValue"))
            .and_then(|m| m.get("fields"))
            .and_then(|f| f.get("text"))
            .and_then(|t| t.get("stringValue"))
            .and_then(|s| s.as_str())
            .map(|s| s.to_string());

        result.push(ClientSong {
            position: i + 1,
            cue_id,
            song_id: master_song_id,
            title: display_name.to_string(),
            key,
            bpm: raw_tempo,
            meter,
        });
    }

    result
}

fn normalize_status(raw: &str) -> &'static str {
    let lower = raw.to_ascii_lowercase();
    if lower == "accepted" {
        "accepted"
    } else if lower == "declined" {
        "declined"
    } else {
        "pending"
    }
}

pub fn build_roster(people_docs: &[Value], people_names: &HashMap<String, String>) -> Vec<TeamRoster> {
    let role_map = get_role_map();
    let mut teams: HashMap<&'static str, TeamRoster> = HashMap::new();

    for doc in people_docs {
        let f = doc.get("fields").unwrap_or(&Value::Null);
        let user_id = v_str(f, "user", "");
        let role_id = v_str(f, "role", "");
        let status = normalize_status(v_str(f, "status", "pending"));

        let r_info = match role_map.get(role_id) {
            Some(info) => info,
            None => continue,
        };

        let unknown_fallback = if user_id.len() >= 8 {
            format!("Onbekend ({}...)", &user_id[..8])
        } else {
            format!("Onbekend ({})", user_id)
        };

        let name = people_names
            .get(user_id)
            .cloned()
            .unwrap_or(unknown_fallback);

        let team = teams.entry(r_info.team).or_insert_with(|| TeamRoster {
            name: r_info.team.to_string(),
            order: r_info.team_order,
            accepted: 0,
            declined: 0,
            pending: 0,
            members: Vec::new(),
        });

        match status {
            "accepted" => team.accepted += 1,
            "declined" => team.declined += 1,
            _ => team.pending += 1,
        }

        team.members.push(RosterMember {
            role: r_info.role.to_string(),
            role_order: r_info.role_order,
            name,
            status: status.to_string(),
            user_id: user_id.to_string(),
        });
    }

    let mut team_list: Vec<TeamRoster> = teams.into_values().collect();
    team_list.sort_by_key(|t| t.order);

    for t in &mut team_list {
        t.members.sort_by(|a, b| {
            a.role_order
                .cmp(&b.role_order)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
    }

    team_list
}

// ── Axum Handlers ───────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct RefreshQuery {
    pub refresh: Option<String>,
    pub live: Option<String>,
    pub sync: Option<String>,
}

pub async fn people_reload_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let count = state.worshiptools_manager.load_people_cache(true);
    Json(json!({
        "success": true,
        "count": count,
        "message": format!("People cache herladen ({} personen ingeladen)", count),
    }))
}

pub async fn services_handler(
    State(state): State<ServerState>,
    Query(query): Query<RefreshQuery>,
) -> impl IntoResponse {
    let force = query.refresh.as_deref() == Some("1") || query.refresh.as_deref() == Some("true");
    match state.worshiptools_manager.refresh_services(force).await {
        Ok((upcoming, past)) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "upcoming": upcoming,
                "past": past,
                "count": upcoming.len() + past.len(),
            })),
        ),
        Err(err) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "success": false,
                "error": err,
            })),
        ),
    }
}

pub async fn setlist_handler(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Query(query): Query<RefreshQuery>,
) -> impl IntoResponse {
    let force = query.live.as_deref() == Some("1")
        || query.live.as_deref() == Some("true")
        || query.refresh.as_deref() == Some("1")
        || query.refresh.as_deref() == Some("true");

    let cfg = match state.worshiptools_manager.get_config() {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
    };

    let cached_doc = if !force {
        let lock = state.worshiptools_manager.full_doc_cache.lock().unwrap();
        lock.get(&id).cloned()
    } else {
        None
    };

    let (doc, source) = match cached_doc {
        Some(d) => (d, "cache"),
        None => {
            let mut token = match state.worshiptools_manager.get_access_token(false).await {
                Ok(t) => t,
                Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
            };

            let fetched = match state.worshiptools_manager.fetch_single_cuelist(&token, &cfg.account_id, &id).await {
                Ok(Some(d)) => d,
                Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "success": false, "error": "Dienst niet gevonden" }))),
                Err((status, _)) if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN => {
                    token = match state.worshiptools_manager.get_access_token(true).await {
                        Ok(t) => t,
                        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
                    };
                    match state.worshiptools_manager.fetch_single_cuelist(&token, &cfg.account_id, &id).await {
                        Ok(Some(d)) => d,
                        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "success": false, "error": "Dienst niet gevonden" }))),
                        Err((_, e)) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
                    }
                }
                Err((_, e)) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
            };

            state.worshiptools_manager.full_doc_cache.lock().unwrap().insert(id.clone(), fetched.clone());
            (fetched, "live")
        }
    };

    let token = state.worshiptools_manager.get_access_token(false).await.unwrap_or_default();
    let parsed = parse_event(&doc);
    let songs = extract_songs(&state.worshiptools_manager, &doc, &token, &cfg.account_id, force).await;
    let now = Local::now();

    let service_val = if let Some(p) = parsed {
        serde_json::to_value(to_client_service(&p, now)).unwrap()
    } else {
        json!({ "id": id, "name": "Onbekende dienst", "displayDate": "Geen datum" })
    };

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "source": source,
            "service": service_val,
            "songs": songs,
            "count": songs.len(),
        })),
    )
}

pub async fn roster_handler(
    State(state): State<ServerState>,
    Path(id): Path<String>,
    Query(query): Query<RefreshQuery>,
) -> impl IntoResponse {
    let force_people = query.sync.as_deref() == Some("1") || query.sync.as_deref() == Some("true");
    let cfg = match state.worshiptools_manager.get_config() {
        Ok(c) => c,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
    };

    let people = state.worshiptools_manager.sync_people_cache(force_people).await;

    let cached_doc = {
        let lock = state.worshiptools_manager.full_doc_cache.lock().unwrap();
        lock.get(&id).cloned()
    };

    let doc = match cached_doc {
        Some(d) => d,
        None => {
            let mut token = match state.worshiptools_manager.get_access_token(false).await {
                Ok(t) => t,
                Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
            };

            let fetched = match state.worshiptools_manager.fetch_single_cuelist(&token, &cfg.account_id, &id).await {
                Ok(Some(d)) => d,
                Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "success": false, "error": "Dienst niet gevonden" }))),
                Err((status, _)) if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN => {
                    token = match state.worshiptools_manager.get_access_token(true).await {
                        Ok(t) => t,
                        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
                    };
                    match state.worshiptools_manager.fetch_single_cuelist(&token, &cfg.account_id, &id).await {
                        Ok(Some(d)) => d,
                        Ok(None) => return (StatusCode::NOT_FOUND, Json(json!({ "success": false, "error": "Dienst niet gevonden" }))),
                        Err((_, e)) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
                    }
                }
                Err((_, e)) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
            };

            state.worshiptools_manager.full_doc_cache.lock().unwrap().insert(id.clone(), fetched.clone());
            fetched
        }
    };

    let parsed = parse_event(&doc);

    let mut token = match state.worshiptools_manager.get_access_token(false).await {
        Ok(t) => t,
        Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
    };

    let people_docs = match state.worshiptools_manager.fetch_roster_people(&token, &cfg.account_id, &id).await {
        Ok(d) => d,
        Err((status, _)) if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN => {
            token = match state.worshiptools_manager.get_access_token(true).await {
                Ok(t) => t,
                Err(e) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
            };
            match state.worshiptools_manager.fetch_roster_people(&token, &cfg.account_id, &id).await {
                Ok(d) => d,
                Err((_, e)) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
            }
        }
        Err((_, e)) => return (StatusCode::BAD_GATEWAY, Json(json!({ "success": false, "error": e }))),
    };

    let teams = build_roster(&people_docs, &people);
    let mut roster: Vec<RosterFlatMember> = Vec::new();
    let mut declined_count = 0;

    for team in &teams {
        for m in &team.members {
            if m.status == "declined" {
                declined_count += 1;
                continue;
            }
            roster.push(RosterFlatMember {
                name: m.name.clone(),
                role: m.role.clone(),
                status: m.status.clone(),
                team: team.name.clone(),
                user_id: m.user_id.clone(),
            });
        }
    }

    let service_val = if let Some(p) = parsed {
        serde_json::to_value(to_client_service(&p, Local::now())).unwrap()
    } else {
        json!({ "id": id, "name": "Onbekende dienst", "displayDate": "Geen datum" })
    };

    let counts = RosterCounts {
        total: roster.len(),
        accepted: roster.iter().filter(|r| r.status == "accepted").count(),
        pending: roster.iter().filter(|r| r.status == "pending").count(),
        declined: declined_count,
    };

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "service": service_val,
            "teams": teams,
            "roster": roster,
            "counts": counts,
        })),
    )
}

pub async fn library_handler(
    State(state): State<ServerState>,
    Query(query): Query<RefreshQuery>,
) -> impl IntoResponse {
    let force = query.refresh.as_deref() == Some("1") || query.refresh.as_deref() == Some("true");
    match state.worshiptools_manager.refresh_song_library(force).await {
        Ok(data) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "songs": data.songs,
                "count": data.songs.len(),
                "updatedAt": data.fetched_at_utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "source": if data.fetched_at.elapsed() < Duration::from_secs(5) { "live" } else { "cache" },
            })),
        ),
        Err(err) => {
            if let Some(stale) = state.worshiptools_manager.get_stale_library() {
                (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "songs": stale.songs,
                        "count": stale.songs.len(),
                        "updatedAt": stale.fetched_at_utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                        "source": "cache-stale",
                        "warning": err,
                    })),
                )
            } else {
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "success": false,
                        "error": err,
                    })),
                )
            }
        }
    }
}

// ── Legacy /api/worshiptools/* Handlers ────────────────────────────────
pub async fn legacy_post_setlist_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let has_items = body.get("items").is_some();
    let has_structured = body.get("structured").is_some();

    if !has_items && !has_structured {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Ongeldig payload. Verwacht items of structured." })),
        );
    }

    let items = body.get("items").cloned().unwrap_or(Value::Array(Vec::new()));
    let structured = body.get("structured").cloned().unwrap_or(Value::Array(Vec::new()));
    let date = body.get("date").cloned().unwrap_or(Value::Null);
    let song_count = body.get("songCount").cloned().unwrap_or(json!(0));
    let len = structured.as_array().map(|a| a.len()).unwrap_or(0);

    let payload = json!({
        "items": items,
        "structured": structured,
        "date": date,
        "songCount": song_count,
        "source": "chrome-extension",
    });

    state.worshiptools_manager.set_legacy_setlist(payload);
    (StatusCode::OK, Json(json!({ "success": true, "received": len })))
}

pub async fn legacy_get_setlist_handler(State(state): State<ServerState>) -> impl IntoResponse {
    if let Some((data, updated_at)) = state.worshiptools_manager.get_legacy_setlist() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": data,
                "updatedAt": updated_at,
                "source": "cache",
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": false,
            "data": Value::Null,
            "message": "Geen setlist data beschikbaar. Open WorshipTools en sync via de extension.",
        })),
    )
}

pub async fn legacy_post_roster_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let roster = match body.get("roster").and_then(|v| v.as_array()) {
        Some(r) => r.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig payload. Verwacht roster array." })),
            );
        }
    };

    let teams_scanned = body.get("teams_scanned").cloned().unwrap_or(json!(0));
    let len = roster.len();

    // Auto-populate people cache from incoming roster
    let mut extracted_people = HashMap::new();
    for entry in &roster {
        let name = entry.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
        let user_id = entry.get("userId")
            .or_else(|| entry.get("user_id"))
            .or_else(|| entry.get("id"))
            .or_else(|| entry.get("user"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        let id = if user_id.is_empty() {
            if let Some(avatar) = entry.get("avatar_url").or_else(|| entry.get("avatar")).and_then(|v| v.as_str()) {
                if let Some(pos) = avatar.find("/users/") {
                    let sub = &avatar[pos + 7..];
                    sub.split('/').next().unwrap_or("").trim()
                } else {
                    ""
                }
            } else {
                ""
            }
        } else {
            user_id
        };

        if !name.is_empty() && !id.is_empty() && !name.starts_with("Onbekend") {
            extracted_people.insert(id.to_string(), name.to_string());
        }
    }

    if !extracted_people.is_empty() {
        state.worshiptools_manager.save_people_batch(&extracted_people);
    }

    let payload = json!({
        "roster": roster,
        "teams_scanned": teams_scanned,
        "source": "chrome-extension",
    });

    state.worshiptools_manager.set_legacy_roster(payload);
    (StatusCode::OK, Json(json!({ "success": true, "received": len, "people_cached": extracted_people.len() })))
}

pub async fn legacy_get_roster_handler(State(state): State<ServerState>) -> impl IntoResponse {
    if let Some((data, updated_at)) = state.worshiptools_manager.get_legacy_roster() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": data,
                "updatedAt": updated_at,
                "source": "cache",
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": false,
            "data": Value::Null,
            "message": "Geen roster data beschikbaar.",
        })),
    )
}

pub async fn legacy_post_library_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let songs = match body.get("songs").and_then(|v| v.as_array()) {
        Some(s) => s.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ongeldig payload. Verwacht songs array." })),
            );
        }
    };

    let count = body.get("count").cloned().unwrap_or(json!(songs.len()));
    let len = songs.len();

    let payload = json!({
        "songs": songs,
        "count": count,
        "source": "chrome-extension",
    });

    state.worshiptools_manager.set_legacy_library(payload);
    (StatusCode::OK, Json(json!({ "success": true, "received": len })))
}

pub async fn legacy_get_library_handler(State(state): State<ServerState>) -> impl IntoResponse {
    if let Some((data, updated_at)) = state.worshiptools_manager.get_legacy_library() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": data,
                "updatedAt": updated_at,
                "source": "cache",
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": false,
            "data": Value::Null,
            "message": "Geen library data beschikbaar.",
        })),
    )
}

pub async fn legacy_get_status_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let setlist = state.worshiptools_manager.get_legacy_setlist();
    let roster = state.worshiptools_manager.get_legacy_roster();
    let library = state.worshiptools_manager.get_legacy_library();

    Json(json!({
        "setlist": {
            "available": setlist.is_some(),
            "itemCount": setlist.as_ref().and_then(|(d, _)| d.get("structured").and_then(|v| v.as_array()).map(|a| a.len())).unwrap_or(0),
            "date": setlist.as_ref().and_then(|(d, _)| d.get("date").and_then(|v| v.as_str())),
            "updatedAt": setlist.as_ref().map(|(_, ts)| ts.as_str()),
        },
        "roster": {
            "available": roster.is_some(),
            "assignmentCount": roster.as_ref().and_then(|(d, _)| d.get("roster").and_then(|v| v.as_array()).map(|a| a.len())).unwrap_or(0),
            "teamsScanned": roster.as_ref().and_then(|(d, _)| d.get("teams_scanned").and_then(|v| v.as_i64())).unwrap_or(0),
            "updatedAt": roster.as_ref().map(|(_, ts)| ts.as_str()),
        },
        "library": {
            "available": library.is_some(),
            "songCount": library.as_ref().and_then(|(d, _)| d.get("songs").and_then(|v| v.as_array()).map(|a| a.len())).unwrap_or(0),
            "updatedAt": library.as_ref().map(|(_, ts)| ts.as_str()),
        }
    }))
}

#[derive(Deserialize)]
pub struct PeopleSaveRequest {
    #[serde(default, rename = "userId")]
    pub user_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub people: Option<HashMap<String, String>>,
}

pub async fn people_list_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let people = state.worshiptools_manager.get_people();
    Json(json!({
        "success": true,
        "count": people.len(),
        "people": people,
    }))
}

pub async fn people_save_handler(
    State(state): State<ServerState>,
    Json(body): Json<PeopleSaveRequest>,
) -> impl IntoResponse {
    if let Some(map) = body.people {
        let count = state.worshiptools_manager.save_people_batch(&map);
        return Json(json!({ "success": true, "count": count }));
    }

    if let (Some(uid), Some(name)) = (body.user_id, body.name) {
        if !uid.trim().is_empty() && !name.trim().is_empty() {
            let count = state.worshiptools_manager.save_person(uid.trim(), name.trim());
            return Json(json!({ "success": true, "count": count }));
        }
    }

    Json(json!({ "success": false, "error": "Geen geldige userId/name of people map meegegeven." }))
}

pub async fn people_sync_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let people = state.worshiptools_manager.sync_people_cache(true).await;
    Json(json!({
        "success": true,
        "count": people.len(),
        "people": people,
    }))
}


#[derive(Deserialize)]
pub struct WtTokenPayload {
    #[serde(rename = "apiToken")]
    pub api_token: String,
    #[serde(default, rename = "accountId")]
    pub account_id: Option<String>,
}

pub async fn token_update_handler(
    State(state): State<ServerState>,
    Json(body): Json<WtTokenPayload>,
) -> impl IntoResponse {
    let clean_token = body.api_token.trim().to_string();
    if clean_token.is_empty() || !clean_token.starts_with("eyJ") {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "Ongeldig token formaat (moet beginnen met eyJ)" })),
        );
    }

    // Update server-config.json in both locations
    let config_paths = [
        state.data_dir.join("server-config.json"),
        state.root_dir.join("server-config.json"),
    ];

    let mut saved_any = false;
    for config_path in &config_paths {
        let mut val = if config_path.exists() {
            fs::read_to_string(config_path)
                .ok()
                .and_then(|c| serde_json::from_str::<Value>(&c).ok())
                .unwrap_or_else(|| json!({}))
        } else {
            json!({})
        };

        if let Some(obj) = val.as_object_mut() {
            let wt = obj
                .entry("worshiptools".to_string())
                .or_insert_with(|| json!({}))
                .as_object_mut();

            if let Some(wt_obj) = wt {
                wt_obj.insert("apiToken".to_string(), Value::String(clean_token.clone()));
                if let Some(ref acc) = body.account_id {
                    if !acc.trim().is_empty() {
                        wt_obj.insert("accountId".to_string(), Value::String(acc.trim().to_string()));
                    }
                }
                if let Ok(pretty) = serde_json::to_string_pretty(&val) {
                    if fs::write(config_path, pretty).is_ok() {
                        saved_any = true;
                        println!("  [WT-SVC] apiToken bijgewerkt in {:?}", config_path);
                    }
                }
            }
        }
    }

    // Immediately trigger sync_people_cache to download all names
    let people = state.worshiptools_manager.sync_people_cache(true).await;
    let count = people.len();

    // Broadcast to all connected clients over WebSocket
    state.ws_hub.broadcast(
        "worshiptools:token_updated",
        json!({
            "success": true,
            "count": count,
            "message": format!("WorshipTools gekoppeld! {} namen gesynchroniseerd.", count)
        }),
    );

    use tauri::Manager;
    if let Some(ref handle) = state.app_handle {
        if let Some(win) = handle.get_webview_window("worshiptools_login") {
            let _ = win.close();
        }
    }

    println!("  [WT-SVC] WorshipTools login succesvol! Token opgeslagen, {} mensen in people_cache.", count);

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "saved_config": saved_any,
            "people_count": count,
            "message": format!("Token succesvol opgeslagen! {} namen gesynchroniseerd.", count),
        })),
    )
}


pub async fn open_login_handler(State(state): State<ServerState>) -> impl IntoResponse {
    use tauri::Manager;

    let handle = match &state.app_handle {
        Some(h) => h.clone(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": "Geen Tauri window manager beschikbaar." })),
            );
        }
    };

    if let Some(win) = handle.get_webview_window("worshiptools_login") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "message": "Inlogvenster naar voren gebracht." })),
        );
    }

    let init_script = r#"
        (function() {
            console.log('[WT-EXTRACTOR] Advanced WorshipTools Extractor active');

            var state = {
                apiKey: null,
                refreshToken: null,
                accountId: null,
                apiToken: null
            };

            var lastSyncPayload = '';

            function syncToServer() {
                if (!state.apiKey && !state.refreshToken && !state.accountId && !state.apiToken) return;
                var payloadStr = JSON.stringify(state);
                if (payloadStr === lastSyncPayload) return;
                lastSyncPayload = payloadStr;

                console.log('[WT-EXTRACTOR] Auto-extracted credentials, reporting to server...', {
                    hasApiKey: !!state.apiKey,
                    hasRefreshToken: !!state.refreshToken,
                    accountId: state.accountId,
                    hasApiToken: !!state.apiToken
                });

                fetch('http://127.0.0.1:8080/api/worshiptools/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payloadStr
                }).then(function(r) { return r.json(); })
                .then(function(res) {
                    if (res && res.success) {
                        console.log('[WT-EXTRACTOR] Server successfully updated config!');
                    }
                }).catch(function(err) {
                    console.error('[WT-EXTRACTOR] Sync failed:', err);
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
                        if (state.apiToken !== token) {
                            state.apiToken = token;
                            syncToServer();
                        }
                    }

                    if (url) {
                        var m = url.match(/account[s]?\/([a-f0-9\-]{36})/i);
                        if (m && state.accountId !== m[1]) {
                            state.accountId = m[1];
                            syncToServer();
                        }
                        var k = url.match(/[?&]key=([A-Za-z0-9_\-]{39})/);
                        if (k && state.apiKey !== k[1]) {
                            state.apiKey = k[1];
                            syncToServer();
                        }
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
                        if (state.apiToken !== token) {
                            state.apiToken = token;
                            syncToServer();
                        }
                    }
                } catch(e) {}
                return origSetHeader.apply(this, arguments);
            };

            // 3. Scan storage & current location
            function scanStorage() {
                try {
                    var urlM = window.location.href.match(/account[s]?\/([a-f0-9\-]{36})/i);
                    if (urlM && state.accountId !== urlM[1]) {
                        state.accountId = urlM[1];
                        syncToServer();
                    }

                    for (var i = 0; i < localStorage.length; i++) {
                        var k = localStorage.key(i);
                        var v = localStorage.getItem(k);
                        if (!v) continue;

                        if (k.indexOf('firebase:authUser:') === 0 || v.indexOf('stsTokenManager') !== -1) {
                            try {
                                var parsed = JSON.parse(v);
                                if (parsed.apiKey && state.apiKey !== parsed.apiKey) {
                                    state.apiKey = parsed.apiKey;
                                    syncToServer();
                                }
                                if (parsed.stsTokenManager && parsed.stsTokenManager.refreshToken) {
                                    var rt = parsed.stsTokenManager.refreshToken;
                                    if (state.refreshToken !== rt) {
                                        state.refreshToken = rt;
                                        syncToServer();
                                    }
                                }
                            } catch(e) {}
                        }

                        if (v.indexOf('eyJ') !== -1 && (v.indexOf('wePlanning') !== -1 || v.indexOf('user.info.read') !== -1)) {
                            try {
                                var parsed = JSON.parse(v);
                                var tok = parsed.token || parsed.accessToken || parsed.idToken || parsed.jwt;
                                if (tok && typeof tok === 'string' && tok.indexOf('eyJ') === 0 && state.apiToken !== tok) {
                                    state.apiToken = tok;
                                    syncToServer();
                                }
                            } catch(e) {
                                if (v.indexOf('eyJ') === 0 && state.apiToken !== v) {
                                    state.apiToken = v;
                                    syncToServer();
                                }
                            }
                        }
                    }
                } catch(e) {}
            }

            setInterval(scanStorage, 1200);
            scanStorage();
        })();
    "#;

    let target_url: tauri::Url = match "https://planning.worshiptools.com/app/".parse() {
        Ok(u) => u,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": e.to_string() })),
            );
        }
    };

    match tauri::WebviewWindowBuilder::new(
        &handle,
        "worshiptools_login",
        tauri::WebviewUrl::External(target_url),
    )
    .title("WorshipTools Inloggen — Ichtus Workspace")
    .inner_size(960.0, 720.0)
    .initialization_script(init_script)
    .build()
    {
        Ok(win) => {
            let _ = win.show();
            let _ = win.set_focus();
            (
                StatusCode::OK,
                Json(json!({ "success": true, "message": "Inlogvenster geopend." })),
            )
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        ),
    }
}

pub async fn close_login_handler(State(state): State<ServerState>) -> impl IntoResponse {
    use tauri::Manager;
    if let Some(ref handle) = state.app_handle {
        if let Some(win) = handle.get_webview_window("worshiptools_login") {
            let _ = win.close();
            return Json(json!({ "success": true, "message": "Inlogvenster gesloten." }));
        }
    }
    Json(json!({ "success": true, "message": "Geen venster actief." }))
}


fn is_wt_placeholder(s: &str) -> bool {
    s.is_empty() || s.contains("****") || s.contains('•') || s == "__UNCHANGED__"
}

pub async fn config_get_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let cfg = state.worshiptools_manager.get_config().ok();
    let account_id = cfg.as_ref().map(|c| c.account_id.clone()).unwrap_or_default();
    let api_key = cfg.as_ref().map(|c| c.api_key.clone()).unwrap_or_default();
    let refresh_token = cfg.as_ref().map(|c| c.refresh_token.clone()).unwrap_or_default();
    let api_token = cfg.as_ref().map(|c| c.api_token.clone()).unwrap_or_default();

    let configured = !account_id.is_empty() && !api_key.is_empty() && !refresh_token.is_empty();

    let api_key_masked = if !api_key.is_empty() {
        let prefix_len = api_key.len().min(6);
        format!("{}****", &api_key[..prefix_len])
    } else {
        String::new()
    };

    Json(json!({
        "success": true,
        "configured": configured,
        "accountId": account_id,
        "apiKeyMasked": api_key_masked,
        "hasApiKey": !api_key.is_empty(),
        "hasRefreshToken": !refresh_token.is_empty(),
        "hasApiToken": !api_token.is_empty(),
    }))
}

#[derive(Deserialize)]
pub struct WtFullConfigPayload {
    #[serde(default, rename = "accountId")]
    pub account_id: Option<String>,
    #[serde(default, rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(default, rename = "refreshToken")]
    pub refresh_token: Option<String>,
    #[serde(default, rename = "apiToken")]
    pub api_token: Option<String>,
}

pub async fn config_post_handler(
    State(state): State<ServerState>,
    Json(body): Json<WtFullConfigPayload>,
) -> impl IntoResponse {
    let config_paths = [
        state.data_dir.join("server-config.json"),
        state.root_dir.join("server-config.json"),
    ];

    let mut saved_any = false;
    for config_path in &config_paths {
        let mut val = if config_path.exists() {
            fs::read_to_string(config_path)
                .ok()
                .and_then(|c| serde_json::from_str::<Value>(&c).ok())
                .unwrap_or_else(|| json!({}))
        } else {
            json!({})
        };

        if let Some(obj) = val.as_object_mut() {
            let wt = obj
                .entry("worshiptools".to_string())
                .or_insert_with(|| json!({}))
                .as_object_mut();

            if let Some(wt_obj) = wt {
                if let Some(ref acc) = body.account_id {
                    let s = acc.trim();
                    if !s.is_empty() {
                        wt_obj.insert("accountId".to_string(), Value::String(s.to_string()));
                    }
                }
                if let Some(ref key) = body.api_key {
                    let s = key.trim();
                    if !is_wt_placeholder(s) {
                        wt_obj.insert("apiKey".to_string(), Value::String(s.to_string()));
                    }
                }
                if let Some(ref rt) = body.refresh_token {
                    let s = rt.trim();
                    if !is_wt_placeholder(s) {
                        wt_obj.insert("refreshToken".to_string(), Value::String(s.to_string()));
                    }
                }
                if let Some(ref tok) = body.api_token {
                    let s = tok.trim();
                    if !is_wt_placeholder(s) {
                        wt_obj.insert("apiToken".to_string(), Value::String(s.to_string()));
                    }
                }

                if let Ok(pretty) = serde_json::to_string_pretty(&val) {
                    if fs::write(config_path, pretty).is_ok() {
                        saved_any = true;
                        println!("  [WT-SVC] server-config.json bijgewerkt in {:?}", config_path);
                    }
                }
            }
        }
    }

    // Trigger sync_people_cache if apiToken was set
    let people_count = if body.api_token.as_ref().map(|s| !is_wt_placeholder(s.trim())).unwrap_or(false) {
        let p = state.worshiptools_manager.sync_people_cache(true).await;
        p.len()
    } else {
        state.worshiptools_manager.load_people_cache(false)
    };

    // Check if fully configured
    let cfg = state.worshiptools_manager.get_config().ok();
    let is_complete = cfg.as_ref().map(|c| !c.account_id.is_empty() && !c.api_key.is_empty() && !c.refresh_token.is_empty()).unwrap_or(false);

    // If complete and we have a window open, close it!
    if is_complete && body.api_token.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
        use tauri::Manager;
        if let Some(ref handle) = state.app_handle {
            if let Some(win) = handle.get_webview_window("worshiptools_login") {
                let _ = win.close();
            }
        }
    }

    // Broadcast config update
    state.ws_hub.broadcast(
        "worshiptools:config_updated",
        json!({
            "success": true,
            "configured": is_complete,
            "peopleCount": people_count,
            "message": "WorshipTools configuratie bijgewerkt."
        }),
    );

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "saved": saved_any,
            "configured": is_complete,
            "people_count": people_count,
            "message": "WorshipTools instellingen succesvol opgeslagen."
        })),
    )
}

pub async fn config_test_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let cfg = match state.worshiptools_manager.get_config() {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": format!("Configuratie incompleet: {}", e)
                })),
            );
        }
    };

    // 1. Test token exchange
    let token = match state.worshiptools_manager.get_access_token(true).await {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "success": false,
                    "error": format!("Firebase authenticatie mislukt: {}. Controleer apiKey en refreshToken.", e)
                })),
            );
        }
    };

    // 2. Test Firestore cuelists query
    let docs = match state.worshiptools_manager.fetch_cuelist_documents(&token, &cfg.account_id).await {
        Ok(d) => d,
        Err((_, e)) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "success": false,
                    "error": format!("Firestore cuelists ophalen mislukt: {}. Klopt accountId?", e)
                })),
            );
        }
    };

    // 3. Test people sync
    let people = state.worshiptools_manager.sync_people_cache(true).await;

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "services_count": docs.len(),
            "people_count": people.len(),
            "has_people_token": !cfg.api_token.is_empty(),
            "message": format!(
                "Verbinding succesvol! {} diensten gevonden in Firestore, {} teamleden in people cache.",
                docs.len(),
                people.len()
            ),
        })),
    )
}
