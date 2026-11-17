//! Expert mode – UDS (ISO 14229) over ISO-TP / CAN through the ELM327.
//!
//! Reading functions (ECU scan, identification, UDS fault codes) are safe. Writing functions
//! (WriteDataByIdentifier, RoutineControl, IO control, ECU reset) can change how the vehicle behaves
//! and are therefore gated:
//!
//! * services that can brick an ECU are **never** allowed (reprogramming / memory writes, security
//!   access automation): see [`is_allowed_service`];
//! * writes require explicit consent ([`ACK_PHRASE`]) handled by the application layer;
//! * [`check_write_preconditions`] refuses when the engine runs or the battery voltage is low;
//! * [`write_did_verified`] reads the old value first (for the undo journal) and reads back after.
//!
//! EasyOBD does not ship unverified, make-specific write recipes. Parameters come from user-imported
//! "packs" whose author is responsible for their content.

use std::time::Duration;

use serde::Serialize;

use crate::dtc;
use crate::{Elm327, Error, Result};

/// Phrase the user must type to unlock writes.
pub const ACK_PHRASE: &str = "J'ACCEPTE LES RISQUES";

pub const DISCLAIMER: &str = "Le mode expert permet d'envoyer des commandes qui modifient la configuration des calculateurs. \
Une mauvaise valeur peut désactiver une fonction de sécurité, empêcher le démarrage, entraîner une immobilisation ou un \
défaut de conformité au contrôle technique, et annuler la garantie constructeur. Vous agissez sous votre seule et entière \
responsabilité : les auteurs d'EasyOBD déclinent toute responsabilité pour tout dommage direct ou indirect. N'utilisez jamais \
ce mode véhicule en mouvement, moteur tournant, ou avec une batterie faible. Branchez un chargeur ou un maintien de tension.";

/// Known physical addresses on 11-bit CAN (ISO 15765-4 OBD range).
pub const OBD_ECUS: &[(u16, &str)] = &[
    (0x7E0, "Moteur (ECM)"),
    (0x7E1, "Boîte de vitesses (TCM)"),
    (0x7E2, "Calculateur 3 (hybride / ABS selon constructeur)"),
    (0x7E3, "Calculateur 4"),
    (0x7E4, "Calculateur 5 (batterie / BMS selon constructeur)"),
    (0x7E5, "Calculateur 6"),
    (0x7E6, "Calculateur 7"),
    (0x7E7, "Calculateur 8"),
];

/// Standard identification DIDs (ISO 14229-1 annex C).
pub const IDENT_DIDS: &[(u16, &str)] = &[
    (0xF190, "VIN"),
    (0xF187, "Référence pièce constructeur"),
    (0xF18A, "Identifiant fournisseur"),
    (0xF18C, "Numéro de série"),
    (0xF191, "Version matérielle constructeur"),
    (0xF192, "Référence matérielle fournisseur"),
    (0xF194, "Référence logicielle fournisseur"),
    (0xF195, "Version logicielle fournisseur"),
    (0xF197, "Nom du système"),
];

/// Services the app accepts to send from the expert console.
pub fn is_allowed_service(sid: u8) -> bool {
    matches!(
        sid,
        0x10 // DiagnosticSessionControl
        | 0x11 // ECUReset
        | 0x14 // ClearDiagnosticInformation
        | 0x19 // ReadDTCInformation
        | 0x22 // ReadDataByIdentifier
        | 0x2E // WriteDataByIdentifier (guarded)
        | 0x2F // InputOutputControlByIdentifier – actuator tests (guarded)
        | 0x31 // RoutineControl (guarded)
        | 0x3E // TesterPresent
    )
}

/// Services that modify the vehicle and need consent + preconditions.
pub fn is_write_service(sid: u8) -> bool {
    matches!(sid, 0x11 | 0x14 | 0x2E | 0x2F | 0x31) || (sid == 0x10)
}

pub fn nrc_text(nrc: u8) -> &'static str {
    match nrc {
        0x10 => "refus général",
        0x11 => "service non supporté",
        0x12 => "sous-fonction non supportée",
        0x13 => "longueur ou format de message incorrect",
        0x14 => "réponse trop longue",
        0x21 => "occupé, réessayer",
        0x22 => "conditions non remplies (moteur, vitesse, session…)",
        0x24 => "séquence de requêtes incorrecte",
        0x31 => "identifiant ou valeur hors plage",
        0x33 => "accès sécurisé requis",
        0x35 => "clé invalide",
        0x36 => "trop de tentatives",
        0x37 => "délai obligatoire non écoulé",
        0x72 => "échec de programmation",
        0x78 => "réponse en attente",
        0x7E => "sous-fonction non supportée dans cette session",
        0x7F => "service non supporté dans cette session",
        _ => "code de refus inconnu",
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

pub fn parse_hex_bytes(s: &str) -> Result<Vec<u8>> {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() || compact.len() % 2 != 0 {
        return Err(Error::Protocol("saisie hexadécimale invalide (nombre pair de chiffres attendu)".into()));
    }
    (0..compact.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&compact[i..i + 2], 16).map_err(|_| Error::Protocol(format!("octet invalide : {}", &compact[i..i + 2]))))
        .collect()
}

/// Human readable value of an identification DID.
pub fn display_value(bytes: &[u8]) -> String {
    let printable = bytes.iter().all(|b| b.is_ascii_graphic() || *b == b' ' || *b == 0);
    if printable && !bytes.is_empty() {
        String::from_utf8_lossy(bytes).trim_matches(char::from(0)).trim().to_string()
    } else {
        hex(bytes)
    }
}

impl Elm327 {
    /// Addresses physical requests to one ECU (11-bit CAN). Responses are filtered on `tx + 8`.
    pub fn uds_target(&mut self, tx: u16) -> Result<()> {
        if self.is_can() == Some(false) {
            return Err(Error::Protocol("le mode expert UDS nécessite un véhicule en CAN".into()));
        }
        self.command(&format!("ATSH{tx:03X}"))?;
        self.command(&format!("ATCRA{:03X}", tx + 8))?;
        Ok(())
    }

    /// Back to functional OBD addressing.
    pub fn uds_release(&mut self) -> Result<()> {
        self.command("ATCRA")?;
        self.command("ATSH7DF")?;
        Ok(())
    }

    /// Sends a raw UDS request to the current target, returns the positive response.
    pub fn uds(&mut self, req: &[u8]) -> Result<Vec<u8>> {
        let sid = *req.first().ok_or_else(|| Error::Protocol("requête vide".into()))?;
        if !is_allowed_service(sid) {
            return Err(Error::Protocol(format!("service 0x{sid:02X} interdit par EasyOBD (risque de rendre un calculateur inutilisable)")));
        }
        // Long operations answer 7F xx 78 ("response pending") first: give the ELM a longer timeout,
        // it keeps listening until the final answer arrives before printing the prompt.
        let saved = self.timeout;
        self.timeout = Duration::from_secs(8);
        let msgs = self.request(&hex(req).replace(' ', ""));
        self.timeout = saved;
        let msgs: Vec<Vec<u8>> = msgs?.into_iter().filter(|m| !(m.len() >= 3 && m[0] == 0x7F && m[2] == 0x78)).collect();
        if let Some(m) = msgs.iter().find(|m| m.len() >= 3 && m[0] == 0x7F && m[1] == sid) {
            return Err(Error::Protocol(format!("refus 0x{:02X} : {}", m[2], nrc_text(m[2]))));
        }
        msgs.into_iter()
            .find(|m| m.first() == Some(&(sid + 0x40)))
            .ok_or_else(|| Error::Protocol("pas de réponse du calculateur".into()))
    }

    pub fn uds_session(&mut self, session: u8) -> Result<()> {
        self.uds(&[0x10, session]).map(|_| ())
    }

    pub fn uds_read_did(&mut self, did: u16) -> Result<Vec<u8>> {
        let r = self.uds(&[0x22, (did >> 8) as u8, did as u8])?;
        Ok(r.get(3..).unwrap_or_default().to_vec())
    }

    /// UDS fault codes (19 02 with status mask 0xFF).
    pub fn uds_read_dtcs(&mut self) -> Result<Vec<UdsDtc>> {
        let r = self.uds(&[0x19, 0x02, 0xFF])?;
        Ok(r.get(3..).unwrap_or_default().chunks_exact(4).filter(|c| c[..3] != [0, 0, 0]).map(|c| UdsDtc::from_bytes(c)).collect())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UdsDtc {
    pub code: String,
    /// Failure type byte (ISO 15031-6 / SAE J2012-DA), e.g. 0x13 = circuit open.
    pub failure_type: u8,
    pub status: u8,
    pub confirmed: bool,
    pub pending: bool,
    pub mil: bool,
}

impl UdsDtc {
    fn from_bytes(c: &[u8]) -> Self {
        Self {
            code: dtc::decode(c[0], c[1]),
            failure_type: c[2],
            status: c[3],
            confirmed: c[3] & 0x08 != 0,
            pending: c[3] & 0x04 != 0,
            mil: c[3] & 0x80 != 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IdentValue {
    pub did: u16,
    pub name: &'static str,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EcuReport {
    pub tx: u16,
    pub name: &'static str,
    pub identification: Vec<IdentValue>,
    pub dtcs: Vec<UdsDtc>,
    pub error: Option<String>,
}

/// Probes every OBD address: which ECUs answer, their identification and UDS fault codes.
pub fn scan_ecus(elm: &mut Elm327) -> Result<Vec<EcuReport>> {
    let mut out = Vec::new();
    for &(tx, name) in OBD_ECUS {
        elm.uds_target(tx)?;
        // TesterPresent as a cheap presence probe.
        if elm.uds(&[0x3E, 0x00]).is_err() {
            continue;
        }
        let mut identification = Vec::new();
        for &(did, dname) in IDENT_DIDS {
            if let Ok(v) = elm.uds_read_did(did) {
                identification.push(IdentValue { did, name: dname, value: display_value(&v) });
            }
        }
        let (dtcs, error) = match elm.uds_read_dtcs() {
            Ok(d) => (d, None),
            Err(e) => (vec![], Some(e.to_string())),
        };
        out.push(EcuReport { tx, name, identification, dtcs, error });
    }
    elm.uds_release()?;
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct Preconditions {
    pub battery_v: Option<f64>,
    pub rpm: Option<f64>,
    pub ok: bool,
    pub problems: Vec<String>,
}

/// Engine off, ignition on, battery ≥ 12.2 V.
pub fn check_write_preconditions(elm: &mut Elm327) -> Result<Preconditions> {
    let battery_v = elm.battery_voltage()?;
    let rpm = elm.read_pid(crate::pids::find("rpm").expect("rpm pid"))?.map(|v| v.value);
    let mut problems = Vec::new();
    match battery_v {
        Some(v) if v < 12.2 => problems.push(format!("Tension batterie trop faible ({v:.1} V) : branchez un chargeur.")),
        None => problems.push("Tension batterie illisible.".into()),
        _ => {}
    }
    if rpm.unwrap_or(0.0) > 50.0 {
        problems.push("Le moteur tourne : coupez le moteur (contact mis).".into());
    }
    Ok(Preconditions { battery_v, rpm, ok: problems.is_empty(), problems })
}

#[derive(Debug, Clone, Serialize)]
pub struct WriteRecord {
    pub ecu: u16,
    pub did: u16,
    pub before: Option<String>,
    pub written: String,
    pub after: Option<String>,
    pub verified: bool,
}

/// Writes a DID in the extended session, with read-before (for undo) and read-back verification.
pub fn write_did_verified(elm: &mut Elm327, ecu: u16, did: u16, data: &[u8]) -> Result<WriteRecord> {
    let pre = check_write_preconditions(elm)?;
    if !pre.ok {
        return Err(Error::Protocol(pre.problems.join(" ")));
    }
    elm.uds_target(ecu)?;
    let result = (|| {
        elm.uds_session(0x03)?;
        let before = elm.uds_read_did(did).ok();
        let mut req = vec![0x2E, (did >> 8) as u8, did as u8];
        req.extend_from_slice(data);
        elm.uds(&req)?;
        let after = elm.uds_read_did(did).ok();
        Ok(WriteRecord {
            ecu,
            did,
            verified: after.as_deref() == Some(data),
            before: before.map(|b| hex(&b)),
            written: hex(data),
            after: after.map(|a| hex(&a)),
        })
    })();
    let _ = elm.uds_session(0x01);
    let _ = elm.uds_release();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simulator::Simulator;

    fn elm() -> Elm327 {
        let mut e = Elm327::new(Box::new(Simulator::demo()));
        e.initialize().unwrap();
        e
    }

    #[test]
    fn blocks_dangerous_services() {
        let mut e = elm();
        e.uds_target(0x7E0).unwrap();
        for sid in [0x27u8, 0x34, 0x36, 0x3D] {
            assert!(e.uds(&[sid, 0x01]).is_err());
        }
    }

    #[test]
    fn scans_ecus_on_simulator() {
        let mut e = elm();
        let ecus = scan_ecus(&mut e).unwrap();
        let engine = ecus.iter().find(|r| r.tx == 0x7E0).expect("engine ECU");
        assert!(engine.identification.iter().any(|i| i.did == 0xF190 && i.value == "VF1RFB00X6W123456"));
        assert!(engine.dtcs.iter().any(|d| d.code == "P0302" && d.confirmed));
        assert!(ecus.iter().any(|r| r.tx == 0x7E1));
        assert!(!ecus.iter().any(|r| r.tx == 0x7E5));
        // back to OBD mode
        assert!(!e.read_all_dtcs().unwrap().is_empty());
    }

    #[test]
    fn guarded_write_with_readback() {
        // Engine running: refused.
        assert!(write_did_verified(&mut elm(), 0x7E0, 0x0100, &[0x05]).is_err());

        let engine_off = [("rpm".to_string(), 0.0)].into_iter().collect();
        let mut e = Elm327::new(Box::new(Simulator::demo().with_live(engine_off)));
        e.initialize().unwrap();
        // Write outside extended session is refused by the ECU.
        e.uds_target(0x7E0).unwrap();
        let err = e.uds(&[0x2E, 0x01, 0x00, 0x05]).unwrap_err().to_string();
        assert!(err.contains("session"), "{err}");
        e.uds_release().unwrap();

        let rec = write_did_verified(&mut e, 0x7E0, 0x0100, &[0x05]).unwrap();
        assert!(rec.verified, "{rec:?}");
        assert_eq!(rec.before.as_deref(), Some("00"));
        assert_eq!(rec.after.as_deref(), Some("05"));
    }

    #[test]
    fn parses_hex_input() {
        assert_eq!(parse_hex_bytes("22 F1 90").unwrap(), vec![0x22, 0xF1, 0x90]);
        assert!(parse_hex_bytes("2").is_err());
        assert_eq!(display_value(b"EMS3150\0"), "EMS3150");
        assert_eq!(display_value(&[0x01, 0xFF]), "01 FF");
    }
}
