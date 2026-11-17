//! ELM327 command session.
//!
//! The adapter is configured with echo off, linefeeds off, spaces on and headers off. Responses are
//! read until the `>` prompt, cleaned, then assembled into OBD messages (ISO-TP multi-frame
//! responses are reassembled from the ELM's `0:` / `1:` ... line prefixes).

use std::time::Duration;

use serde::Serialize;

use crate::dtc::{self, Dtc, DtcKind};
use crate::pids::{self, LiveValue, MonitorStatus, PidDef};
use crate::transport::{Deadline, Transport};
use crate::vin::{self, VehicleInfo};
use crate::{Error, Result};

#[derive(Debug, Clone, Serialize)]
pub struct AdapterInfo {
    pub transport: String,
    pub elm_version: String,
    pub protocol_number: Option<u8>,
    pub protocol: String,
}

pub struct Elm327 {
    transport: Box<dyn Transport>,
    pub timeout: Duration,
    protocol: Option<u8>,
}

impl Elm327 {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self { transport, timeout: Duration::from_secs(5), protocol: None }
    }

    /// Resets and configures the adapter, then lets it auto-detect the vehicle protocol.
    pub fn initialize(&mut self) -> Result<AdapterInfo> {
        // ATZ may answer slowly and with garbage from a previous session: drain it.
        let reset = self.command_with_timeout("ATZ", Duration::from_secs(3))?;
        let elm_version = reset
            .split(['\r', '\n'])
            .map(str::trim)
            .find(|l| l.to_uppercase().contains("ELM"))
            .unwrap_or("ELM327 (version inconnue)")
            .to_string();
        for cmd in ["ATE0", "ATL0", "ATS1", "ATH0", "ATAT1", "ATSP0"] {
            self.command(cmd)?;
        }
        // The first request triggers the protocol search ("SEARCHING...").
        let probe = self.command_with_timeout("0100", Duration::from_secs(15))?;
        check_errors(&probe)?;
        let dpn = self.command("ATDPN")?;
        self.protocol = parse_protocol_number(&dpn);
        Ok(AdapterInfo {
            transport: self.transport.describe(),
            elm_version,
            protocol_number: self.protocol,
            protocol: protocol_name(self.protocol).to_string(),
        })
    }

    /// Heavy vehicles: configures the adapter for SAE J1939 (CAN 29 bit, 250 kbaud) with headers,
    /// without the OBD-II probe (many trucks do not answer service 01 on the J1939 connector).
    pub fn initialize_j1939(&mut self) -> Result<AdapterInfo> {
        let reset = self.command_with_timeout("ATZ", Duration::from_secs(3))?;
        let elm_version = reset
            .split(['\r', '\n'])
            .map(str::trim)
            .find(|l| l.to_uppercase().contains("ELM") || l.to_uppercase().contains("STN"))
            .unwrap_or("ELM327 (version inconnue)")
            .to_string();
        for cmd in ["ATE0", "ATL0", "ATS1", "ATH1", "ATSPA"] {
            let r = self.command(cmd)?;
            if r.contains('?') {
                return Err(Error::Protocol(format!("l'adaptateur refuse « {cmd} » : il ne gère pas le J1939 (ELM327 v1.4b+ ou OBDLink requis)")));
            }
        }
        self.protocol = Some(0xA);
        Ok(AdapterInfo {
            transport: self.transport.describe(),
            elm_version,
            protocol_number: self.protocol,
            protocol: protocol_name(self.protocol).to_string(),
        })
    }

    /// Runs a monitoring command (e.g. `ATDM1`) for `listen`, then stops it with a carriage return
    /// and returns everything received.
    pub fn monitor(&mut self, cmd: &str, listen: Duration) -> Result<String> {
        self.transport.write_all(format!("{cmd}\r").as_bytes())?;
        let mut out = Vec::new();
        let mut buf = [0u8; 512];
        let mut deadline = Deadline::after(listen);
        let mut prompt = false;
        while !deadline.expired() {
            let n = self.transport.read(&mut buf)?;
            out.extend_from_slice(&buf[..n]);
            if out.contains(&b'>') {
                prompt = true; // the adapter ended by itself (error, "?")
                break;
            }
        }
        if !prompt {
            self.transport.write_all(b"\r")?;
            let mut stop = Deadline::after(Duration::from_secs(2));
            loop {
                let n = self.transport.read(&mut buf)?;
                out.extend_from_slice(&buf[..n]);
                if out.contains(&b'>') || stop.expired() {
                    break;
                }
            }
        }
        let text = String::from_utf8_lossy(&out).replace('\0', "");
        Ok(text.split('>').next().unwrap_or("").to_string())
    }

    /// Listens to DM1 broadcasts (active faults) for a few seconds.
    pub fn read_j1939_dm1(&mut self) -> Result<crate::j1939::DmReport> {
        let raw = self.monitor("ATDM1", Duration::from_millis(3500))?;
        if raw.contains('?') {
            return Err(Error::Protocol("l'adaptateur ne connaît pas la commande ATDM1 (J1939) : ELM327 v1.4b+, OBDLink ou STN requis".into()));
        }
        let report = crate::j1939::read_dm1(&raw);
        if report.sources.is_empty() {
            return Err(Error::Protocol("aucun message J1939 reçu : contact mis ? prise 9 broches Deutsch ou broches 6/14 J1939 câblées ?".into()));
        }
        Ok(report)
    }

    pub fn is_can(&self) -> Option<bool> {
        self.protocol.map(|p| (6..=9).contains(&p))
    }

    pub fn command(&mut self, cmd: &str) -> Result<String> {
        let t = self.timeout;
        self.command_with_timeout(cmd, t)
    }

    /// Sends a command and returns the raw text received before the `>` prompt.
    pub fn command_with_timeout(&mut self, cmd: &str, timeout: Duration) -> Result<String> {
        self.transport.write_all(format!("{cmd}\r").as_bytes())?;
        let mut deadline = Deadline::after(timeout);
        let mut out = Vec::new();
        let mut buf = [0u8; 256];
        loop {
            let n = self.transport.read(&mut buf)?;
            out.extend_from_slice(&buf[..n]);
            if let Some(pos) = out.iter().position(|&b| b == b'>') {
                out.truncate(pos);
                return Ok(String::from_utf8_lossy(&out).replace('\0', ""));
            }
            if deadline.expired() {
                return Err(Error::Timeout);
            }
        }
    }

    /// Sends an OBD request and returns the assembled messages (empty on `NO DATA`).
    pub fn request(&mut self, cmd: &str) -> Result<Vec<Vec<u8>>> {
        let raw = self.command(cmd)?;
        check_errors(&raw)?;
        Ok(assemble_messages(&clean_lines(&raw)))
    }

    pub fn read_dtcs(&mut self, kind: DtcKind) -> Result<Vec<Dtc>> {
        let msgs = self.request(kind.request())?;
        Ok(dtc::parse_messages(&msgs, kind, self.is_can()))
    }

    /// Reads stored, pending and permanent codes. Services unsupported by older cars are skipped.
    pub fn read_all_dtcs(&mut self) -> Result<Vec<Dtc>> {
        let mut all = self.read_dtcs(DtcKind::Stored)?;
        for kind in [DtcKind::Pending, DtcKind::Permanent] {
            if let Ok(codes) = self.read_dtcs(kind) {
                all.extend(codes);
            }
        }
        Ok(all)
    }

    /// Service 04: clears DTCs and freeze frames, turns the MIL off, resets readiness monitors.
    pub fn clear_dtcs(&mut self) -> Result<()> {
        let raw = self.command("04")?;
        check_errors(&raw)?;
        if raw.contains("44") {
            Ok(())
        } else {
            Err(Error::Protocol(format!("effacement refusé : {}", raw.trim())))
        }
    }

    fn mode01(&mut self, pid: u8) -> Result<Option<Vec<u8>>> {
        let msgs = self.request(&format!("01{pid:02X}"))?;
        Ok(msgs.into_iter().find(|m| m.len() > 2 && m[0] == 0x41 && m[1] == pid).map(|m| m[2..].to_vec()))
    }

    pub fn read_pid(&mut self, def: &PidDef) -> Result<Option<LiveValue>> {
        Ok(self.mode01(def.pid)?.and_then(|d| def.decode(&d)).map(|v| LiveValue::new(def, v)))
    }

    pub fn read_live(&mut self) -> Result<Vec<LiveValue>> {
        let mut out = Vec::new();
        for def in pids::LIVE_PIDS {
            if let Some(v) = self.read_pid(def)? {
                out.push(v);
            }
        }
        Ok(out)
    }

    pub fn monitor_status(&mut self) -> Result<Option<MonitorStatus>> {
        Ok(self.mode01(0x01)?.and_then(|d| pids::decode_monitor_status(&d)))
    }

    pub fn readiness(&mut self) -> Result<Vec<pids::Monitor>> {
        Ok(self.mode01(0x01)?.map(|d| pids::decode_readiness(&d)).unwrap_or_default())
    }

    pub fn battery_voltage(&mut self) -> Result<Option<f64>> {
        let raw = self.command("ATRV")?;
        Ok(raw.trim().trim_end_matches(['V', 'v']).trim().parse().ok())
    }

    pub fn read_vehicle(&mut self) -> Result<VehicleInfo> {
        let msgs = self.request("0902")?;
        Ok(vin::parse_vin(&msgs).map(|v| vin::decode(&v)).unwrap_or_default())
    }
}

pub fn check_errors(raw: &str) -> Result<()> {
    let up = raw.to_uppercase();
    if up.contains("UNABLE TO CONNECT") || up.contains("BUS INIT: ...ERROR") || up.contains("CAN ERROR") {
        return Err(Error::UnableToConnect);
    }
    if up.contains("BUS ERROR") || up.contains("FB ERROR") || up.contains("DATA ERROR") {
        return Err(Error::Protocol(raw.trim().to_string()));
    }
    Ok(())
}

/// Splits a raw response into meaningful lines, dropping status messages.
pub fn clean_lines(raw: &str) -> Vec<String> {
    raw.split(['\r', '\n'])
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .filter(|l| {
            let u = l.to_uppercase();
            !(u.starts_with("SEARCHING") || u.starts_with("BUS INIT") || u == "NO DATA" || u == "OK" || u == "?" || u == "STOPPED")
        })
        .map(str::to_string)
        .collect()
}

fn parse_hex(s: &str) -> Option<Vec<u8>> {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() || compact.len() % 2 != 0 {
        return None;
    }
    (0..compact.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&compact[i..i + 2], 16).ok())
        .collect()
}

/// Groups response lines into OBD messages.
///
/// With headers off, the ELM prints CAN multi-frame responses as:
/// ```text
/// 00A
/// 0: 43 04 01 33 03 01
/// 1: 04 20 01 71 00 00
/// ```
/// where `00A` is the payload length. Single frames and legacy protocols print one message per line.
pub fn assemble_messages(lines: &[String]) -> Vec<Vec<u8>> {
    let mut messages: Vec<Vec<u8>> = Vec::new();
    let mut current: Option<(Vec<u8>, usize)> = None;

    let flush = |cur: &mut Option<(Vec<u8>, usize)>, msgs: &mut Vec<Vec<u8>>| {
        if let Some((mut data, len)) = cur.take() {
            data.truncate(len);
            msgs.push(data);
        }
    };

    for line in lines {
        let is_length = line.len() == 3 && line.chars().all(|c| c.is_ascii_hexdigit());
        if is_length {
            flush(&mut current, &mut messages);
            let len = usize::from_str_radix(line, 16).unwrap_or(0);
            current = Some((Vec::with_capacity(len), len));
            continue;
        }
        if let Some((idx, rest)) = line.split_once(':') {
            if idx.trim().len() == 1 && idx.trim().chars().all(|c| c.is_ascii_hexdigit()) {
                if let (Some((data, _)), Some(bytes)) = (current.as_mut(), parse_hex(rest)) {
                    data.extend(bytes);
                }
                continue;
            }
        }
        if let Some(bytes) = parse_hex(line) {
            flush(&mut current, &mut messages);
            messages.push(bytes);
        }
    }
    flush(&mut current, &mut messages);
    messages
}

pub fn parse_protocol_number(dpn: &str) -> Option<u8> {
    let t = dpn.trim().trim_start_matches(['A', 'a']);
    t.chars().last().and_then(|c| c.to_digit(16)).map(|d| d as u8)
}

pub fn protocol_name(p: Option<u8>) -> &'static str {
    match p {
        Some(1) => "SAE J1850 PWM",
        Some(2) => "SAE J1850 VPW",
        Some(3) => "ISO 9141-2",
        Some(4) => "ISO 14230-4 KWP (5 baud)",
        Some(5) => "ISO 14230-4 KWP (rapide)",
        Some(6) => "ISO 15765-4 CAN (11 bit, 500 kbaud)",
        Some(7) => "ISO 15765-4 CAN (29 bit, 500 kbaud)",
        Some(8) => "ISO 15765-4 CAN (11 bit, 250 kbaud)",
        Some(9) => "ISO 15765-4 CAN (29 bit, 250 kbaud)",
        Some(0xA) => "SAE J1939 CAN",
        _ => "Inconnu",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(s: &str) -> Vec<String> {
        clean_lines(s)
    }

    #[test]
    fn assembles_multiframe_can() {
        let raw = "SEARCHING...\r00A\r0: 43 04 01 33 03 01\r1: 04 20 01 71 00 00\r\r";
        let msgs = assemble_messages(&lines(raw));
        assert_eq!(msgs, vec![vec![0x43, 0x04, 0x01, 0x33, 0x03, 0x01, 0x04, 0x20, 0x01, 0x71]]);
        let codes: Vec<_> = dtc::parse_messages(&msgs, DtcKind::Stored, Some(true)).into_iter().map(|d| d.code).collect();
        assert_eq!(codes, ["P0133", "P0301", "P0420", "P0171"]);
    }

    #[test]
    fn assembles_multiple_ecus_single_frames() {
        let msgs = assemble_messages(&lines("43 01 03 01\r43 01 C1 00\r"));
        assert_eq!(msgs.len(), 2);
        let codes: Vec<_> = dtc::parse_messages(&msgs, DtcKind::Stored, Some(true)).into_iter().map(|d| d.code).collect();
        assert_eq!(codes, ["P0301", "U0100"]);
    }

    #[test]
    fn ignores_no_data_and_noise() {
        assert!(assemble_messages(&lines("NO DATA\r")).is_empty());
        assert!(assemble_messages(&lines("SEARCHING...\rSTOPPED\r")).is_empty());
    }

    #[test]
    fn detects_errors_and_protocol() {
        assert!(matches!(check_errors("SEARCHING...\rUNABLE TO CONNECT"), Err(Error::UnableToConnect)));
        assert_eq!(parse_protocol_number("A6"), Some(6));
        assert_eq!(parse_protocol_number("3"), Some(3));
    }
}
