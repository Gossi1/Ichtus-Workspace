use axum::{
    extract::State,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

use super::ServerState;

fn get_templates_path(state: &ServerState) -> PathBuf {
    state.spa_dir.join("data").join("setlist-templates.json")
}

/// `GET /api/setlist/templates`
pub async fn get_templates_handler(State(state): State<ServerState>) -> Response {
    let path = get_templates_path(&state);
    if !path.exists() {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "error": "Template file not found"
            })),
        )
            .into_response();
    }

    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(templates) => {
                let mut resp = Json(json!({
                    "success": true,
                    "templates": templates
                }))
                .into_response();
                resp.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-store, no-cache, must-revalidate, proxy-revalidate"),
                );
                resp
            }
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": err.to_string() })),
        )
            .into_response(),
    }
}

/// `POST /api/setlist/templates`
pub async fn save_templates_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let obj = match body.as_object() {
        Some(o) => o,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": "Invalid payload: expected an object of templates."
                })),
            )
                .into_response();
        }
    };

    // Validate each template has { name: string, items: array }
    for (key, tpl) in obj {
        let is_valid = if let Some(t_obj) = tpl.as_object() {
            t_obj.get("name").and_then(|v| v.as_str()).is_some()
                && t_obj.get("items").and_then(|v| v.as_array()).is_some()
        } else {
            false
        };

        if !is_valid {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "error": format!(
                        "Invalid template structure for key \"{}\". Expected {{ name: string, items: array }}.",
                        key
                    )
                })),
            )
                .into_response();
        }
    }

    let path = get_templates_path(&state);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let count = obj.len();
    match serde_json::to_string_pretty(&body) {
        Ok(json_str) => match fs::write(&path, json_str) {
            Ok(()) => {
                println!(
                    "  [SETLIST] Templates saved to {} ({} templates)",
                    path.display(),
                    count
                );
                state.ws_hub.broadcast("setlist:templates", json!({ "templates": body }));
                Json(json!({ "success": true, "count": count })).into_response()
            }
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": err.to_string() })),
            )
                .into_response(),
        },
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": err.to_string() })),
        )
            .into_response(),
    }
}
