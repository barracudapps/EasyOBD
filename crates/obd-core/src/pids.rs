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
        let s = decode_monitor_status(&[0x82]).unwrap();
        assert!(s.mil_on);
        assert_eq!(s.dtc_count, 2);
    }
}
