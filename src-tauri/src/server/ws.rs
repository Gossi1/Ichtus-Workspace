use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::broadcast;

use super::ServerState;


#[derive(Clone)]
pub struct WsHub {
    tx: broadcast::Sender<String>,
    client_count: Arc<AtomicUsize>,
}


impl WsHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(512);
        Self {
            tx,
            client_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn broadcast(&self, event: &str, data: Value) {
        let msg = json!({
            "event": event,
            "data": data,
        })
        .to_string();
        let _ = self.tx.send(msg);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }
}

/// Native Rust WebSocket handler op `/ws` (`axum::ws` + `tokio::broadcast`) (Fase 4.3)
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: ServerState) {
    let total = state.ws_hub.client_count.fetch_add(1, Ordering::SeqCst) + 1;
    println!("  [WS] Client verbonden (totaal: {})", total);

    let (mut sender, mut receiver) = socket.split();

    // 1. Stuur direct alle `pushOnConnect` topic-snapshots naar de nieuwe client
    let snapshots = state.topic_store.push_on_connect_snapshots();
    for (event, topic_state) in snapshots {
        let msg = json!({
            "event": event,
            "data": topic_state,
        })
        .to_string();
        if sender.send(Message::Text(msg.into())).await.is_err() {
            let rem = state.ws_hub.client_count.fetch_sub(1, Ordering::SeqCst) - 1;
            println!("  [WS] Client losgekoppeld (totaal: {})", rem);
            return;
        }
    }

    let mut rx = state.ws_hub.subscribe();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.tick().await; // skip eerste directe tick

    loop {
        tokio::select! {
            // Broadcast vanuit de hub doorsturen naar deze client
            res = rx.recv() => {
                match res {
                    Ok(msg) => {
                        if sender.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            // Inkomende berichten van deze client
            maybe_msg = receiver.next() => {
                match maybe_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                            let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if msg_type == "ping" {
                                let pong = json!({ "event": "pong" }).to_string();
                                if sender.send(Message::Text(pong.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        break;
                    }
                    _ => {}
                }
            }

            // Elke 30s een WebSocket ping sturen voor liveness
            _ = heartbeat.tick() => {
                if sender.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
    }

    let remaining = state.ws_hub.client_count.fetch_sub(1, Ordering::SeqCst) - 1;
    println!("  [WS] Client losgekoppeld (totaal: {})", remaining);
}



