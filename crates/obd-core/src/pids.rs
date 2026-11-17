//! Mode 01 live-data PIDs (SAE J1979) most useful for a quick health check.

use serde::Serialize;

#[derive(Debug, Clone, Copy)]
pub struct PidDef {
    pub pid: u8,
    pub key: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub min: f64,
    pub max: f64,
    pub bytes: usize,
    decode: fn(&[u8]) -> f64,
}

impl PidDef {
    pub fn decode(&self, data: &[u8]) -> Option<f64> {
        (data.len() >= self.bytes).then(|| (self.decode)(data))
    }
}

fn ab(d: &[u8]) -> f64 {
    d[0] as f64 * 256.0 + d[1] as f64
}

pub const LIVE_PIDS: &[PidDef] = &[
    PidDef { pid: 0x0C, key: "rpm", label: "Régime moteur", unit: "tr/min", min: 0.0, max: 7000.0, bytes: 2, decode: |d| ab(d) / 4.0 },
    PidDef { pid: 0x0D, key: "speed", label: "Vitesse", unit: "km/h", min: 0.0, max: 220.0, bytes: 1, decode: |d| d[0] as f64 },
    PidDef { pid: 0x05, key: "coolant", label: "Liquide de refroidissement", unit: "°C", min: -40.0, max: 130.0, bytes: 1, decode: |d| d[0] as f64 - 40.0 },
    PidDef { pid: 0x04, key: "load", label: "Charge moteur", unit: "%", min: 0.0, max: 100.0, bytes: 1, decode: |d| d[0] as f64 * 100.0 / 255.0 },
    PidDef { pid: 0x11, key: "throttle", label: "Papillon", unit: "%", min: 0.0, max: 100.0, bytes: 1, decode: |d| d[0] as f64 * 100.0 / 255.0 },
    PidDef { pid: 0x0F, key: "intake_temp", label: "Température d'admission", unit: "°C", min: -40.0, max: 80.0, bytes: 1, decode: |d| d[0] as f64 - 40.0 },
    PidDef { pid: 0x10, key: "maf", label: "Débit d'air (MAF)", unit: "g/s", min: 0.0, max: 200.0, bytes: 2, decode: |d| ab(d) / 100.0 },
    PidDef { pid: 0x06, key: "stft", label: "Correction court terme (B1)", unit: "%", min: -25.0, max: 25.0, bytes: 1, decode: |d| (d[0] as f64 - 128.0) * 100.0 / 128.0 },
    PidDef { pid: 0x07, key: "ltft", label: "Correction long terme (B1)", unit: "%", min: -25.0, max: 25.0, bytes: 1, decode: |d| (d[0] as f64 - 128.0) * 100.0 / 128.0 },
    PidDef { pid: 0x42, key: "voltage", label: "Tension calculateur", unit: "V", min: 10.0, max: 16.0, bytes: 2, decode: |d| ab(d) / 1000.0 },
];

pub fn find(key: &str) -> Option<&'static PidDef> {
    LIVE_PIDS.iter().find(|p| p.key == key)
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveValue {
    pub key: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub min: f64,
    pub max: f64,
    pub value: f64,
}

impl LiveValue {
    pub fn new(def: &PidDef, value: f64) -> Self {
        Self { key: def.key, label: def.label, unit: def.unit, min: def.min, max: def.max, value: (value * 10.0).round() / 10.0 }
    }
}

/// Mode 01 PID 01 – MIL status and number of confirmed DTCs.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct MonitorStatus {
    pub mil_on: bool,
    pub dtc_count: u8,
}

/// One readiness monitor (self-test run by the engine computer).
#[derive(Debug, Clone, Serialize)]
pub struct Monitor {
    pub name: &'static str,
    pub complete: bool,
}

/// Readiness monitors from mode 01 PID 01 (bytes B, C, D). Only supported monitors are returned.
pub fn decode_readiness(data: &[u8]) -> Vec<Monitor> {
    if data.len() < 4 {
        return vec![];
    }
    let (b, c, d) = (data[1], data[2], data[3]);
    let mut out = Vec::new();
    for (bit, name) in [(0, "Ratés d'allumage"), (1, "Système d'alimentation"), (2, "Composants")] {
        if b & (1 << bit) != 0 {
            out.push(Monitor { name, complete: b & (1 << (bit + 4)) == 0 });
        }
    }
    let diesel = b & 0x08 != 0;
    let names: [&str; 8] = if diesel {
        ["Catalyseur NMHC", "Traitement des NOx / SCR", "Réservé", "Pression de suralimentation", "Réservé", "Capteur de gaz d'échappement", "Filtre à particules", "EGR / distribution variable"]
    } else {
        ["Catalyseur", "Catalyseur chauffé", "Système EVAP", "Air secondaire", "Climatisation", "Sonde lambda", "Chauffage de sonde lambda", "EGR / distribution variable"]
    };
    for (bit, name) in names.iter().enumerate() {
        if c & (1 << bit) != 0 && *name != "Réservé" {
            out.push(Monitor { name, complete: d & (1 << bit) == 0 });
        }
    }
    out
}

pub fn decode_monitor_status(data: &[u8]) -> Option<MonitorStatus> {
    data.first().map(|a| MonitorStatus { mil_on: a & 0x80 != 0, dtc_count: a & 0x7F })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_common_pids() {
        assert_eq!(find("rpm").unwrap().decode(&[0x1A, 0xF8]), Some(1726.0));
        assert_eq!(find("coolant").unwrap().decode(&[0x7B]), Some(83.0));
        assert_eq!(find("stft").unwrap().decode(&[0x80]), Some(0.0));
        assert_eq!(find("rpm").unwrap().decode(&[0x1A]), None);
        let r = decode_readiness(&[0x82, 0x07, 0x65, 0x04]);
        assert_eq!(r.iter().filter(|m| m.complete).count(), r.len() - 1);
        assert!(r.iter().any(|m| m.name == "Système EVAP" && !m.complete));
        let s = decode_monitor_status(&[0x82]).unwrap();
        assert!(s.mil_on);
        assert_eq!(s.dtc_count, 2);
    }
}
