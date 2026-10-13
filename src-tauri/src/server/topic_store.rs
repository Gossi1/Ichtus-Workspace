use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};


#[derive(Clone, Debug)]
pub struct TopicEntry {
    #[allow(dead_code)]
    pub name: String,
    pub event: String,
    pub state: Option<Value>,
    pub push_on_connect: bool,
}

#[derive(Clone)]
pub struct TopicStore {
    topics: Arc<RwLock<HashMap<String, TopicEntry>>>,
}

impl TopicStore {
    pub fn new() -> Self {
        let store = Self {
            topics: Arc::new(RwLock::new(HashMap::new())),
        };
        // Standaard topics registreren (gelijk aan Node topic-store)
        store.create_topic("commandCenter", "commandCenter:state", true);
        store.create_topic("patchbay", "patchbay:state", false);
        store.create_topic("dashboard", "dashboard:state", false);
        store
    }

    pub fn create_topic(&self, name: &str, event: &str, push_on_connect: bool) {
        let mut map = self.topics.write().unwrap();
        map.entry(name.to_string()).or_insert_with(|| TopicEntry {
            name: name.to_string(),
            event: event.to_string(),
            state: None,
            push_on_connect,
        });
    }

    #[allow(dead_code)]
    pub fn get_state(&self, name: &str) -> Option<Value> {
        let map = self.topics.read().unwrap();
        map.get(name).and_then(|t| t.state.clone())
    }

    #[allow(dead_code)]
    pub fn get_event_and_state(&self, name: &str) -> Option<(String, Value)> {
        let map = self.topics.read().unwrap();
        map.get(name)
            .and_then(|t| t.state.clone().map(|s| (t.event.clone(), s)))
    }

    pub fn set_state(&self, name: &str, value: Value) -> Value {
        let mut map = self.topics.write().unwrap();
        let entry = map.entry(name.to_string()).or_insert_with(|| TopicEntry {
            name: name.to_string(),
            event: format!("{}:state", name),
            state: None,
            push_on_connect: false,
        });
        entry.state = Some(value.clone());
        value
    }

    pub fn update_state(&self, name: &str, patch: Value) -> Value {
        let mut map = self.topics.write().unwrap();
        let entry = map.entry(name.to_string()).or_insert_with(|| TopicEntry {
            name: name.to_string(),
            event: format!("{}:state", name),
            state: None,
            push_on_connect: false,
        });

        let mut base_obj = match entry.state.take() {
            Some(Value::Object(m)) => m,
            _ => Map::new(),
        };

        if let Value::Object(patch_map) = patch {
            for (k, v) in patch_map {
                base_obj.insert(k, v);
            }
        }

        let new_val = Value::Object(base_obj);
        entry.state = Some(new_val.clone());
        new_val
    }


    /// Geeft alle `(event, state)` paren terug van topics met `push_on_connect == true`
    /// die een geldige state bevatten, voor directe hydratatie bij nieuwe WS-connecties.
    pub fn push_on_connect_snapshots(&self) -> Vec<(String, Value)> {
        let map = self.topics.read().unwrap();
        map.values()
            .filter_map(|t| {
                if t.push_on_connect {
                    t.state.as_ref().map(|s| (t.event.clone(), s.clone()))
                } else {
                    None
                }
            })
            .collect()
    }
}
