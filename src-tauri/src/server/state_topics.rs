use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use super::ServerState;

// ── Dashboard Routes (/api/dashboard/state) ────────────────────────────

/// `GET /api/dashboard/state`
pub async fn dashboard_get_state_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let current = state
        .topic_store
        .get_state("dashboard")
        .unwrap_or_else(|| json!({}));
    Json(current)
}

/// `POST /api/dashboard/state`
pub async fn dashboard_set_state_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    if !body.is_object() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Ongeldig payload. Verwacht object." })),
        )
            .into_response();
    }

    let saved = state.topic_store.set_state("dashboard", body);
    state.ws_hub.broadcast("dashboard:state", saved.clone());

    Json(json!({ "success": true, "state": saved })).into_response()
}

// ── Patchbay Routes (/api/patchbay/state) ──────────────────────────────

/// `GET /api/patchbay/state`
pub async fn patchbay_get_state_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let current = state
        .topic_store
        .get_state("patchbay")
        .unwrap_or_else(|| json!({}));
    Json(current)
}

/// `POST /api/patchbay/state`
pub async fn patchbay_set_state_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    let projects = body.get("projects");
    if !body.is_object() || projects.is_none() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Ongeldig payload. Verwacht { projects, currentProjectId }." })),
        )
            .into_response();
    }

    let current_project_id = body
        .get("currentProjectId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            projects
                .and_then(|p| p.as_object())
                .and_then(|obj| obj.keys().next().cloned())
        })
        .unwrap_or_else(|| "default".to_string());

    let payload = json!({
        "projects": projects.unwrap(),
        "currentProjectId": current_project_id,
    });

    let saved = state.topic_store.set_state("patchbay", payload);
    state.ws_hub.broadcast("patchbay:state", saved.clone());

    Json(json!({ "success": true, "state": saved })).into_response()
}

// ── Command Center Routes (/api/commandcenter/*) ───────────────────────

/// `GET /api/commandcenter/state`
pub async fn commandcenter_get_state_handler(State(state): State<ServerState>) -> impl IntoResponse {
    let current = state
        .topic_store
        .get_state("commandCenter")
        .unwrap_or_else(|| json!({}));
    Json(current)
}

/// `POST /api/commandcenter/state`
pub async fn commandcenter_post_state_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> Response {
    if !body.is_object() || body.is_array() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Ongeldig payload. Verwacht object met velden." })),
        )
            .into_response();
    }

    let updated = state.topic_store.update_state("commandCenter", body);
    state.ws_hub.broadcast("commandCenter:state", updated.clone());

    Json(json!({ "success": true, "state": updated })).into_response()
}

/// `POST /api/commandcenter/archive`
pub async fn commandcenter_archive_handler(
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let preset = body.get("preset").and_then(|v| v.as_str()).unwrap_or("");
    let completed = body.get("completed").and_then(|v| v.as_i64()).unwrap_or(0);
    let total = body.get("total").and_then(|v| v.as_i64()).unwrap_or(0);

    state.system_manager.log(&format!(
        "CommandCenter gearchiveerd: preset='{}', voltooid={}/{}",
        preset, completed, total
    ));

    Json(json!({ "success": true }))
}
