//! Stateless parsing of raw ELM327 answers.
//!
//! Used by front-ends that perform the I/O themselves (the browser build with Web Serial or Web
//! Bluetooth, where I/O is asynchronous and cannot run inside the synchronous [`crate::Elm327`]
//! session). The decoding logic stays in Rust, shared with the native app.

use serde_json::{json, Value};

use crate::dtc::{self, DtcKind};
use crate::elm327::{self, assemble_messages, clean_lines};
use crate::{pids, vin, Error, Result};

/// Commands to send, in order, to initialise an adapter.
pub const INIT_SEQUENCE: &[&str] = &["ATZ", "ATE0", "ATL0", "ATS1", "ATH0", "ATAT1", "ATSP0", "0100", "ATDPN"];

/// Live-data requests, in display order: (command, key).
pub fn live_requests() -> Vec<(String, &'static str)> {
    pids::LIVE_PIDS.iter().map(|d| (format!("01{:02X}", d.pid), d.key)).collect()
}

/// Parses the raw answer to `cmd`. `is_can` comes from a previous `ATDPN` answer when known.
pub fn parse_response(cmd: &str, raw: &str, is_can: Option<bool>) -> Result<Value> {
    let cmd = cmd.trim().to_uppercase().replace(' ', "");
    if cmd == "ATZ" || cmd == "ATI" {
        let version = raw.split(['\r', '\n']).map(str::trim).find(|l| l.to_uppercase().contains("ELM") || l.to_uppercase().contains("STN"));
        return Ok(json!({ "elm_version": version.unwrap_or("ELM327 (version inconnue)") }));
    }
    if cmd == "ATDPN" {
        let n = elm327::parse_protocol_number(raw);
        return Ok(json!({ "protocol_number": n, "protocol": elm327::protocol_name(n), "is_can": n.map(|p| (6..=9).contains(&p)) }));
    }
    if cmd == "ATRV" {
        let v: Option<f64> = raw.trim().trim_end_matches(['V', 'v']).trim().parse().ok();
        return Ok(json!({ "battery_v": v }));
    }
    if cmd.starts_with("AT") {
        return Ok(json!({ "ok": raw.to_uppercase().contains("OK") || raw.to_uppercase().contains("ELM") }));
    }
    elm327::check_errors(raw)?;
    let msgs = assemble_messages(&clean_lines(raw));
    match cmd.as_str() {
        "03" | "07" | "0A" => {
            let kind = match cmd.as_str() {
                "03" => DtcKind::Stored,
                "07" => DtcKind::Pending,
                _ => DtcKind::Permanent,
            };
            Ok(json!({ "dtcs": dtc::parse_messages(&msgs, kind, is_can) }))
        }
        "04" => Ok(json!({ "cleared": raw.contains("44") })),
        "0902" => Ok(json!({ "vehicle": vin::parse_vin(&msgs).map(|v| vin::decode(&v)).unwrap_or_default() })),
        "0101" => {
            let data = msgs.iter().find(|m| m.len() > 2 && m[0] == 0x41 && m[1] == 0x01).map(|m| m[2..].to_vec());
            Ok(json!({
                "monitor": data.as_deref().and_then(pids::decode_monitor_status),
                "readiness": data.as_deref().map(pids::decode_readiness).unwrap_or_default(),
            }))
        }
        c if c.len() == 4 && c.starts_with("01") => {
            let pid = u8::from_str_radix(&c[2..], 16).map_err(|_| Error::Protocol(format!("PID invalide : {c}")))?;
            let value = pids::LIVE_PIDS.iter().find(|d| d.pid == pid).and_then(|def| {
                msgs.iter()
                    .find(|m| m.len() > 2 && m[0] == 0x41 && m[1] == pid)
                    .and_then(|m| def.decode(&m[2..]))
                    .map(|v| pids::LiveValue::new(def, v))
            });
            Ok(json!({ "value": value }))
        }
        _ => Ok(json!({ "messages": msgs.iter().map(|m| crate::uds::hex(m)).collect::<Vec<_>>() })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simulator::Simulator;
    use crate::transport::Transport;

    /// Drives the simulator like the browser would: raw text in, raw text out.
    fn ask(sim: &mut Simulator, cmd: &str) -> String {
        sim.write_all(format!("{cmd}\r").as_bytes()).unwrap();
        let mut buf = [0u8; 4096];
        let mut out = Vec::new();
        loop {
            let n = sim.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        let s = String::from_utf8_lossy(&out).to_string();
        s.split('>').next().unwrap_or("").to_string()
    }

    #[test]
    fn full_flow_without_session() {
        let mut sim = Simulator::demo();
        let mut is_can = None;
        for cmd in INIT_SEQUENCE {
            let raw = ask(&mut sim, cmd);
            let v = parse_response(cmd, &raw, None).unwrap();
            if *cmd == "ATDPN" {
                is_can = v["is_can"].as_bool();
                assert_eq!(v["protocol_number"], 6);
            }
        }
        assert_eq!(is_can, Some(true));
        let v = parse_response("03", &ask(&mut sim, "03"), is_can).unwrap();
        assert_eq!(v["dtcs"].as_array().unwrap().len(), 2);
        let v = parse_response("0902", &ask(&mut sim, "0902"), is_can).unwrap();
        assert_eq!(v["vehicle"]["make"], "Renault");
        let v = parse_response("010C", &ask(&mut sim, "010C"), is_can).unwrap();
        assert!(v["value"]["value"].as_f64().unwrap() > 500.0);
        let v = parse_response("0101", &ask(&mut sim, "0101"), is_can).unwrap();
        assert_eq!(v["monitor"]["mil_on"], true);
        assert!(!v["readiness"].as_array().unwrap().is_empty());
        let v = parse_response("ATRV", &ask(&mut sim, "ATRV"), is_can).unwrap();
        assert!(v["battery_v"].as_f64().unwrap() > 12.0);
        assert_eq!(parse_response("04", &ask(&mut sim, "04"), is_can).unwrap()["cleared"], true);
        assert!(parse_response("03", "SEARCHING...\rUNABLE TO CONNECT", None).is_err());
        assert_eq!(live_requests().len(), pids::LIVE_PIDS.len());
    }
}
