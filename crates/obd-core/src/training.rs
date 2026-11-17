//! Training mode: realistic breakdown scenarios played on the simulator.
//!
//! The learner reads the customer's complaint, connects to the simulated car (the full ELM327 flow
//! runs), reads codes and live data, explores the sensory clues, then picks the best first action.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::dtc::{Dtc, DtcKind};
use crate::maintenance::Maintenance;
use crate::simulator::Simulator;
use crate::{Error, Result};

const EMBEDDED: &str = include_str!("../../../data/scenarios.fr.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clue {
    pub sense: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuizOption {
    pub text: String,
    pub correct: bool,
    pub feedback: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quiz {
    pub text: String,
    pub options: Vec<QuizOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioCode {
    pub code: String,
    pub kind: DtcKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scenario {
    pub id: String,
    pub title: String,
    /// 1 = débutant, 2 = intermédiaire, 3 = avancé
    pub level: u8,
    pub profile: String,
    pub story: String,
    pub codes: Vec<ScenarioCode>,
    #[serde(default)]
    pub live: HashMap<String, f64>,
    pub clues: Vec<Clue>,
    pub question: Quiz,
    pub debrief: String,
}

#[derive(Deserialize)]
struct ScenariosFile {
    scenarios: Vec<Scenario>,
}

pub fn scenarios() -> &'static [Scenario] {
    static S: OnceLock<Vec<Scenario>> = OnceLock::new();
    S.get_or_init(|| parse(EMBEDDED).expect("embedded scenarios must be valid"))
}

pub fn parse(json: &str) -> Result<Vec<Scenario>> {
    serde_json::from_str::<ScenariosFile>(json)
        .map(|f| f.scenarios)
        .map_err(|e| Error::KnowledgeBase(format!("scénarios : {e}")))
}

pub fn scenario(id: &str) -> Option<&'static Scenario> {
    scenarios().iter().find(|s| s.id == id)
}

/// A simulated car reproducing the scenario (codes, live data, VIN of a matching make).
pub fn simulator_for(s: &Scenario) -> Simulator {
    let make = Maintenance::embedded().profiles.iter().find(|p| p.id == s.profile).map(|p| p.make.as_str()).unwrap_or("");
    let vin = match make {
        "Renault" => "VF1RJA00XLW100001",
        "Peugeot" => "VR3UPHNKSKT100002",
        "Citroën" => "VR7EFYHZRKN100003",
        "Dacia" => "UU1DJF00XLW100004",
        "Volkswagen" => "WVWZZZAUZHW100005",
        "Toyota" => "VNKKD3D3XEA100006",
        "Ford" => "WF0DXXGAKJH100007",
        "Tesla" => "LRW3E7EK0NC100008",
        "Kia" => "KNADB812AM6100009",
        "Hyundai" => "KMHK381GFNU100010",
        _ => "VF1RFB00X6W123456",
    };
    let dtcs = s.codes.iter().map(|c| Dtc { code: c.code.clone(), kind: c.kind }).collect();
    Simulator::new(dtcs, vin).with_live(s.live.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge::{KnowledgeBase, MatchKind};
    use crate::Elm327;

    #[test]
    fn scenarios_are_consistent_and_playable() {
        let kb = KnowledgeBase::embedded();
        let m = Maintenance::embedded();
        assert!(scenarios().len() >= 6);
        for s in scenarios() {
            assert!(m.profiles.iter().any(|p| p.id == s.profile), "{}: profile", s.id);
            assert_eq!(s.question.options.iter().filter(|o| o.correct).count(), 1, "{}: one correct answer", s.id);
            for c in &s.codes {
                let d = kb.lookup(&c.code, None).unwrap();
                assert!(!matches!(d.match_kind, MatchKind::Generic), "{}: {} has no dedicated content", s.id, c.code);
            }
            let mut elm = Elm327::new(Box::new(simulator_for(s)));
            elm.initialize().unwrap();
            let read: Vec<_> = elm.read_all_dtcs().unwrap().into_iter().map(|d| d.code).collect();
            for c in &s.codes {
                assert!(read.contains(&c.code), "{}: {} not read back", s.id, c.code);
            }
            let vehicle = elm.read_vehicle().unwrap();
            let profile = m.profiles.iter().find(|p| p.id == s.profile).unwrap();
            assert_eq!(vehicle.make.as_deref(), Some(profile.make.as_str()), "{}: VIN make", s.id);
            if let (Some(y), Some([y0, y1])) = (vehicle.model_year, profile.years) {
                assert!((y0..=y1).contains(&y), "{}: VIN year {y} outside {y0}-{y1}", s.id);
            }
        }
    }
}
