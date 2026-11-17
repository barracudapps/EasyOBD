//! Native shell: exposes the shared obd-core JSON API to the web UI.
//! Hardware access (serial, Bluetooth, Wi-Fi sockets) runs on a blocking thread.

use std::sync::{Arc, Mutex};

use obd_core::api::Session;
use serde_json::Value;

type Shared = Arc<Mutex<Session>>;

#[tauri::command]
async fn api(state: tauri::State<'_, Shared>, cmd: String, args: Value) -> Result<Value, String> {
    let session = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = session.lock().map_err(|_| "session indisponible".to_string())?;
        s.handle(&cmd, &args)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![api])
        .run(tauri::generate_context!())
        .expect("error while running EasyOBD");
}
