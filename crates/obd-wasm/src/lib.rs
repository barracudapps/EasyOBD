//! WebAssembly entry point: the browser runs exactly the same Rust logic as the native app
//! (knowledge base, simulator + ELM327 session, questionnaire, audio analysis, training, maintenance).

use obd_core::api::Session;
use obd_core::audio::{self, AudioRequest};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Api {
    session: Session,
}

#[wasm_bindgen]
impl Api {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Api {
        Api { session: Session::new() }
    }

    /// Same contract as the Tauri `api` command: JSON arguments in, JSON result out.
    pub fn call(&mut self, cmd: &str, args_json: &str) -> Result<String, JsValue> {
        let args: serde_json::Value = serde_json::from_str(args_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.session.handle(cmd, &args).map(|v| v.to_string()).map_err(|e| JsValue::from_str(&e))
    }
}

impl Default for Api {
    fn default() -> Self {
        Self::new()
    }
}

/// Fast path for audio: samples are passed as a Float32Array without JSON encoding.
#[wasm_bindgen]
pub fn analyze_audio(samples: &[f32], request_json: &str) -> Result<String, JsValue> {
    let req: AudioRequest = serde_json::from_str(request_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let report = audio::analyze(samples, &req);
    let evidence = report.as_evidence();
    Ok(serde_json::json!({ "report": report, "evidence": evidence }).to_string())
}
