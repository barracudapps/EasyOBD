//! SAE J1939 (heavy vehicles: trucks, buses, agricultural and construction machines).
//!
//! * Frame parsing of ELM327 / STN monitor output with headers on (`ATH1`): 29-bit identifier then data.
//! * Multi-packet reassembly of broadcast messages (TP.CM BAM + TP.DT).
//! * DM1 (active faults, PGN 65226) / DM2 (previously active, PGN 65227) decoding into SPN / FMI / count.
//! * Explanations in plain language: per-SPN knowledge combined with the failure mode (FMI).

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::knowledge::{Cause, Diagnosis, KnowledgeBase, MatchKind, Severity, SensoryCheck, SolutionDef};

const EMBEDDED: &str = include_str!("../../../data/j1939.fr.json");

pub const PGN_DM1: u32 = 0xFECA;
pub const PGN_DM2: u32 = 0xFECB;
const PGN_TP_CM: u32 = 0xEC00;
const PGN_TP_DT: u32 = 0xEB00;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub priority: u8,
    pub pgn: u32,
    pub source: u8,
    pub data: Vec<u8>,
}

/// Decodes a 29-bit identifier into (priority, PGN, source address).
pub fn split_id(id: u32) -> (u8, u32, u8) {
    let priority = ((id >> 26) & 7) as u8;
    let dp = (id >> 24) & 3;
    let pf = (id >> 16) & 0xFF;
    let ps = (id >> 8) & 0xFF;
    let pgn = if pf < 240 { (dp << 16) | (pf << 8) } else { (dp << 16) | (pf << 8) | ps };
    (priority, pgn, (id & 0xFF) as u8)
}

/// Parses monitor output lines such as `18 FE CA 00 04 FF 6E 00 04 01 FF FF` or `18FECA00 04FF…`.
/// Noise (`SEARCHING...`, `STOPPED`, `BUFFER FULL`, prompts) is ignored.
pub fn parse_frames(raw: &str) -> Vec<Frame> {
    let mut out = Vec::new();
    for line in raw.split(['\r', '\n']) {
        let line = line.trim();
        if line.is_empty() || !line.chars().all(|c| c.is_ascii_hexdigit() || c == ' ') {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let (id_hex, rest): (String, &[&str]) = if tokens.first().is_some_and(|t| t.len() == 8) {
            (tokens[0].to_string(), &tokens[1..])
        } else if tokens.len() >= 4 && tokens[..4].iter().all(|t| t.len() == 2) {
            (tokens[..4].concat(), &tokens[4..])
        } else {
            // No spaces at all: "18FECA0004FF…"
            let compact: String = tokens.concat();
            if compact.len() < 10 || compact.len() % 2 != 0 {
                continue;
            }
            let id = compact[..8].to_string();
            let data: Option<Vec<u8>> = (8..compact.len()).step_by(2).map(|i| u8::from_str_radix(&compact[i..i + 2], 16).ok()).collect();
            if let (Ok(idv), Some(data)) = (u32::from_str_radix(&id, 16), data) {
                let (priority, pgn, source) = split_id(idv);
                out.push(Frame { priority, pgn, source, data });
            }
            continue;
        };
        let Ok(id) = u32::from_str_radix(&id_hex, 16) else { continue };
        let data: Option<Vec<u8>> = rest.iter().map(|t| u8::from_str_radix(t, 16).ok()).collect();
        let Some(data) = data else { continue };
        if data.is_empty() || data.len() > 8 {
            continue;
        }
        let (priority, pgn, source) = split_id(id);
        out.push(Frame { priority, pgn, source, data });
    }
    out
}

/// Returns complete messages (PGN, source, payload), reassembling BAM transfers.
pub fn assemble(frames: &[Frame]) -> Vec<(u32, u8, Vec<u8>)> {
    struct Bam {
        pgn: u32,
        size: usize,
        packets: u8,
        chunks: BTreeMap<u8, Vec<u8>>,
    }
    let mut pending: HashMap<u8, Bam> = HashMap::new();
    let mut out = Vec::new();
    for f in frames {
        match f.pgn & 0x3FF00 {
            PGN_TP_CM if f.data.len() >= 8 && f.data[0] == 0x20 => {
                let size = u16::from_le_bytes([f.data[1], f.data[2]]) as usize;
                let pgn = f.data[5] as u32 | (f.data[6] as u32) << 8 | (f.data[7] as u32) << 16;
                pending.insert(f.source, Bam { pgn, size, packets: f.data[3], chunks: BTreeMap::new() });
            }
            PGN_TP_DT if !f.data.is_empty() => {
                if let Some(b) = pending.get_mut(&f.source) {
                    b.chunks.insert(f.data[0], f.data[1..].to_vec());
                    if b.chunks.len() >= b.packets as usize {
                        let b = pending.remove(&f.source).unwrap();
                        let mut payload: Vec<u8> = b.chunks.into_values().flatten().collect();
                        payload.truncate(b.size);
                        out.push((b.pgn, f.source, payload));
                    }
                }
            }
            _ => out.push((f.pgn, f.source, f.data.clone())),
        }
    }
    out
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub struct Lamps {
    /// Malfunction indicator (emissions related).
    pub mil: bool,
    /// Red stop lamp: stop the vehicle.
    pub red_stop: bool,
    /// Amber warning lamp.
    pub amber_warning: bool,
    /// Protect lamp (non-electronic subsystem).
    pub protect: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct J1939Dtc {
    pub spn: u32,
    pub fmi: u8,
    /// Occurrence count (0–126, 127 = not available).
    pub occurrences: u8,
    pub source: u8,
}

impl J1939Dtc {
    pub fn code(&self) -> String {
        format!("SPN {} / FMI {}", self.spn, self.fmi)
    }
}

/// Decodes a DM1 / DM2 payload: 2 lamp bytes then 4 bytes per fault.
pub fn parse_dm(payload: &[u8], source: u8) -> (Lamps, Vec<J1939Dtc>) {
    let on = |b: u8, shift: u8| (b >> shift) & 3 == 1;
    let lamps = payload.first().map(|&b| Lamps { mil: on(b, 6), red_stop: on(b, 4), amber_warning: on(b, 2), protect: on(b, 0) }).unwrap_or_default();
    let mut dtcs = Vec::new();
    for c in payload.get(2..).unwrap_or(&[]).chunks_exact(4) {
        let spn = c[0] as u32 | (c[1] as u32) << 8 | ((c[2] as u32 & 0xE0) << 11);
        let fmi = c[2] & 0x1F;
        if spn == 0 || spn == 0x7FFFF {
            continue; // "no fault" placeholder / not available
        }
        dtcs.push(J1939Dtc { spn, fmi, occurrences: c[3] & 0x7F, source });
    }
    (lamps, dtcs)
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DmReport {
    pub lamps: Lamps,
    pub active: Vec<J1939Dtc>,
    /// Source addresses that answered (even without faults).
    pub sources: Vec<u8>,
}

/// Collects every DM1 seen in raw monitor output, merged by source, without duplicates.
pub fn read_dm1(raw: &str) -> DmReport {
    let mut r = DmReport::default();
    for (pgn, sa, payload) in assemble(&parse_frames(raw)) {
        if pgn != PGN_DM1 {
            continue;
        }
        let (l, dtcs) = parse_dm(&payload, sa);
        r.lamps.mil |= l.mil;
        r.lamps.red_stop |= l.red_stop;
        r.lamps.amber_warning |= l.amber_warning;
        r.lamps.protect |= l.protect;
        if !r.sources.contains(&sa) {
            r.sources.push(sa);
        }
        for d in dtcs {
            if !r.active.iter().any(|x| x.spn == d.spn && x.fmi == d.fmi && x.source == d.source) {
                r.active.push(d);
            }
        }
    }
    r
}

// ------------------------------------------------------------------------------------ knowledge

#[derive(Debug, Clone, Deserialize)]
struct FmiDef {
    short: String,
    long: String,
    kind: String,
    #[serde(default)]
    severity: Option<Severity>,
}

#[derive(Debug, Clone, Deserialize)]
struct SpnDef {
    spn: u32,
    name: String,
    system: String,
    severity: Severity,
    components: Vec<String>,
    how_it_works: String,
    description: String,
    sensory_checks: Vec<SensoryCheck>,
    value_causes: Vec<Cause>,
    solutions: Vec<SolutionDef>,
    #[serde(default)]
    drivable: Option<String>,
}

#[derive(Debug, Deserialize)]
struct J1939File {
    fmi: BTreeMap<String, FmiDef>,
    sources: BTreeMap<String, String>,
    spns: Vec<SpnDef>,
}

pub struct J1939Kb {
    fmi: BTreeMap<u8, FmiDef>,
    sources: BTreeMap<u8, String>,
    spns: BTreeMap<u32, SpnDef>,
}

impl J1939Kb {
    pub fn embedded() -> &'static J1939Kb {
        static KB: OnceLock<J1939Kb> = OnceLock::new();
        KB.get_or_init(|| {
            let f: J1939File = serde_json::from_str(EMBEDDED).expect("embedded J1939 data must be valid");
            J1939Kb {
                fmi: f.fmi.into_iter().filter_map(|(k, v)| Some((k.parse().ok()?, v))).collect(),
                sources: f.sources.into_iter().filter_map(|(k, v)| Some((k.parse().ok()?, v))).collect(),
                spns: f.spns.into_iter().map(|s| (s.spn, s)).collect(),
            }
        })
    }

    pub fn source_name(&self, sa: u8) -> String {
        self.sources.get(&sa).cloned().unwrap_or_else(|| format!("Calculateur 0x{sa:02X}"))
    }

    pub fn spn_count(&self) -> usize {
        self.spns.len()
    }

    /// Plain-language diagnosis for an SPN / FMI pair (generic explanation for unknown SPNs).
    pub fn diagnose(&self, kb: &KnowledgeBase, spn: u32, fmi: u8, make: Option<&str>) -> Diagnosis {
        let f = self.fmi.get(&fmi);
        let fshort = f.map(|f| f.short.as_str()).unwrap_or("Mode de défaillance inconnu");
        let flong = f.map(|f| f.long.as_str()).unwrap_or("");
        let kind = f.map(|f| f.kind.as_str()).unwrap_or("other");
        let code = format!("SPN {spn} / FMI {fmi}");
        let Some(s) = self.spns.get(&spn) else {
            return Diagnosis {
                code,
                match_kind: MatchKind::Generic,
                manufacturer_specific: spn >= 520_192,
                title: format!("Paramètre SPN {spn} : {}", fshort.to_lowercase()),
                description: format!(
                    "Ce paramètre n'est pas encore documenté dans EasyOBD. {flong} Le numéro SPN désigne la grandeur surveillée ; le FMI indique le type de défaillance. {}",
                    if spn >= 520_192 { "Les SPN à partir de 520192 sont propres au constructeur." } else { "" }
                )
                .trim()
                .to_string(),
                system: "Poids lourd (J1939)".into(),
                severity: f.and_then(|f| f.severity).unwrap_or(Severity::Medium),
                drivable: "Consultez la documentation du constructeur ou un atelier poids lourd. Un témoin rouge STOP impose de s'arrêter.".into(),
                how_it_works: None,
                sensory_checks: vec![],
                symptoms: vec![],
                components: vec![kb.component_ref("engine")],
                causes: vec![],
                solutions: vec![],
            };
        };
        let electrical = matches!(kind, "electrical");
        let mut causes: Vec<Cause> = if electrical {
            vec![
                Cause { text: "Connecteur débranché, oxydé ou broches écartées".into(), likelihood: 40 },
                Cause { text: "Faisceau coupé, écrasé ou frotté contre le châssis".into(), likelihood: 35 },
                Cause { text: format!("Capteur / actionneur « {} » défectueux", s.name.to_lowercase()), likelihood: 25 },
            ]
        } else if kind == "network" {
            vec![
                Cause { text: "Le calculateur qui fournit cette donnée ne communique plus (alimentation, fusible)".into(), likelihood: 45 },
                Cause { text: "Réseau CAN perturbé (connecteur, faisceau)".into(), likelihood: 35 },
                Cause { text: "Capteur relié à l'autre calculateur".into(), likelihood: 20 },
            ]
        } else {
            s.value_causes.clone()
        };
        causes.sort_by(|a, b| b.likelihood.cmp(&a.likelihood));
        let mut severity = s.severity;
        if let Some(fs) = f.and_then(|f| f.severity) {
            if fmi == 0 || fmi == 1 {
                severity = severity.max(fs);
            } else if fs == Severity::Low && severity > Severity::Low {
                severity = Severity::Medium.min(severity);
            }
        }
        let mut solutions: Vec<_> = s.solutions.iter().cloned().map(|x| kb.build_solution(x, make)).collect();
        if electrical {
            let wiring: SolutionDef = serde_json::from_value(serde_json::json!({
                "title": "Contrôler connecteur et faisceau", "difficulty": 2, "time_min": 20, "time_max": 90,
                "tools": ["Multimètre", "Nettoyant contacts", "Schéma électrique constructeur"],
                "steps": ["Couper le contact et le coupe-batterie", "Inspecter le connecteur (oxydation, eau, broches)", "Mesurer continuité et isolement jusqu'au calculateur", "Réparer, protéger (graisse diélectrique), effacer le défaut"],
                "parts": [{ "name": "Nettoyant contacts électriques", "query": "nettoyant contact électrique", "price_min": 6.0, "price_max": 12.0 }]
            }))
            .expect("static solution");
            solutions.insert(0, kb.build_solution(wiring, make));
        }
        Diagnosis {
            code,
            match_kind: MatchKind::Exact,
            manufacturer_specific: false,
            title: format!("{} : {}", s.name, fshort.to_lowercase()),
            description: format!("{} {flong}", s.description),
            system: s.system.clone(),
            severity,
            drivable: s.drivable.clone().unwrap_or_else(|| match severity {
                Severity::Critical => "Arrêtez-vous dès que possible en sécurité et faites intervenir un atelier poids lourd.".into(),
                Severity::High => "Roulez prudemment jusqu'à l'atelier le plus proche ; surveillez les témoins.".into(),
                _ => "Roulable : faites contrôler lors du prochain passage à l'atelier.".into(),
            }),
            how_it_works: Some(s.how_it_works.clone()),
            sensory_checks: s.sensory_checks.clone(),
            symptoms: vec![],
            components: s.components.iter().map(|c| kb.component_ref(c)).collect(),
            causes,
            solutions,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_and_dm1_single_frame() {
        assert_eq!(split_id(0x18FECA00), (6, PGN_DM1, 0));
        assert_eq!(split_id(0x18EBFF3D), (6, PGN_TP_DT, 0x3D));
        // Amber lamp on, SPN 110 FMI 0, 3 occurrences
        let raw = "18 FE CA 00 04 FF 6E 00 00 03 FF FF\r18FECA00 04 FF 6E 00 00 03 FF FF\rSTOPPED";
        let r = read_dm1(raw);
        assert!(r.lamps.amber_warning && !r.lamps.red_stop);
        assert_eq!(r.active, vec![J1939Dtc { spn: 110, fmi: 0, occurrences: 3, source: 0 }]);
    }

    #[test]
    fn bam_multi_packet_and_high_spn() {
        // Aftertreatment (SA 0x3D): 2 faults → 10-byte DM1 sent with BAM.
        // SPN 3251 (0x0CB3) FMI 0 ; SPN 520192 (0x7F000) FMI 31
        let spn2 = 520_192u32;
        let d2 = [(spn2 & 0xFF) as u8, ((spn2 >> 8) & 0xFF) as u8, (((spn2 >> 16) & 0x7) << 5) as u8 | 31, 1];
        let payload = [0x04, 0xFF, 0xB3, 0x0C, 0x00, 0x02, d2[0], d2[1], d2[2], d2[3]];
        let raw = format!(
            "18ECFF3D 20 0A 00 02 FF CA FE 00\r18EBFF3D 01 {}\r18EBFF3D 02 {} FF FF FF FF\r",
            payload[..7].iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" "),
            payload[7..].iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
        );
        let r = read_dm1(&raw);
        assert_eq!(r.active.len(), 2);
        assert_eq!(r.active[0].spn, 3251);
        assert_eq!(r.active[1].spn, spn2);
        assert_eq!(r.active[1].fmi, 31);
    }

    #[test]
    fn knowledge_is_consistent() {
        let kb = KnowledgeBase::embedded();
        let j = J1939Kb::embedded();
        assert!(j.spn_count() >= 40);
        for fmi in 0..32u8 {
            assert!(j.fmi.contains_key(&fmi), "FMI {fmi}");
        }
        for s in j.spns.values() {
            assert!(s.sensory_checks.len() >= 2, "SPN {}", s.spn);
            for c in &s.components {
                assert!(kb.component_info(c).is_some(), "SPN {}: unknown component {c}", s.spn);
            }
            for fmi in [0u8, 1, 3, 4, 7, 9, 31] {
                let d = j.diagnose(kb, s.spn, fmi, None);
                assert!(!d.causes.is_empty() && !d.title.is_empty(), "SPN {} FMI {fmi}", s.spn);
            }
        }
        let d = j.diagnose(kb, 110, 0, None);
        assert_eq!(d.severity, Severity::High);
        assert!(d.title.contains("refroidissement"));
        assert!(matches!(j.diagnose(kb, 999_999, 2, None).match_kind, MatchKind::Generic));
    }
}
