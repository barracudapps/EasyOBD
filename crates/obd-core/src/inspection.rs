//! Technical inspection (contrôle technique) preparation: checklist filtered for the vehicle, VIN
//! locations, and an OBD pre-check (MIL, fault codes, readiness monitors).

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::maintenance::VehicleProfile;
use crate::{Error, Result};

const EMBEDDED: &str = include_str!("../../../data/inspection.fr.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckItem {
    pub id: String,
    pub label: String,
    pub how: String,
    pub sense: String,
    /// minor / major / critical
    pub severity: String,
    #[serde(default, skip_serializing)]
    types: Option<Vec<String>>,
    #[serde(default, skip_serializing)]
    fuels: Option<Vec<String>>,
    #[serde(default)]
    pub components: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckSection {
    pub title: String,
    pub items: Vec<CheckItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VinPlace {
    pub place: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Deserialize)]
struct InspectionFile {
    disclaimer: String,
    periodicity: BTreeMap<String, String>,
    severity_labels: BTreeMap<String, String>,
    sections: Vec<CheckSection>,
    vin_generic: Vec<VinPlace>,
    vin_by_make: BTreeMap<String, Vec<String>>,
    vin_motorcycle: Vec<VinPlace>,
    vin_truck: Vec<VinPlace>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VinHint {
    /// Make-specific places (typical for the make, to confirm), most likely first.
    pub make_places: Vec<String>,
    pub generic: Vec<VinPlace>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InspectionGuide {
    pub vehicle: String,
    pub periodicity: String,
    pub severity_labels: BTreeMap<String, String>,
    pub sections: Vec<CheckSection>,
    pub vin: VinHint,
    pub disclaimer: String,
}

pub struct Inspection {
    f: InspectionFile,
}

impl Inspection {
    pub fn embedded() -> &'static Inspection {
        static I: OnceLock<Inspection> = OnceLock::new();
        I.get_or_init(|| Inspection::from_json(EMBEDDED).expect("embedded inspection data must be valid"))
    }

    pub fn from_json(json: &str) -> Result<Self> {
        Ok(Self { f: serde_json::from_str(json).map_err(|e| Error::KnowledgeBase(format!("contrôle technique : {e}")))? })
    }

    pub fn guide(&self, p: &VehicleProfile) -> InspectionGuide {
        let sections = self
            .f
            .sections
            .iter()
            .map(|s| CheckSection {
                title: s.title.clone(),
                items: s
                    .items
                    .iter()
                    .filter(|i| i.types.as_ref().is_none_or(|t| t.contains(&p.vehicle_type)))
                    .filter(|i| i.fuels.as_ref().is_none_or(|f| f.contains(&p.fuel)))
                    .cloned()
                    .collect(),
            })
            .filter(|s| !s.items.is_empty())
            .collect();
        let generic = match p.vehicle_type.as_str() {
            "motorcycle" => self.f.vin_motorcycle.clone(),
            "truck" => self.f.vin_truck.clone(),
            _ => self.f.vin_generic.clone(),
        };
        let make_places = if matches!(p.vehicle_type.as_str(), "car" | "van") {
            self.f.vin_by_make.get(&p.make).cloned().unwrap_or_default()
        } else {
            vec![]
        };
        InspectionGuide {
            vehicle: p.label(),
            periodicity: self.f.periodicity.get(&p.vehicle_type).cloned().unwrap_or_default(),
            severity_labels: self.f.severity_labels.clone(),
            sections,
            vin: VinHint { make_places, generic },
            disclaimer: self.f.disclaimer.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge::KnowledgeBase;
    use crate::maintenance::Maintenance;

    #[test]
    fn guides_are_filtered_per_vehicle() {
        let ins = Inspection::embedded();
        let m = Maintenance::embedded();
        let kb = KnowledgeBase::embedded();
        let p = |id: &str| m.profiles.iter().find(|p| p.id == id).unwrap().clone();
        let ids = |g: &InspectionGuide| g.sections.iter().flat_map(|s| s.items.iter().map(|i| i.id.clone())).collect::<Vec<_>>();

        let golf = ins.guide(&p("vw-golf7-tdi"));
        assert!(ids(&golf).contains(&"opacity".to_string()));
        assert!(!ids(&golf).contains(&"hv_visual".to_string()));
        assert!(golf.vin.make_places[0].contains("tablier"));

        let tesla = ins.guide(&p("tesla-model3-rwd"));
        assert!(ids(&tesla).contains(&"brake_rust".to_string()));
        assert!(!ids(&tesla).contains(&"opacity".to_string()) && !ids(&tesla).contains(&"mil".to_string()));

        let moto = ins.guide(&p("yamaha-mt07"));
        assert!(ids(&moto).contains(&"moto_exhaust".to_string()));
        assert!(moto.vin.generic[0].place.contains("direction"));

        for prof in &m.profiles {
            for s in ins.guide(prof).sections {
                for i in s.items {
                    for c in &i.components {
                        assert!(kb.component_info(c).is_some() || m.components.contains_key(c), "{}: {c}", i.id);
                    }
                }
            }
        }
    }
}
