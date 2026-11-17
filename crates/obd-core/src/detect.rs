//! Adapter discovery and identification.
//!
//! Supported media:
//! * **USB** – FTDI, CH340, CP210x, PL2303 bridges and OBDLink (feature `serial`)
//! * **Bluetooth Classic** – paired SPP adapters exposed as serial ports (`/dev/cu.*`, `COMx`,
//!   `/dev/rfcomm*`) (feature `serial`)
//! * **Bluetooth LE** – scan by name / GATT service (feature `ble`)
//! * **Wi-Fi** – TCP on the usual dongle addresses (always available, also on mobile)
//! * **Simulator** – always available
//!
//! Each candidate is probed with `ATI` (and `STI` for STN chips) to confirm it is an OBD interpreter,
//! identify the chip and flag the common clone firmwares.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::transport::{TcpTransport, Transport};
use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnKind {
    Simulator,
    Wifi,
    Serial,
    Ble,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionSpec {
    pub kind: ConnKind,
    /// host:port (Wi-Fi), port path (serial), device id (BLE), scenario id (simulator, optional).
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub baud: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdapterCandidate {
    pub spec: ConnectionSpec,
    pub label: String,
    /// usb, bluetooth, ble, wifi, simulator
    pub medium: &'static str,
    /// The adapter answered as an OBD interpreter.
    pub verified: bool,
    pub chip: Option<String>,
    pub clone_suspected: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DiscoverOptions {
    #[serde(default = "yes")]
    pub serial: bool,
    #[serde(default = "yes")]
    pub wifi: bool,
    #[serde(default = "yes")]
    pub ble: bool,
    #[serde(default = "ble_secs")]
    pub ble_seconds: u64,
}

fn yes() -> bool {
    true
}
fn ble_secs() -> u64 {
    4
}

impl Default for DiscoverOptions {
    fn default() -> Self {
        Self { serial: true, wifi: true, ble: true, ble_seconds: 4 }
    }
}

/// Usual Wi-Fi ELM327 endpoints (the dongle is its own access point).
pub const WIFI_ENDPOINTS: &[(&str, u16)] = &[
    ("192.168.0.10", 35000),
    ("192.168.0.10", 23),
    ("192.168.1.10", 35000),
    ("192.168.0.123", 35000),
    ("192.168.4.1", 35000),
    ("192.168.0.74", 23),
];

/// Baud rates to try on serial adapters, most common first.
pub const BAUD_RATES: &[u32] = &[38400, 115_200, 9600, 230_400, 500_000, 57600];

/// Opens the transport described by `spec`.
pub fn open(spec: &ConnectionSpec) -> Result<Box<dyn Transport>> {
    match spec.kind {
        ConnKind::Simulator => {
            let sim = crate::training::scenario(&spec.address)
                .map(crate::training::simulator_for)
                .unwrap_or_else(crate::simulator::Simulator::demo);
            Ok(Box::new(sim))
        }
        ConnKind::Wifi => {
            let (host, port) = spec.address.rsplit_once(':').unwrap_or((spec.address.as_str(), "35000"));
            let port = port.parse().map_err(|_| Error::Protocol(format!("port invalide : {port}")))?;
            Ok(Box::new(TcpTransport::connect(host, port, Duration::from_secs(4))?))
        }
        #[cfg(feature = "serial")]
        ConnKind::Serial => Ok(Box::new(crate::transport::SerialTransport::open(&spec.address, spec.baud.unwrap_or(38400))?)),
        #[cfg(feature = "ble")]
        ConnKind::Ble => Ok(Box::new(crate::ble::BleTransport::connect(&spec.address)?)),
        #[allow(unreachable_patterns)]
        _ => Err(Error::Protocol("ce type de connexion n'est pas disponible sur cette plateforme".into())),
    }
}

/// Sends a command and collects the answer until `>` or `timeout`.
fn ask(t: &mut dyn Transport, cmd: &str, timeout: Duration) -> Option<String> {
    t.write_all(format!("{cmd}\r").as_bytes()).ok()?;
    let deadline = Instant::now() + timeout;
    let mut out = Vec::new();
    let mut buf = [0u8; 128];
    while Instant::now() < deadline {
        let n = t.read(&mut buf).ok()?;
        out.extend_from_slice(&buf[..n]);
        if out.contains(&b'>') {
            break;
        }
    }
    let s = String::from_utf8_lossy(&out).replace(['\0', '>'], "");
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Identity {
    pub chip: Option<String>,
    pub clone_suspected: bool,
    pub note: Option<String>,
}

/// Interprets `ATI` / `STI` answers.
pub fn classify(ati: &str, sti: Option<&str>) -> Identity {
    let line = |s: &str| {
        s.split(['\r', '\n'])
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.eq_ignore_ascii_case("ATI") && !l.eq_ignore_ascii_case("STI") && *l != "?")
            .last()
            .map(str::to_string)
    };
    if let Some(stn) = sti.and_then(line).filter(|l| l.to_uppercase().starts_with("STN")) {
        return Identity {
            chip: Some(stn),
            clone_suspected: false,
            note: Some("Puce STN (OBDLink / ScanTool) : rapide et compatible avec tous les protocoles.".into()),
        };
    }
    let Some(elm) = line(ati).filter(|l| l.to_uppercase().contains("ELM") || l.to_uppercase().contains("OBD")) else {
        return Identity::default();
    };
    let up = elm.to_uppercase();
    let clone = up.contains("V2.1") || up.contains("V1.5");
    Identity {
        chip: Some(elm),
        clone_suspected: clone,
        note: clone.then(|| {
            "Version typique des clones ELM327 : la lecture des codes fonctionne en général, mais certains \
             véhicules (protocoles anciens, multi-calculateurs) peuvent poser problème."
                .to_string()
        }),
    }
}

/// Probes an open transport: returns its identity if it answers like an OBD interpreter.
pub fn identify(t: &mut dyn Transport) -> Option<Identity> {
    let _ = ask(t, "", Duration::from_millis(300)); // flush a half-typed command
    let ati = ask(t, "ATI", Duration::from_millis(1200))?;
    let id = classify(&ati, None);
    id.chip.as_ref()?;
    let sti = ask(t, "STI", Duration::from_millis(600));
    Some(classify(&ati, sti.as_deref()))
}

fn candidate(spec: ConnectionSpec, label: String, medium: &'static str, id: Option<Identity>) -> AdapterCandidate {
    let verified = id.is_some();
    let id = id.unwrap_or_default();
    AdapterCandidate { spec, label, medium, verified, chip: id.chip, clone_suspected: id.clone_suspected, note: id.note }
}

fn discover_wifi() -> Vec<AdapterCandidate> {
    let handles: Vec<_> = WIFI_ENDPOINTS
        .iter()
        .map(|&(host, port)| {
            std::thread::spawn(move || {
                let mut t = TcpTransport::connect(host, port, Duration::from_millis(700)).ok()?;
                let id = identify(&mut t);
                let spec = ConnectionSpec { kind: ConnKind::Wifi, address: format!("{host}:{port}"), baud: None };
                Some(candidate(spec, format!("Wi-Fi {host}:{port}"), "wifi", id))
            })
        })
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
}

#[cfg(feature = "serial")]
fn discover_serial() -> Vec<AdapterCandidate> {
    use serialport::SerialPortType;
    const USB_BRIDGES: &[(u16, &str)] = &[(0x0403, "FTDI"), (0x1A86, "CH340"), (0x10C4, "CP210x"), (0x067B, "PL2303")];
    let Ok(ports) = serialport::available_ports() else { return vec![] };
    let mut out = Vec::new();
    for p in ports {
        let name = p.port_name.clone();
        let lower = name.to_lowercase();
        // macOS exposes each port twice (tty.* / cu.*): keep cu.*, skip system ports.
        if lower.starts_with("/dev/tty.") || lower.contains("bluetooth-incoming") || lower.contains("debug-console") || lower.contains("wlan-debug") {
            continue;
        }
        let (medium, label) = match &p.port_type {
            SerialPortType::UsbPort(info) => {
                let bridge = USB_BRIDGES.iter().find(|(v, _)| *v == info.vid).map(|(_, n)| *n).unwrap_or("USB");
                let product = info.product.clone().unwrap_or_default();
                ("usb", format!("USB {bridge} {product} ({name})").replace("  ", " "))
            }
            SerialPortType::BluetoothPort => ("bluetooth", format!("Bluetooth {name}")),
            _ if lower.contains("rfcomm") || lower.starts_with("/dev/cu.") => ("bluetooth", format!("Bluetooth {name}")),
            _ => ("usb", format!("Série {name}")),
        };
        let mut found = None;
        for &baud in BAUD_RATES {
            let Ok(mut t) = crate::transport::SerialTransport::open(&name, baud) else { break };
            if let Some(id) = identify(&mut t) {
                found = Some((baud, id));
                break;
            }
            if medium == "bluetooth" {
                break; // baud rate is irrelevant over RFCOMM
            }
        }
        let baud = found.as_ref().map(|f| f.0).or(Some(38400));
        let spec = ConnectionSpec { kind: ConnKind::Serial, address: name, baud };
        out.push(candidate(spec, label, medium, found.map(|f| f.1)));
    }
    out
}

#[cfg(feature = "ble")]
fn discover_ble(seconds: u64) -> (Vec<AdapterCandidate>, Option<String>) {
    match crate::ble::scan(Duration::from_secs(seconds)) {
        Ok(devs) => (
            devs.into_iter()
                .map(|d| {
                    let label = format!("Bluetooth LE {}{}", if d.name.is_empty() { &d.id } else { &d.name }, d.rssi.map(|r| format!(" ({r} dBm)")).unwrap_or_default());
                    AdapterCandidate {
                        spec: ConnectionSpec { kind: ConnKind::Ble, address: d.id, baud: None },
                        label,
                        medium: "ble",
                        verified: false,
                        chip: None,
                        clone_suspected: false,
                        note: Some(if d.known_service { "Service OBD BLE reconnu.".into() } else { "Reconnu par son nom.".into() }),
                    }
                })
                .collect(),
            None,
        ),
        Err(e) => (vec![], Some(e.to_string())),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Discovery {
    pub candidates: Vec<AdapterCandidate>,
    pub messages: Vec<String>,
}

/// Looks for adapters on every available medium. Verified adapters come first.
pub fn discover(opts: &DiscoverOptions) -> Discovery {
    let mut candidates = Vec::new();
    let mut messages = Vec::new();

    let wifi = opts.wifi.then(|| std::thread::spawn(discover_wifi));

    #[cfg(feature = "ble")]
    let ble = opts.ble.then(|| {
        let s = opts.ble_seconds;
        std::thread::spawn(move || discover_ble(s))
    });
    #[cfg(not(feature = "ble"))]
    if opts.ble {
        messages.push("Bluetooth LE non disponible dans cette version de l'application.".to_string());
    }

    #[cfg(feature = "serial")]
    if opts.serial {
        candidates.extend(discover_serial());
    }
    #[cfg(not(feature = "serial"))]
    if opts.serial {
        messages.push("USB / Bluetooth classique non disponibles sur cette plateforme : utilisez un adaptateur Wi-Fi ou BLE.".to_string());
    }

    if let Some(h) = wifi {
        let found = h.join().unwrap_or_default();
        if found.is_empty() {
            messages.push("Aucun adaptateur Wi-Fi : connectez d'abord le téléphone / l'ordinateur au réseau Wi-Fi du dongle (souvent « WiFi_OBDII »).".into());
        }
        candidates.extend(found);
    }
    #[cfg(feature = "ble")]
    if let Some(h) = ble {
        let (found, err) = h.join().unwrap_or_default();
        candidates.extend(found);
        messages.extend(err);
    }

    candidates.push(AdapterCandidate {
        spec: ConnectionSpec { kind: ConnKind::Simulator, address: String::new(), baud: None },
        label: "Simulateur (véhicule de démonstration)".into(),
        medium: "simulator",
        verified: true,
        chip: Some("ELM327 v1.5 (virtuel)".into()),
        clone_suspected: false,
        note: None,
    });
    candidates.sort_by_key(|c| (!c.verified, c.medium == "simulator"));
    Discovery { candidates, messages }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_chips() {
        let id = classify("ELM327 v2.1", None);
        assert!(id.clone_suspected);
        let id = classify("ATI\rELM327 v2.3", Some("?"));
        assert_eq!(id.chip.as_deref(), Some("ELM327 v2.3"));
        assert!(!id.clone_suspected);
        let id = classify("ELM327 v1.4b", Some("STN1110 v4.2.0"));
        assert_eq!(id.chip.as_deref(), Some("STN1110 v4.2.0"));
        assert_eq!(classify("garbage", None), Identity::default());
    }

    #[test]
    fn identifies_simulator() {
        let mut t = open(&ConnectionSpec { kind: ConnKind::Simulator, address: String::new(), baud: None }).unwrap();
        let id = identify(t.as_mut()).unwrap();
        assert!(id.chip.unwrap().contains("ELM327"));
    }

    #[test]
    fn simulator_can_play_a_scenario() {
        let spec = ConnectionSpec { kind: ConnKind::Simulator, address: "charging".into(), baud: None };
        let mut elm = crate::Elm327::new(open(&spec).unwrap());
        elm.initialize().unwrap();
        assert_eq!(elm.read_all_dtcs().unwrap()[0].code, "P0562");
    }
}
