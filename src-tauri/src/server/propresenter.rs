use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::Bytes;
use http_body_util::BodyExt;
use std::{env, fs, path::Path};

use super::ServerState;

/// Bepaalt `(host, port)` voor ProPresenter volgens dezelfde prioriteit als Node:
/// 1. Omgevingsvariabelen `PRO_HOST` / `PRO_PORT`
/// 2. `server-config.json` (`propresenter.host` / `propresenter.port`) in `data_dir` of `root_dir`
/// 3. Defaults: `100.113.22.22` en `51253`
pub fn resolve_propresenter_target(data_dir: &Path, root_dir: &Path) -> (String, String) {
    let mut cfg_host: Option<String> = None;
    let mut cfg_port: Option<String> = None;

    let candidates = [
        data_dir.join("server-config.json"),
        root_dir.join("server-config.json"),
    ];

    for path in candidates.iter() {
        if path.exists() {
            if let Ok(raw) = fs::read_to_string(path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(pro) = json.get("propresenter") {
                        if let Some(h) = pro.get("host").and_then(|v| v.as_str()) {
                            if !h.trim().is_empty() {
                                cfg_host = Some(h.trim().to_string());
                            }
                        }
                        if let Some(p) = pro.get("port") {
                            if let Some(s) = p.as_str() {
                                if !s.trim().is_empty() {
                                    cfg_port = Some(s.trim().to_string());
                                }
                            } else if let Some(n) = p.as_u64() {
                                cfg_port = Some(n.to_string());
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    let host = env::var("PRO_HOST")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or(cfg_host)
        .unwrap_or_else(|| "100.113.22.22".to_string());

    let port = env::var("PRO_PORT")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or(cfg_port)
        .unwrap_or_else(|| "51253".to_string());

    (host, port)
}

/// Native Rust ProPresenter API proxy (`/api/pro/*` -> `http://{proHost}:{proPort}/v1/*`) (Fase 4.2)
pub async fn pro_proxy_handler(
    State(state): State<ServerState>,
    req: Request,
) -> Response {
    state
        .request_count
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let method = req.method().clone();
    let uri = req.uri().clone();
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(uri.path());

    // Vervang het prefix `/api/pro` door `/v1`
    let rewritten_path = if let Some(rest) = path_and_query.strip_prefix("/api/pro") {
        format!("/v1{}", rest)
    } else {
        format!("/v1{}", path_and_query)
    };

    let (pro_host, pro_port) = resolve_propresenter_target(&state.data_dir, &state.root_dir);
    let pro_url = format!("http://{}:{}{}", pro_host, pro_port, rewritten_path);

    let content_type_in = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();

    let body_bytes: Bytes = if method != Method::GET && method != Method::HEAD {
        match req.into_body().collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": err.to_string() })),
                )
                    .into_response();
            }
        }
    } else {
        Bytes::new()
    };

    println!(
        "[PRO-PROXY] {} {} bodyLen={}",
        method,
        pro_url,
        body_bytes.len()
    );

    let reqwest_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => reqwest::Method::GET,
    };

    let mut builder = state.http_client.request(reqwest_method, &pro_url);

    if !body_bytes.is_empty() {
        builder = builder
            .header(header::CONTENT_TYPE.as_str(), content_type_in)
            .body(body_bytes);
    }

    match builder.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let content_type_out = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok());

            let resp_text = match resp.text().await {
                Ok(t) => t,
                Err(err) => {
                    eprintln!("[PRO-PROXY] Error reading response: {}", err);
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({ "error": err.to_string() })),
                    )
                        .into_response();
                }
            };

            let preview: String = resp_text.chars().take(200).collect();
            println!("[PRO-PROXY] Response: {} body={}", status.as_u16(), preview);

            let mut response = Response::new(Body::from(resp_text));
            *response.status_mut() = status;
            if let Some(ct) = content_type_out {
                response.headers_mut().insert(header::CONTENT_TYPE, ct);
            }
            response
        }
        Err(err) => {
            eprintln!("[PRO-PROXY] Error: {}", err);
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({ "error": err.to_string() })),
            )
                .into_response()
        }
    }
}
