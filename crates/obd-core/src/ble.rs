//! Bluetooth Low Energy ELM327 adapters (feature `ble`).
//!
//! BLE OBD dongles expose a UART-like GATT service: one characteristic to write commands and one
//! to receive notifications. Vendors use different UUIDs, so we look for any service holding both a
//! writable and a notifying characteristic, preferring the well-known ones.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::Duration;

use btleplug::api::{Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::StreamExt;
use tokio::runtime::Runtime;

use crate::transport::{Transport, POLL_TIMEOUT};
use crate::{Error, Result};

/// 16-bit service UUIDs commonly used by BLE OBD adapters (FFF0: Vgate/Konnwei/most clones,
/// FFE0: HM-10 based, 18F0: Veepeak/OBDLink), plus OBDLink CX's 128-bit service.
const KNOWN_SERVICES: &[&str] = &["0000fff0", "0000ffe0", "000018f0", "e7810a71"];

/// Name fragments of BLE OBD adapters (case-insensitive).
pub const NAME_HINTS: &[&str] = &[
    "obd", "elm", "vgate", "icar", "veepeak", "vlink", "v-link", "obdlink", "konnwei", "carista", "lelink", "kiwi",
    "viecar", "bafx", "ancel", "thinkcar", "autophix", "foseal", "obdii",
];

#[derive(Debug, Clone, serde::Serialize)]
pub struct BleDevice {
    pub id: String,
    pub name: String,
    pub rssi: Option<i16>,
    pub known_service: bool,
}

fn err<E: std::fmt::Display>(e: E) -> Error {
    Error::Protocol(format!("Bluetooth LE : {e}"))
}

fn runtime() -> Result<Runtime> {
    tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().map_err(err)
}

async fn first_adapter() -> Result<Adapter> {
    let manager = Manager::new().await.map_err(err)?;
    manager
        .adapters()
        .await
        .map_err(err)?
        .into_iter()
        .next()
        .ok_or_else(|| Error::Protocol("aucun adaptateur Bluetooth disponible (Bluetooth désactivé ?)".into()))
}

fn looks_like_obd(name: &str, services: &[String]) -> (bool, bool) {
    let lower = name.to_lowercase();
    let known = services.iter().any(|s| KNOWN_SERVICES.iter().any(|k| s.starts_with(k)));
    (known || NAME_HINTS.iter().any(|h| lower.contains(h)), known)
}

/// Scans for BLE devices that look like OBD adapters.
pub fn scan(duration: Duration) -> Result<Vec<BleDevice>> {
    let rt = runtime()?;
    rt.block_on(async {
        let central = first_adapter().await?;
        central.start_scan(ScanFilter::default()).await.map_err(err)?;
        tokio::time::sleep(duration).await;
        let _ = central.stop_scan().await;
        let mut out = Vec::new();
        for p in central.peripherals().await.map_err(err)? {
            let Ok(Some(props)) = p.properties().await else { continue };
            let name = props.local_name.unwrap_or_default();
            let services: Vec<String> = props.services.iter().map(|u| u.to_string()).collect();
            let (obd, known) = looks_like_obd(&name, &services);
            if obd {
                out.push(BleDevice { id: p.id().to_string(), name, rssi: props.rssi, known_service: known });
            }
        }
        out.sort_by_key(|d| std::cmp::Reverse(d.rssi.unwrap_or(-127)));
        Ok(out)
    })
}

pub struct BleTransport {
    rt: Runtime,
    peripheral: Peripheral,
    write_char: Characteristic,
    write_type: WriteType,
    rx: Receiver<Vec<u8>>,
    pending: Vec<u8>,
    name: String,
}

impl BleTransport {
    /// Connects to a device found by [`scan`] (by id).
    pub fn connect(id: &str) -> Result<Self> {
        let rt = runtime()?;
        let (peripheral, name, write_char, write_type, rx) = rt.block_on(async {
            let central = first_adapter().await?;
            central.start_scan(ScanFilter::default()).await.map_err(err)?;
            let mut found = None;
            for _ in 0..30 {
                tokio::time::sleep(Duration::from_millis(200)).await;
                found = central.peripherals().await.map_err(err)?.into_iter().find(|p| p.id().to_string() == id);
                if found.is_some() {
                    break;
                }
            }
            let _ = central.stop_scan().await;
            let p = found.ok_or_else(|| Error::Protocol(format!("appareil Bluetooth {id} introuvable")))?;
            let name = p.properties().await.ok().flatten().and_then(|pr| pr.local_name).unwrap_or_else(|| id.to_string());
            p.connect().await.map_err(err)?;
            p.discover_services().await.map_err(err)?;

            // Choose the service with a notify + write pair, preferring known UUIDs.
            let mut best: Option<(bool, Characteristic, Characteristic)> = None;
            for s in p.services() {
                let known = KNOWN_SERVICES.iter().any(|k| s.uuid.to_string().starts_with(k));
                let notify = s.characteristics.iter().find(|c| c.properties.intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE));
                let write = s
                    .characteristics
                    .iter()
                    .find(|c| c.properties.intersects(CharPropFlags::WRITE | CharPropFlags::WRITE_WITHOUT_RESPONSE));
                if let (Some(n), Some(w)) = (notify, write) {
                    if best.as_ref().map_or(true, |b| known && !b.0) {
                        best = Some((known, n.clone(), w.clone()));
                    }
                }
            }
            let (_, notify, write) = best.ok_or_else(|| Error::Protocol("service série BLE introuvable sur cet appareil".into()))?;
            let write_type = if write.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
                WriteType::WithoutResponse
            } else {
                WriteType::WithResponse
            };
            p.subscribe(&notify).await.map_err(err)?;
            let mut stream = p.notifications().await.map_err(err)?;
            let (tx, rx) = mpsc::channel();
            let uuid = notify.uuid;
            tokio::spawn(async move {
                while let Some(n) = stream.next().await {
                    if n.uuid == uuid && tx.send(n.value).is_err() {
                        break;
                    }
                }
            });
            Ok::<_, Error>((p, name, write, write_type, rx))
        })?;
        Ok(Self { rt, peripheral, write_char, write_type, rx, pending: Vec::new(), name })
    }
}

impl Transport for BleTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        // Default ATT MTU allows 20-byte payloads.
        for chunk in data.chunks(20) {
            self.rt
                .block_on(self.peripheral.write(&self.write_char, chunk, self.write_type))
                .map_err(err)?;
        }
        Ok(())
    }

    fn read(&mut self, buf: &mut [u8]) -> Result<usize> {
        if self.pending.is_empty() {
            match self.rx.recv_timeout(POLL_TIMEOUT) {
                Ok(v) => self.pending = v,
                Err(RecvTimeoutError::Timeout) => return Ok(0),
                Err(RecvTimeoutError::Disconnected) => return Err(Error::Protocol("Bluetooth LE déconnecté".into())),
            }
        }
        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }

    fn describe(&self) -> String {
        format!("Bluetooth LE {}", self.name)
    }
}

impl Drop for BleTransport {
    fn drop(&mut self) {
        let _ = self.rt.block_on(self.peripheral.disconnect());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_adapters() {
        assert!(looks_like_obd("Vgate iCar Pro", &[]).0);
        assert!(looks_like_obd("IOS-Vlink", &[]).0);
        assert!(looks_like_obd("", &["0000fff0-0000-1000-8000-00805f9b34fb".into()]).1);
        assert!(!looks_like_obd("JBL Flip 5", &["0000110b-0000-1000-8000-00805f9b34fb".into()]).0);
    }
}
