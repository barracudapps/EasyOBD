//! A virtual car behind a virtual ELM327 (CAN 11 bit / 500 kbaud).
//!
//! It implements [`Transport`], so the real [`crate::Elm327`] session code is exercised end to end
//! – useful for demos without a dongle, UI development and tests.

use std::collections::{HashMap, VecDeque};

use crate::dtc::{Dtc, DtcKind};
use crate::transport::Transport;
use crate::Result;

pub struct Simulator {
    dtcs: Vec<Dtc>,
    vin: String,
    echo: bool,
    searched: bool,
    tick: u32,
    input: Vec<u8>,
    output: VecDeque<u8>,
    /// Physical values forced for live PIDs, by key (`coolant`, `voltage`, `stft`…).
    overrides: HashMap<String, f64>,
    /// UDS: current physical target (ATSH), active session, writable test parameter.
    header: Option<u16>,
    session: u8,
    param_0100: u8,
    /// Readiness monitors are reset by a code clear (service 04), like on a real car.
    monitors_reset: bool,
}

/// Encodes a 5-character DTC into its two raw bytes (inverse of [`crate::dtc::decode`]).
pub fn encode(code: &str) -> Option<[u8; 2]> {
    let code = crate::dtc::normalize(code)?;
    let sys = "PCBU".find(&code[0..1])? as u8;
    let d1 = code[1..2].parse::<u8>().ok()?;
    let d2 = u8::from_str_radix(&code[2..3], 16).ok()?;
    let b = u8::from_str_radix(&code[3..5], 16).ok()?;
    Some([(sys << 6) | (d1 << 4) | d2, b])
}

impl Simulator {
    pub fn new(dtcs: Vec<Dtc>, vin: &str) -> Self {
        Self { dtcs, vin: vin.to_string(), echo: true, searched: false, tick: 0, input: Vec::new(), output: VecDeque::new(), overrides: HashMap::new(), header: None, session: 1, param_0100: 0, monitors_reset: false }
    }

    /// Demo car: misfire on cylinder 2, lean mixture, tired catalytic converter.
    pub fn demo() -> Self {
        let d = |code: &str, kind| Dtc { code: code.into(), kind };
        Self::new(
            vec![d("P0302", DtcKind::Stored), d("P0420", DtcKind::Stored), d("P0171", DtcKind::Pending)],
            "VF1RFB00X6W123456",
        )
    }

    pub fn with_codes(codes: &[String]) -> Self {
        let mut sim = Self::demo();
        sim.dtcs = codes.iter().filter_map(|c| crate::dtc::normalize(c)).map(|code| Dtc { code, kind: DtcKind::Stored }).collect();
        sim
    }

    /// Forces live values (physical units, keys of [`crate::pids::LIVE_PIDS`]).
    pub fn with_live(mut self, overrides: HashMap<String, f64>) -> Self {
        self.overrides = overrides;
        self
    }

    fn override_raw(&self, pid: u8) -> Option<Vec<u8>> {
        let def = crate::pids::LIVE_PIDS.iter().find(|d| d.pid == pid)?;
        let v = *self.overrides.get(def.key)?;
        let wobble = (self.tick % 3) as f64 - 1.0;
        let u16be = |x: f64| { let x = x.clamp(0.0, 65535.0) as u16; vec![(x >> 8) as u8, x as u8] };
        let u8c = |x: f64| vec![x.round().clamp(0.0, 255.0) as u8];
        Some(match def.key {
            "rpm" => u16be((v + wobble * 10.0) * 4.0),
            "coolant" | "intake_temp" => u8c(v + 40.0),
            "voltage" => u16be((v + wobble * 0.03) * 1000.0),
            "stft" | "ltft" => u8c((v + wobble) * 128.0 / 100.0 + 128.0),
            "load" | "throttle" => u8c(v * 255.0 / 100.0),
            "maf" => u16be(v * 100.0),
            _ => u8c(v),
        })
    }

    fn has_misfire(&self) -> bool {
        self.dtcs.iter().any(|d| d.code.starts_with("P030"))
    }

    fn respond(&mut self, cmd: &str) -> String {
        let cmd = cmd.trim().to_uppercase().replace(' ', "");
        if let Some(at) = cmd.strip_prefix("AT") {
            return match at {
                "Z" => {
                    self.echo = true;
                    self.searched = false;
                    "\r\rELM327 v1.5".into()
                }
                "E0" => {
                    self.echo = false;
                    "OK".into()
                }
                "DPN" => "A6".into(),
                sh if sh.starts_with("SH") => {
                    self.header = u16::from_str_radix(&sh[2..], 16).ok().filter(|h| *h != 0x7DF);
                    "OK".into()
                }
                "RV" => match self.overrides.get("voltage") {
                    Some(v) => format!("{v:.1}V"),
                    None => format!("{:.1}V", 12.4 + (self.tick % 5) as f64 * 0.1),
                },
                "I" => "ELM327 v1.5".into(),
                _ => "OK".into(),
            };
        }
        let prefix = if self.searched { String::new() } else { self.searched = true; "SEARCHING...\r".into() };
        self.tick = self.tick.wrapping_add(1);
        if let Some(h) = self.header {
            return format!("{prefix}{}", self.uds_respond(h, &cmd));
        }
        let body = match cmd.as_str() {
            "0100" => "41 00 BE 3E B8 13".into(),
            "0101" => {
                let stored = self.dtcs.iter().filter(|d| d.kind == DtcKind::Stored).count() as u8;
                let a = if stored > 0 { 0x80 | stored } else { 0 };
                if self.monitors_reset { format!("41 01 {a:02X} 67 E5 A5") } else { format!("41 01 {a:02X} 07 E5 00") }
            }
            "03" | "07" | "0A" => {
                let kind = match cmd.as_str() { "03" => DtcKind::Stored, "07" => DtcKind::Pending, _ => DtcKind::Permanent };
                self.dtc_response(kind)
            }
            "04" => {
                self.dtcs.clear();
                self.monitors_reset = true;
                "44".into()
            }
            "0902" => {
                let mut payload = vec![0x49, 0x02, 0x01];
                payload.extend_from_slice(self.vin.as_bytes());
                multiframe(&payload)
            }
            c if c.len() == 4 && c.starts_with("01") => match u8::from_str_radix(&c[2..], 16) {
                Ok(pid) => self.live(pid).map(|d| format!("41 {pid:02X} {}", hex(&d))).unwrap_or_else(|| "NO DATA".into()),
                Err(_) => "?".into(),
            },
            _ => "NO DATA".into(),
        };
        format!("{prefix}{body}")
    }

    /// Physical UDS requests: engine ECU (7E0) and gearbox (7E1) answer, others are silent.
    fn uds_respond(&mut self, ecu: u16, cmd: &str) -> String {
        if ecu != 0x7E0 && ecu != 0x7E1 {
            return "NO DATA".into();
        }
        let Ok(req) = (0..cmd.len()).step_by(2).map(|i| u8::from_str_radix(cmd.get(i..i + 2).unwrap_or("X"), 16)).collect::<std::result::Result<Vec<u8>, _>>() else {
            return "?".into();
        };
        let neg = |sid: u8, nrc: u8| hex(&[0x7F, sid, nrc]);
        let out: Vec<u8> = match req.as_slice() {
            [0x3E, s] => vec![0x7E, *s],
            [0x10, s] => {
                self.session = *s;
                vec![0x50, *s, 0x00, 0x32, 0x01, 0xF4]
            }
            [0x11, t] => {
                self.session = 1;
                vec![0x51, *t]
            }
            [0x22, hi, lo] => {
                let did = u16::from_be_bytes([*hi, *lo]);
                let value: Vec<u8> = match (ecu, did) {
                    (0x7E0, 0xF190) => self.vin.as_bytes().to_vec(),
                    (0x7E0, 0xF187) => b"8201234567".to_vec(),
                    (0x7E0, 0xF18C) => b"SIM0001234".to_vec(),
                    (0x7E0, 0xF195) => b"S3150 V1.02".to_vec(),
                    (0x7E0, 0xF197) => b"EMS3150".to_vec(),
                    (0x7E0, 0x0100) => vec![self.param_0100],
                    (0x7E1, 0xF187) => b"310320001R".to_vec(),
                    (0x7E1, 0xF197) => b"DP0 TCM".to_vec(),
                    _ => return neg(0x22, 0x31),
                };
                [vec![0x62, *hi, *lo], value].concat()
            }
            [0x2E, 0x01, 0x00, v] if ecu == 0x7E0 => {
                if self.session != 3 {
                    return neg(0x2E, 0x7F);
                }
                self.param_0100 = *v;
                vec![0x6E, 0x01, 0x00]
            }
            [0x2E, ..] => return neg(0x2E, 0x31),
            [0x19, 0x02, mask] => {
                let mut r = vec![0x59, 0x02, *mask];
                if ecu == 0x7E0 {
                    for d in &self.dtcs {
                        if let Some([a, b]) = encode(&d.code) {
                            let status = match d.kind { DtcKind::Stored => 0x8F, DtcKind::Pending => 0x24, DtcKind::Permanent => 0x88 };
                            r.extend([a, b, 0x00, status]);
                        }
                    }
                }
                r
            }
            [0x14, 0xFF, 0xFF, 0xFF] => {
                if ecu == 0x7E0 {
                    self.dtcs.clear();
                }
                vec![0x54]
            }
            [0x31, 0x01, hi, lo, ..] => vec![0x71, 0x01, *hi, *lo, 0x00],
            [sid, ..] => return neg(*sid, 0x11),
            [] => return "?".into(),
        };
        if out.len() <= 7 { hex(&out) } else { multiframe(&out) }
    }

    fn dtc_response(&self, kind: DtcKind) -> String {
        let codes: Vec<u8> = self.dtcs.iter().filter(|d| d.kind == kind).filter_map(|d| encode(&d.code)).flatten().collect();
        let mut payload = vec![kind.response_byte(), (codes.len() / 2) as u8];
        payload.extend(codes);
        if payload.len() <= 7 { hex(&payload) } else { multiframe(&payload) }
    }

    fn live(&self, pid: u8) -> Option<Vec<u8>> {
        if let Some(raw) = self.override_raw(pid) {
            return Some(raw);
        }
        let t = self.tick as f64;
        let jitter = if self.has_misfire() { ((t * 2.7).sin() * 60.0) as i32 } else { 0 };
        let rpm = (780.0 + (t / 3.0).sin() * 25.0) as i32 + jitter;
        let lean = self.dtcs.iter().any(|d| d.code == "P0171" || d.code == "P0174");
        Some(match pid {
            0x0C => { let v = (rpm * 4) as u16; vec![(v >> 8) as u8, v as u8] }
            0x0D => vec![0],
            0x05 => vec![(88 + 40 + (self.tick % 3)) as u8],
            0x04 => vec![(0.22 * 255.0) as u8],
            0x11 => vec![(0.15 * 255.0) as u8],
            0x0F => vec![(31 + 40) as u8],
            0x10 => { let v = 310u16 + (self.tick % 7) as u16 * 3; vec![(v >> 8) as u8, v as u8] }
            0x06 => vec![if lean { 128 + 14 + (self.tick % 4) as u8 } else { 128 + (self.tick % 3) as u8 }],
            0x07 => vec![if lean { 128 + 19 } else { 130 }],
            0x42 => { let v = 14_150u16 - (self.tick % 4) as u16 * 30; vec![(v >> 8) as u8, v as u8] }
            _ => return None,
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

/// Formats a payload like an ELM327 prints an ISO-TP multi-frame response with headers off.
fn multiframe(payload: &[u8]) -> String {
    let mut out = format!("{:03X}", payload.len());
    let (first, rest) = payload.split_at(payload.len().min(6));
    out.push_str(&format!("\r0: {}", hex(first)));
    for (i, chunk) in rest.chunks(7).enumerate() {
        out.push_str(&format!("\r{:X}: {}", (i + 1) % 16, hex(chunk)));
    }
    out
}

impl Transport for Simulator {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        for &b in data {
            if b == b'\r' {
                let cmd = String::from_utf8_lossy(&self.input).to_string();
                self.input.clear();
                let mut resp = String::new();
                if self.echo {
                    resp.push_str(&cmd);
                    resp.push('\r');
                }
                resp.push_str(&self.respond(&cmd));
                resp.push_str("\r\r>");
                self.output.extend(resp.bytes());
            } else {
                self.input.push(b);
            }
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8]) -> Result<usize> {
        let n = buf.len().min(self.output.len());
        for (i, b) in self.output.drain(..n).enumerate() {
            buf[i] = b;
        }
        Ok(n)
    }

    fn describe(&self) -> String {
        "Simulateur".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Elm327;

    #[test]
    fn encode_roundtrip() {
        for code in ["P0301", "P0420", "C0035", "B1234", "U0100", "P2A00"] {
            let [a, b] = encode(code).unwrap();
            assert_eq!(crate::dtc::decode(a, b), code);
        }
    }

    #[test]
    fn full_session_against_simulator() {
        let mut elm = Elm327::new(Box::new(Simulator::demo()));
        let info = elm.initialize().unwrap();
        assert_eq!(info.protocol_number, Some(6));
        assert!(info.elm_version.contains("ELM327"));

        let codes: Vec<_> = elm.read_all_dtcs().unwrap().into_iter().map(|d| (d.code, d.kind)).collect();
        assert_eq!(
            codes,
            [("P0302".into(), DtcKind::Stored), ("P0420".into(), DtcKind::Stored), ("P0171".into(), DtcKind::Pending)]
        );

        let status = elm.monitor_status().unwrap().unwrap();
        assert!(status.mil_on);
        assert_eq!(status.dtc_count, 2);

        let vehicle = elm.read_vehicle().unwrap();
        assert_eq!(vehicle.vin.as_deref(), Some("VF1RFB00X6W123456"));
        assert_eq!(vehicle.make.as_deref(), Some("Renault"));

        let live = elm.read_live().unwrap();
        assert_eq!(live.len(), crate::pids::LIVE_PIDS.len());
        assert!(elm.battery_voltage().unwrap().unwrap() > 12.0);

        elm.clear_dtcs().unwrap();
        assert!(elm.read_all_dtcs().unwrap().is_empty());
    }

    #[test]
    fn live_overrides() {
        let o = [("coolant".to_string(), 68.0), ("voltage".to_string(), 12.2)].into_iter().collect();
        let mut elm = Elm327::new(Box::new(Simulator::demo().with_live(o)));
        elm.initialize().unwrap();
        let live = elm.read_live().unwrap();
        let get = |k: &str| live.iter().find(|v| v.key == k).unwrap().value;
        assert!((get("coolant") - 68.0).abs() <= 1.0);
        assert!((get("voltage") - 12.2).abs() < 0.1);
        assert_eq!(elm.battery_voltage().unwrap(), Some(12.2));
    }

    #[test]
    fn many_codes_use_multiframe() {
        let codes: Vec<String> = ["P0301", "P0302", "P0303", "P0420", "P0171"].iter().map(|s| s.to_string()).collect();
        let mut elm = Elm327::new(Box::new(Simulator::with_codes(&codes)));
        elm.initialize().unwrap();
        let read: Vec<String> = elm.read_dtcs(DtcKind::Stored).unwrap().into_iter().map(|d| d.code).collect();
        assert_eq!(read, codes);
    }
}
