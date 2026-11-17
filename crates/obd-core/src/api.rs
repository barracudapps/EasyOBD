//! Single JSON API used by every front-end (Tauri native app and WebAssembly web build), so the
//! application logic exists only once.
//!
//! `Session::handle("command", args)` → JSON result or a French error message.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::audio::{self, AudioRequest};
use crate::detect::{self, ConnKind, ConnectionSpec, DiscoverOptions};
use crate::knowledge::KnowledgeBase;
use crate::inspection::Inspection;
use crate::maintenance::{Maintenance, VehicleProfile};
use crate::specs::Specs;
use crate::symptoms::{ExtraEvidence, SymptomGuide};
use crate::uds::{self, WriteRecord};
use crate::vin::VehicleInfo;
use crate::{training, Elm327, Error};

#[derive(Default)]
pub struct Session {
    elm: Option<Elm327>,
    vehicle: Option<VehicleInfo>,
    journal: Vec<WriteRecord>,
}

type R = std::result::Result<Value, String>;

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, key: &str) -> std::result::Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("paramètre « {key} » invalide : {e}"))
}

fn opt<T: for<'de> Deserialize<'de>>(args: &Value, key: &str) -> Option<T> {
    args.get(key).cloned().and_then(|v| serde_json::from_value(v).ok())
}

fn to_value<T: serde::Serialize>(v: T) -> R {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn e(err: Error) -> String {
    err.to_string()
}

/// DM1 report → `{ lamps, items: [{ code, kind, source, occurrences, diagnosis }] }` (same item shape as OBD codes).
fn j1939_items(report: &crate::j1939::DmReport, make: Option<&str>) -> Value {
    let kb = KnowledgeBase::embedded();
    let j = crate::j1939::J1939Kb::embedded();
    let mut active = report.active.clone();
    // Most severe first; derates (SPN 1569 / 5246) are consequences of another fault: list them last.
    let consequence = |spn: u32| matches!(spn, 1569 | 5246);
    let sev = |d: &crate::j1939::J1939Dtc| j.diagnose(kb, d.spn, d.fmi, None).severity;
    active.sort_by(|a, b| consequence(a.spn).cmp(&consequence(b.spn)).then(sev(b).cmp(&sev(a))));
    let items: Vec<Value> = active
        .iter()
        .map(|d| json!({ "code": d.code(), "kind": "active", "spn": d.spn, "fmi": d.fmi, "source": j.source_name(d.source), "occurrences": d.occurrences, "diagnosis": j.diagnose(kb, d.spn, d.fmi, make) }))
        .collect();
    json!({ "lamps": report.lamps, "items": items, "sources": report.sources.iter().map(|s| j.source_name(*s)).collect::<Vec<_>>() })
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    fn elm(&mut self) -> std::result::Result<&mut Elm327, String> {
        self.elm.as_mut().ok_or_else(|| Error::NotConnected.to_string())
    }

    fn make(&self) -> Option<String> {
        self.vehicle.as_ref().and_then(|v| v.make.clone())
    }

    fn require_ack(args: &Value) -> std::result::Result<(), String> {
        let ack: String = opt(args, "ack").unwrap_or_default();
        if ack.trim().to_uppercase() == uds::ACK_PHRASE {
            Ok(())
        } else {
            Err(format!("Opération bloquée : tapez « {} » pour confirmer que vous assumez les risques.", uds::ACK_PHRASE))
        }
    }

    pub fn handle(&mut self, cmd: &str, args: &Value) -> R {
        let kb = KnowledgeBase::embedded();
        let maint = Maintenance::embedded();
        match cmd {
            // ---- Knowledge base -----------------------------------------------------------------
            "kb_info" => {
                let mut components: HashMap<String, String> = kb.components.iter().map(|(k, v)| (k.clone(), v.name.clone())).collect();
                components.extend(maint.components.iter().map(|(k, v)| (k.clone(), v.name.clone())));
                Ok(json!({
                    "version": kb.version,
                    "labor_rate_eur_h": kb.labor_rate_eur_h,
                    "providers": kb.providers,
                    "components": components,
                    "catalog": kb.catalog(),
                }))
            }
            "kb_lookup" => {
                let code: String = arg(args, "code")?;
                let make = opt::<String>(args, "make").or_else(|| self.make());
                kb.lookup(&code, make.as_deref()).map(to_value).unwrap_or_else(|| Err(format!("« {code} » n'est pas un code OBD valide (ex. P0301)")))
            }

            // ---- Adapters & session -------------------------------------------------------------
            "discover" => {
                let opts: DiscoverOptions = opt(args, "options").unwrap_or_default();
                to_value(detect::discover(&opts))
            }
            "connect" => {
                let spec: ConnectionSpec = arg(args, "spec")?;
                self.elm = None;
                let mut elm = Elm327::new(detect::open(&spec).map_err(e)?);
                if opt::<bool>(args, "j1939").unwrap_or(false) {
                    // Heavy vehicle: J1939 only, no OBD-II probe / VIN / readiness.
                    let adapter = elm.initialize_j1939().map_err(e)?;
                    let battery = elm.battery_voltage().ok().flatten();
                    self.vehicle = Some(VehicleInfo::default());
                    self.elm = Some(elm);
                    return Ok(json!({ "adapter": adapter, "vehicle": VehicleInfo::default(), "monitor": null, "battery_v": battery, "simulated": spec.kind == ConnKind::Simulator, "j1939": true }));
                }
                let adapter = elm.initialize().map_err(e)?;
                let vehicle = elm.read_vehicle().unwrap_or_default();
                let monitor = elm.monitor_status().ok().flatten();
                let battery = elm.battery_voltage().ok().flatten();
                self.vehicle = Some(vehicle.clone());
                self.elm = Some(elm);
                Ok(json!({ "adapter": adapter, "vehicle": vehicle, "monitor": monitor, "battery_v": battery, "simulated": spec.kind == ConnKind::Simulator }))
            }
            "disconnect" => {
                self.elm = None;
                self.vehicle = None;
                Ok(Value::Null)
            }
            "read_dtcs" => {
                let make = self.make();
                let dtcs = self.elm()?.read_all_dtcs().map_err(e)?;
                let items: Vec<Value> = dtcs
                    .into_iter()
                    .map(|d| json!({ "code": d.code, "kind": d.kind, "diagnosis": kb.lookup(&d.code, make.as_deref()) }))
                    .collect();
                Ok(Value::Array(items))
            }
            "read_j1939" => {
                let make = opt::<String>(args, "make").or_else(|| self.make());
                let report = self.elm()?.read_j1939_dm1().map_err(e)?;
                Ok(j1939_items(&report, make.as_deref()))
            }
            "j1939_decode" => {
                // Browser build: raw ATDM1 monitor output captured by JavaScript.
                let raw: String = arg(args, "raw")?;
                let make: Option<String> = opt(args, "make");
                let report = crate::j1939::read_dm1(&raw);
                if report.sources.is_empty() {
                    return Err("aucun message J1939 reçu : contact mis ? prise poids lourd J1939 ?".into());
                }
                Ok(j1939_items(&report, make.as_deref()))
            }
            "j1939_lookup" => {
                let spn: u32 = arg(args, "spn")?;
                let fmi: u8 = arg(args, "fmi")?;
                to_value(crate::j1939::J1939Kb::embedded().diagnose(kb, spn, fmi, opt::<String>(args, "make").as_deref()))
            }
            "clear_dtcs" => {
                self.elm()?.clear_dtcs().map_err(e)?;
                Ok(Value::Null)
            }
            "read_live" => {
                let elm = self.elm()?;
                let values = elm.read_live().map_err(e)?;
                let battery = elm.battery_voltage().ok().flatten();
                Ok(json!({ "values": values, "battery_v": battery }))
            }

            // ---- Maintenance --------------------------------------------------------------------
            "maintenance_info" => Ok(json!({
                "disclaimer": maint.disclaimer,
                "vehicle_types": maint.vehicle_types,
                "profiles": maint.profiles,
            })),
            "tutorials_for" => {
                let p: VehicleProfile = arg(args, "profile")?;
                to_value(maint.tutorials_for(&p))
            }
            "tutorial" => {
                let id: String = arg(args, "id")?;
                let p: VehicleProfile = arg(args, "profile")?;
                let t = maint.tutorial_for(&id, &p).ok_or("tutoriel introuvable")?;
                let list = maint.shopping_list(kb, &id, &p);
                let specs = Specs::embedded();
                let alternatives: Vec<Value> = list
                    .as_ref()
                    .map(|l| l.items.iter().map(|i| json!(specs.alternatives_for(&i.name, &p))).collect())
                    .unwrap_or_default();
                Ok(json!({ "tutorial": t, "shopping": list, "alternatives": alternatives }))
            }

            "vehicle_sheet" => {
                let p: VehicleProfile = arg(args, "profile")?;
                to_value(Specs::embedded().sheet(&p))
            }
            "inspection_guide" => {
                let p: VehicleProfile = arg(args, "profile")?;
                to_value(Inspection::embedded().guide(&p))
            }
            "inspection_precheck" => {
                let elm = self.elm()?;
                let monitor = elm.monitor_status().map_err(e)?;
                let readiness = elm.readiness().map_err(e)?;
                let dtcs = elm.read_all_dtcs().map_err(e)?;
                let incomplete = readiness.iter().filter(|m| !m.complete).count();
                let mil = monitor.map(|m| m.mil_on).unwrap_or(false);
                let mut advice = Vec::new();
                if mil {
                    advice.push("Voyant moteur allumé : défaillance majeure au contrôle technique. Réparez avant de vous présenter.".to_string());
                }
                if !dtcs.is_empty() && !mil {
                    advice.push("Des codes sont enregistrés sans voyant : consultez-les, ils annoncent souvent un futur voyant.".to_string());
                }
                if incomplete > 0 {
                    advice.push(format!(
                        "{incomplete} autodiagnostic(s) non terminé(s) : les codes ont probablement été effacés récemment. Roulez 50 à 150 km \
                         (ville + voie rapide) avant le contrôle pour qu'ils se terminent."
                    ));
                }
                if advice.is_empty() {
                    advice.push("Tout est en ordre côté calculateur moteur.".to_string());
                }
                Ok(json!({ "mil_on": mil, "dtcs": dtcs, "readiness": readiness, "ready": !mil && dtcs.is_empty() && incomplete == 0, "advice": advice }))
            }

            // ---- Symptom questionnaire & audio --------------------------------------------------
            "symptoms_guide" => {
                let g = SymptomGuide::embedded();
                Ok(json!({ "intro": g.intro, "questions": g.questions }))
            }
            "symptoms_evaluate" => {
                let answers: HashMap<String, Vec<String>> = opt(args, "answers").unwrap_or_default();
                let extra: Vec<ExtraEvidence> = opt(args, "extra").unwrap_or_default();
                to_value(SymptomGuide::embedded().evaluate(kb, &answers, &extra))
            }
            "audio_analyze" => {
                let samples: Vec<f32> = arg(args, "samples")?;
                let req: AudioRequest = arg(args, "request")?;
                let report = audio::analyze(&samples, &req);
                let evidence = report.as_evidence();
                Ok(json!({ "report": report, "evidence": evidence }))
            }

            // ---- Training -----------------------------------------------------------------------
            "scenarios" => to_value(training::scenarios()),

            // ---- Expert mode (UDS) --------------------------------------------------------------
            "expert_info" => Ok(json!({
                "disclaimer": uds::DISCLAIMER,
                "ack_phrase": uds::ACK_PHRASE,
                "ecus": uds::OBD_ECUS.iter().map(|(a, n)| json!({ "tx": a, "name": n })).collect::<Vec<_>>(),
                "journal": self.journal,
            })),
            "uds_scan" => to_value(uds::scan_ecus(self.elm()?).map_err(e)?),
            "uds_preconditions" => to_value(uds::check_write_preconditions(self.elm()?).map_err(e)?),
            "uds_raw" => {
                let ecu: u16 = arg(args, "ecu")?;
                let req = uds::parse_hex_bytes(&arg::<String>(args, "request")?).map_err(e)?;
                if uds::is_write_service(req[0]) {
                    Self::require_ack(args)?;
                    let pre = uds::check_write_preconditions(self.elm()?).map_err(e)?;
                    if !pre.ok {
                        return Err(pre.problems.join(" "));
                    }
                }
                let elm = self.elm()?;
                elm.uds_target(ecu).map_err(e)?;
                let res = elm.uds(&req);
                let _ = elm.uds_release();
                Ok(json!({ "request": uds::hex(&req), "response": uds::hex(&res.map_err(e)?) }))
            }
            "uds_write" => {
                Self::require_ack(args)?;
                let ecu: u16 = arg(args, "ecu")?;
                let did: u16 = arg(args, "did")?;
                let data = uds::parse_hex_bytes(&arg::<String>(args, "data")?).map_err(e)?;
                let rec = uds::write_did_verified(self.elm()?, ecu, did, &data).map_err(e)?;
                self.journal.push(rec.clone());
                to_value(rec)
            }

            _ => Err(format!("commande inconnue : {cmd}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_to_end_through_api() {
        let mut s = Session::new();
        assert!(s.handle("read_dtcs", &Value::Null).is_err());
        let r = s.handle("connect", &json!({ "spec": { "kind": "simulator", "address": "misfire-rain" } })).unwrap();
        assert_eq!(r["vehicle"]["make"], "Renault");
        let dtcs = s.handle("read_dtcs", &Value::Null).unwrap();
        assert_eq!(dtcs[0]["code"], "P0302");
        assert!(dtcs[0]["diagnosis"]["solutions"][0]["parts"][0]["links"][0]["url"].as_str().unwrap().contains("Renault"));
        assert!(s.handle("read_live", &Value::Null).unwrap()["values"].as_array().unwrap().len() > 5);

        // Writes need the consent phrase.
        let w = json!({ "ecu": 0x7E0, "did": 0x0100, "data": "05" });
        assert!(s.handle("uds_write", &w).unwrap_err().contains("ACCEPTE"));
        assert!(s.handle("uds_raw", &json!({ "ecu": 0x7E0, "request": "22F190" })).unwrap()["response"].as_str().unwrap().starts_with("62 F1 90"));

        // Heavy vehicle (J1939) on the simulator
        let r = s.handle("connect", &json!({ "spec": { "kind": "simulator", "address": "" }, "j1939": true })).unwrap();
        assert_eq!(r["j1939"], true);
        let j = s.handle("read_j1939", &Value::Null).unwrap();
        assert_eq!(j["items"].as_array().unwrap().len(), 3);
        assert!(j["lamps"]["red_stop"] == false && j["lamps"]["mil"] == true);
        assert!(j["items"][0]["diagnosis"]["title"].as_str().unwrap().contains("FAP"));
        assert_eq!(j["items"][0]["source"], "Post-traitement (échappement)");
        assert_eq!(j["items"][2]["spn"], 1569);

        let info = s.handle("kb_info", &Value::Null).unwrap();
        assert!(info["components"]["oil_filter"].is_string());
        let g = s.handle("symptoms_evaluate", &json!({ "answers": { "noises": ["click_turn"] } })).unwrap();
        assert_eq!(g["hypotheses"][0]["id"], "cv_joint");
        let p = Maintenance::embedded().profiles.iter().find(|p| p.id == "renault-clio4-dci90").unwrap();
        let t = s.handle("tutorial", &json!({ "id": "oil_change", "profile": p })).unwrap();
        assert!(t["shopping"]["items"].as_array().unwrap().len() >= 3);
        assert!(t["alternatives"][0].as_array().unwrap().len() >= 1);
        assert!(s.handle("vehicle_sheet", &json!({ "profile": p })).unwrap()["sections"].as_array().unwrap().len() >= 4);
        assert!(s.handle("inspection_guide", &json!({ "profile": p })).unwrap()["sections"].as_array().unwrap().len() >= 5);
        let pre = s.handle("inspection_precheck", &Value::Null).unwrap();
        assert_eq!(pre["ready"], false); // misfire code stored
        s.handle("clear_dtcs", &Value::Null).unwrap();
        let pre = s.handle("inspection_precheck", &Value::Null).unwrap();
        assert_eq!(pre["ready"], false); // monitors reset by the clear
        assert!(pre["advice"][0].as_str().unwrap().contains("autodiagnostic"));
        assert!(s.handle("bogus", &Value::Null).is_err());
    }
}
