//! Maintenance tutorials and vehicle-specific shopping lists.
//!
//! Data: `data/maintenance.fr.json` – vehicle profiles (car, van, motorcycle, truck), illustrated
//! step-by-step tutorials (each step lists the 3D components to highlight), and shopping list
//! templates whose quantities and search terms are resolved against the selected vehicle profile.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::knowledge::{ComponentInfo, KnowledgeBase, SensoryCheck, ShopLink};
use crate::{Error, Result};

const EMBEDDED: &str = include_str!("../../../data/maintenance.fr.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VehicleType {
    pub id: String,
    pub name: String,
    pub icon: String,
}

/// A vehicle profile. Seed profiles ship with the app; users can create custom ones.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VehicleProfile {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type")]
    pub vehicle_type: String,
    pub make: String,
    pub model: String,
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub years: Option<[u16; 2]>,
    /// petrol, diesel, hybrid, electric
    pub fuel: String,
    #[serde(default)]
    pub cylinders: Option<u32>,
    #[serde(default)]
    pub oil_capacity_l: Option<f64>,
    #[serde(default)]
    pub oil_spec: Option<String>,
    #[serde(default)]
    pub coolant_l: Option<f64>,
    #[serde(default)]
    pub chain: Option<String>,
    /// Driven axle(s): "front", "rear" or "both". Absent = front (most cars).
    #[serde(default)]
    pub traction: Option<String>,
    /// Body style (3D silhouette). Cars: hatch, sedan, estate, suv, mpv, coupe, supercar, pickup, micro.
    /// Tractors: tractor.
    /// Motorcycles: naked, adventure, sport, cruiser, scooter.
    #[serde(default)]
    pub body: Option<String>,
    /// Motorcycles: chain (default), shaft, belt, cvt (scooter variator) or hub (hub motor).
    #[serde(default)]
    pub final_drive: Option<String>,
    /// Cars: "front" (default), "mid" (behind the seats: Ferrari, Lamborghini, Lotus…) or "rear" (Porsche 911).
    #[serde(default)]
    pub engine_position: Option<String>,
}

impl VehicleProfile {
    /// Final drive, defaulting to a chain for motorcycles (None for other vehicles).
    pub fn final_drive_kind(&self) -> Option<&str> {
        match (&self.final_drive, self.vehicle_type.as_str()) {
            (Some(f), _) => Some(f.as_str()),
            (None, "motorcycle") => Some("chain"),
            _ => None,
        }
    }

    pub fn label(&self) -> String {
        format!("{} {} {}", self.make, self.model, self.engine).trim().to_string()
    }

    fn number(&self, field: &str) -> Option<f64> {
        match field {
            "oil_capacity_l" => self.oil_capacity_l,
            "coolant_l" => self.coolant_l,
            "cylinders" => self.cylinders.map(f64::from),
            _ => None,
        }
    }

    /// Replaces `{oil_spec}`, `{chain}`… in templates. Unknown values are removed.
    fn fill(&self, s: &str) -> String {
        let out = s
            .replace("{oil_spec}", self.oil_spec.as_deref().unwrap_or(""))
            .replace("{chain}", self.chain.as_deref().unwrap_or(""))
            .replace("{make}", &self.make)
            .replace("{model}", &self.model);
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TutorialStep {
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub tip: Option<String>,
    #[serde(default)]
    pub warning: Option<String>,
    /// Where a vehicle-specific step comes from (e.g. "Manuel du propriétaire Tesla").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ProcMatch {
    #[serde(default)]
    make: Option<String>,
    #[serde(default)]
    fuel: Option<String>,
    #[serde(default)]
    model_contains: Vec<String>,
    #[serde(default)]
    final_drive: Option<String>,
}

/// Vehicle-specific additions to tutorials (owner's manual procedures, EV safety…).
#[derive(Debug, Clone, Deserialize)]
struct Procedure {
    #[serde(rename = "match")]
    when: ProcMatch,
    tutorials: Vec<String>,
    #[serde(default)]
    steps_before: Vec<TutorialStep>,
    #[serde(default)]
    replace_steps: Vec<TutorialStep>,
    #[serde(default)]
    notes: Vec<String>,
}

impl Procedure {
    fn applies(&self, tutorial: &str, p: &VehicleProfile) -> bool {
        let w = &self.when;
        (self.tutorials.iter().any(|t| t == "*" || t == tutorial))
            && w.make.as_ref().is_none_or(|m| m == &p.make)
            && w.fuel.as_ref().is_none_or(|f| f == &p.fuel)
            && (w.model_contains.is_empty() || w.model_contains.iter().any(|m| p.model.contains(m.as_str())))
            && w.final_drive.as_ref().is_none_or(|f| Some(f.as_str()) == p.final_drive_kind())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShoppingTemplate {
    name: String,
    query: String,
    #[serde(default)]
    qty: Option<f64>,
    #[serde(default)]
    qty_from: Option<String>,
    #[serde(default)]
    round_up: bool,
    unit: String,
    price_min: f64,
    price_max: f64,
    #[serde(default)]
    optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tutorial {
    pub id: String,
    pub title: String,
    pub vehicle_types: Vec<String>,
    pub fuels: Vec<String>,
    /// Restricts a motorcycle tutorial to some final drives (e.g. chain maintenance → `["chain"]`).
    #[serde(default)]
    pub final_drives: Vec<String>,
    pub interval: String,
    /// Typical interval used for reminders (the manufacturer schedule prevails).
    #[serde(default)]
    pub interval_km: Option<u32>,
    #[serde(default)]
    pub interval_months: Option<u32>,
    pub difficulty: u8,
    pub time_min: u32,
    pub time_max: u32,
    pub why: String,
    #[serde(default)]
    pub sensory_checks: Vec<SensoryCheck>,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub safety: Vec<String>,
    #[serde(default)]
    shopping: Vec<ShoppingTemplate>,
    pub steps: Vec<TutorialStep>,
    /// Vehicle-specific notes added by [`Maintenance::tutorial_for`].
    #[serde(default)]
    pub vehicle_notes: Vec<String>,
}

impl Tutorial {
    pub fn applies_to(&self, p: &VehicleProfile) -> bool {
        self.vehicle_types.contains(&p.vehicle_type)
            && self.fuels.contains(&p.fuel)
            && (self.final_drives.is_empty() || p.final_drive_kind().is_some_and(|f| self.final_drives.iter().any(|x| x == f)))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ShoppingItem {
    pub name: String,
    pub qty: f64,
    pub unit: String,
    pub optional: bool,
    /// Whether the quantity comes from the vehicle profile (otherwise a default was used).
    pub qty_known: bool,
    pub price_min: f64,
    pub price_max: f64,
    pub links: Vec<ShopLink>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShoppingList {
    pub tutorial_id: String,
    pub vehicle: String,
    pub items: Vec<ShoppingItem>,
    /// Totals of the required (non-optional) items.
    pub total_min: f64,
    pub total_max: f64,
    pub labor_min: f64,
    pub labor_max: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TutorialSummary {
    pub id: String,
    pub title: String,
    pub interval: String,
    pub interval_km: Option<u32>,
    pub interval_months: Option<u32>,
    pub difficulty: u8,
    pub time_min: u32,
    pub time_max: u32,
}

#[derive(Debug, Deserialize)]
struct MaintenanceFile {
    version: String,
    disclaimer: String,
    vehicle_types: Vec<VehicleType>,
    components: BTreeMap<String, ComponentInfo>,
    profiles: Vec<VehicleProfile>,
    tutorials: Vec<Tutorial>,
    #[serde(default)]
    procedures: Vec<Procedure>,
}

pub struct Maintenance {
    pub version: String,
    pub disclaimer: String,
    pub vehicle_types: Vec<VehicleType>,
    pub components: BTreeMap<String, ComponentInfo>,
    pub profiles: Vec<VehicleProfile>,
    pub tutorials: Vec<Tutorial>,
    procedures: Vec<Procedure>,
}

impl Maintenance {
    pub fn embedded() -> &'static Maintenance {
        static M: OnceLock<Maintenance> = OnceLock::new();
        M.get_or_init(|| Maintenance::from_json(EMBEDDED).expect("embedded maintenance data must be valid"))
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let f: MaintenanceFile = serde_json::from_str(json).map_err(|e| Error::KnowledgeBase(format!("maintenance : {e}")))?;
        Ok(Self {
            version: f.version,
            disclaimer: f.disclaimer,
            vehicle_types: f.vehicle_types,
            components: f.components,
            profiles: f.profiles,
            tutorials: f.tutorials,
            procedures: f.procedures,
        })
    }

    pub fn tutorials_for(&self, p: &VehicleProfile) -> Vec<TutorialSummary> {
        self.tutorials
            .iter()
            .filter(|t| t.applies_to(p))
            .map(|t| TutorialSummary {
                id: t.id.clone(),
                title: t.title.clone(),
                interval: t.interval.clone(),
                interval_km: t.interval_km,
                interval_months: t.interval_months,
                difficulty: t.difficulty,
                time_min: t.time_min,
                time_max: t.time_max,
            })
            .collect()
    }

    pub fn tutorial(&self, id: &str) -> Option<&Tutorial> {
        self.tutorials.iter().find(|t| t.id == id)
    }

    /// Tutorial with its spark-plug / coil steps adapted to the vehicle's cylinder count.
    pub fn tutorial_for(&self, id: &str, p: &VehicleProfile) -> Option<Tutorial> {
        let mut t = self.tutorial(id)?.clone();
        // Vehicle-specific procedures: replacements first, then prepended steps (most generic first).
        let procs: Vec<&Procedure> = self.procedures.iter().filter(|pr| pr.applies(id, p)).collect();
        if let Some(r) = procs.iter().rev().find(|pr| !pr.replace_steps.is_empty()) {
            t.steps = r.replace_steps.clone();
        }
        let replaced = procs.iter().any(|pr| !pr.replace_steps.is_empty());
        let mut before: Vec<TutorialStep> = Vec::new();
        for pr in &procs {
            t.vehicle_notes.extend(pr.notes.iter().cloned());
            if replaced {
                continue;
            }
            for s in &pr.steps_before {
                if !before.iter().any(|b| b.title == s.title) {
                    before.push(s.clone());
                }
            }
        }
        before.append(&mut t.steps);
        t.steps = before;
        let cyl = p.cylinders.unwrap_or(4);
        let fix = |list: &mut Vec<String>| {
            let mut out: Vec<String> = Vec::new();
            for c in list.iter() {
                let numbered = c.rsplit_once('_').filter(|(_, n)| n.parse::<u32>().is_ok());
                match numbered {
                    Some((base, _)) if matches!(base, "spark_plug" | "coil" | "injector" | "cylinder") => {
                        for n in 1..=cyl {
                            let id = format!("{base}_{n}");
                            if !out.contains(&id) {
                                out.push(id);
                            }
                        }
                    }
                    _ => out.push(c.clone()),
                }
            }
            *list = out;
        };
        fix(&mut t.components);
        for s in &mut t.steps {
            fix(&mut s.components);
        }
        Some(t)
    }

    pub fn shopping_list(&self, kb: &KnowledgeBase, tutorial_id: &str, p: &VehicleProfile) -> Option<ShoppingList> {
        let t = self.tutorial(tutorial_id)?;
        let vehicle_terms = format!("{} {}", p.make, p.model);
        let items: Vec<ShoppingItem> = t
            .shopping
            .iter()
            .map(|s| {
                let from_profile = s.qty_from.as_deref().and_then(|f| p.number(f));
                let mut qty = from_profile.or(s.qty).unwrap_or(1.0);
                if s.round_up {
                    qty = qty.ceil();
                }
                let query = p.fill(&s.query);
                ShoppingItem {
                    name: p.fill(&s.name),
                    qty,
                    unit: s.unit.clone(),
                    optional: s.optional,
                    qty_known: s.qty_from.is_none() || from_profile.is_some(),
                    price_min: (s.price_min * qty).round(),
                    price_max: (s.price_max * qty).round(),
                    links: kb.links(&query, Some(&vehicle_terms)),
                }
            })
            .collect();
        let required = items.iter().filter(|i| !i.optional);
        let total_min = required.clone().map(|i| i.price_min).sum();
        let total_max = required.map(|i| i.price_max).sum();
        let rate = kb.labor_rate_eur_h / 60.0;
        Some(ShoppingList {
            tutorial_id: t.id.clone(),
            vehicle: p.label(),
            items,
            total_min,
            total_max,
            labor_min: (t.time_min as f64 * rate).round(),
            labor_max: (t.time_max as f64 * rate).round(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_is_consistent() {
        let m = Maintenance::embedded();
        let kb = KnowledgeBase::embedded();
        let types: Vec<_> = m.vehicle_types.iter().map(|t| t.id.as_str()).collect();
        for p in &m.profiles {
            assert!(types.contains(&p.vehicle_type.as_str()), "{}", p.id);
            assert!(!m.tutorials_for(p).is_empty(), "no tutorial for {}", p.id);
            if let Some(t) = &p.traction {
                assert!(["front", "rear", "both"].contains(&t.as_str()), "{}: bad traction {t}", p.id);
            }
            if let Some(e) = &p.engine_position {
                assert!(["front", "mid", "rear"].contains(&e.as_str()), "{}: bad engine position {e}", p.id);
            }
            if let Some(f) = &p.final_drive {
                assert!(["chain", "shaft", "belt", "cvt", "hub"].contains(&f.as_str()), "{}: bad final drive {f}", p.id);
            }
            if let Some(b) = &p.body {
                assert!(["hatch", "sedan", "estate", "suv", "mpv", "coupe", "supercar", "pickup", "micro", "tractor", "naked", "adventure", "sport", "cruiser", "scooter"].contains(&b.as_str()), "{}: bad body {b}", p.id);
            }
        }
        for t in &m.tutorials {
            assert!(t.time_min <= t.time_max, "{}", t.id);
            let comps = t.components.iter().chain(t.steps.iter().flat_map(|s| s.components.iter()));
            for c in comps {
                assert!(m.components.contains_key(c) || kb.component_info(c).is_some(), "{}: unknown component {c}", t.id);
            }
        }
    }

    #[test]
    fn final_drive_selects_tutorials() {
        let m = Maintenance::embedded();
        let ids = |id: &str| m.tutorials_for(m.profiles.iter().find(|p| p.id.starts_with(id)).unwrap()).into_iter().map(|t| t.id).collect::<Vec<_>>();
        let gs = ids("bmw-r-1300-gs");
        assert!(gs.contains(&"final_drive_oil".to_string()) && !gs.contains(&"chain_maintenance".to_string()));
        let explorer = ids("triumph-tiger-explorer");
        assert!(!explorer.contains(&"chain_maintenance".to_string()));
        assert!(ids("yamaha-mt07").contains(&"chain_maintenance".to_string()));
        assert!(ids("honda-pcx125").contains(&"cvt_service".to_string()));
        let explorer_p = m.profiles.iter().find(|p| p.id.starts_with("triumph-tiger-explorer")).unwrap();
        let t = m.tutorial_for("clutch_slave", explorer_p).unwrap();
        assert!(t.vehicle_notes.iter().any(|n| n.contains("cardan")));
    }

    #[test]
    fn shopping_list_uses_profile() {
        let m = Maintenance::embedded();
        let kb = KnowledgeBase::embedded();
        let p = m.profiles.iter().find(|p| p.id == "peugeot-208-puretech").unwrap();
        let list = m.shopping_list(kb, "oil_change", p).unwrap();
        let oil = &list.items[0];
        assert_eq!(oil.qty, 4.0); // 3.5 L rounded up
        assert!(oil.name.contains("0W30"));
        assert!(oil.links[0].url.contains("208"));
        assert!(list.total_min > 0.0 && list.total_min <= list.total_max);

        let plugs = m.shopping_list(kb, "spark_plugs", p).unwrap();
        assert_eq!(plugs.items[0].qty, 3.0);
        let t = m.tutorial_for("spark_plugs", p).unwrap();
        assert!(t.components.contains(&"coil_3".to_string()) && !t.components.contains(&"coil_4".to_string()));
    }

    #[test]
    fn vehicle_specific_procedures() {
        let m = Maintenance::embedded();
        let p = |id: &str| m.profiles.iter().find(|p| p.id == id).unwrap().clone();
        let tesla = p("tesla-model3-rwd");
        let t = m.tutorial_for("ev_brakes", &tesla).unwrap();
        assert!(t.steps[0].title.contains("hors tension") || t.steps[1].title.contains("hors tension"), "{:?}", t.steps.iter().map(|s| &s.title).collect::<Vec<_>>());
        assert!(t.steps.iter().any(|s| s.title.contains("Lever un véhicule électrique")));
        assert!(!t.steps.iter().any(|s| s.title.contains("mode Cric")));
        assert!(!t.vehicle_notes.is_empty());
        let s = p("tesla-model-s-long-range");
        assert!(m.tutorial_for("chassis_check", &s).unwrap().steps.iter().any(|s| s.title.contains("mode Cric")));
        let b = m.tutorial_for("battery_replace", &tesla).unwrap();
        assert!(b.steps.iter().any(|s| s.text.contains("16 V")));
        // Other makes are untouched.
        let golf = p("vw-golf7-tdi");
        assert!(m.tutorial_for("oil_change", &golf).unwrap().steps[0].source.is_none());
    }

    #[test]
    fn unknown_quantities_are_flagged() {
        let m = Maintenance::embedded();
        let kb = KnowledgeBase::embedded();
        let p = VehicleProfile { vehicle_type: "car".into(), make: "Fiat".into(), model: "Panda".into(), fuel: "petrol".into(), ..Default::default() };
        let list = m.shopping_list(kb, "oil_change", &p).unwrap();
        assert!(!list.items[0].qty_known);
    }
}
