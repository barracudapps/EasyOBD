//! Vehicle technical sheet (capacities, fluids, tightening torques) and cheaper-but-valid
//! alternatives for parts and fluids.
//!
//! Every value carries its source: the vehicle profile itself, a make-level value, or a value typical
//! of the vehicle category, so the user knows what must be double-checked.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::maintenance::VehicleProfile;
use crate::{Error, Result};

const EMBEDDED: &str = include_str!("../../../data/specs.fr.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Value of this exact vehicle profile.
    Vehicle,
    /// Usual value for the make.
    Make,
    /// Typical value of the category: must be checked.
    Typical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Compatibility {
    /// Same specification, cheaper source.
    Equivalent,
    /// Technically compatible with conditions.
    Compatible,
    /// Works but not advised (warranty, durability).
    Discouraged,
    /// Do not do it.
    Forbidden,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alternative {
    pub label: String,
    pub compatibility: Compatibility,
    #[serde(default)]
    pub saving: Option<String>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpecItem {
    pub label: String,
    pub value: String,
    pub source: Source,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpecSection {
    pub title: String,
    pub items: Vec<SpecItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VehicleSheet {
    pub vehicle: String,
    pub sections: Vec<SpecSection>,
    pub oil_alternatives: Vec<Alternative>,
    pub disclaimer: String,
}

#[derive(Debug, Deserialize)]
struct BrakeFluid {
    #[serde(rename = "type")]
    kind: String,
    qty: String,
    interval: String,
}

#[derive(Debug, Deserialize)]
struct Typical {
    coolant_l: String,
    brake_fluid: BrakeFluid,
    gearbox: String,
    torques: Vec<(String, String, String)>,
    adblue_l: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Electric {
    coolant_l: String,
    gearbox: String,
    note: String,
}

#[derive(Debug, Deserialize)]
struct PartAdvice {
    keywords: Vec<String>,
    #[allow(dead_code)]
    label: String,
    options: Vec<Alternative>,
}

#[derive(Debug, Deserialize)]
struct SpecsFile {
    disclaimer: String,
    typical: BTreeMap<String, Typical>,
    electric: Electric,
    wheel_torque_by_make: BTreeMap<String, String>,
    part_advice: Vec<PartAdvice>,
}

pub struct Specs {
    f: SpecsFile,
}

fn item(label: &str, value: impl Into<String>, source: Source, note: Option<&str>) -> SpecItem {
    SpecItem { label: label.into(), value: value.into(), source, note: note.filter(|n| !n.is_empty()).map(str::to_string) }
}

/// Splits "5W30 RN17" into ("5W30", "RN17").
pub fn parse_oil_spec(spec: &str) -> (Option<String>, String) {
    let mut visc = None;
    let mut rest = Vec::new();
    for tok in spec.split_whitespace() {
        let t = tok.to_uppercase();
        let is_visc = visc.is_none()
            && (t.contains('W') && t.chars().next().is_some_and(|c| c.is_ascii_digit()) || t.starts_with("SAE"));
        if is_visc && !t.starts_with("SAE") {
            visc = Some(t);
        } else if !(t == "SAE") {
            rest.push(tok.to_string());
        }
    }
    (visc, rest.join(" ").trim_matches(['/', ' ']).to_string())
}

/// Engines whose timing belt runs in oil (PSA PureTech, Ford 1.0/1.5 EcoBoost…): oil must match the
/// manufacturer standard exactly, otherwise the belt degrades and can clog the oil pump.
fn wet_belt(p: &VehicleProfile) -> bool {
    let e = p.engine.to_lowercase();
    let s = p.oil_spec.as_deref().unwrap_or("").to_uppercase();
    e.contains("puretech") || (e.contains("ecoboost") && !e.contains("2.0")) || s.contains("B71 2010") || s.contains("WSS-M2C948")
        || ((p.make == "Opel" || p.make == "Peugeot" || p.make == "Citroën" || p.make == "DS") && e.contains("1.2"))
}

impl Specs {
    pub fn embedded() -> &'static Specs {
        static S: OnceLock<Specs> = OnceLock::new();
        S.get_or_init(|| Specs::from_json(EMBEDDED).expect("embedded specs must be valid"))
    }

    pub fn from_json(json: &str) -> Result<Self> {
        Ok(Self { f: serde_json::from_str(json).map_err(|e| Error::KnowledgeBase(format!("specs : {e}")))? })
    }

    /// Cheaper alternatives for a shopping item / part, from its name (and the vehicle for oils).
    pub fn alternatives_for(&self, name: &str, p: &VehicleProfile) -> Vec<Alternative> {
        let lower = name.to_lowercase();
        if lower.contains("huile moteur") || lower.contains("huile moto") || lower.contains("huile moteur pl") {
            return self.oil_alternatives(p);
        }
        self.f
            .part_advice
            .iter()
            .find(|a| a.keywords.iter().any(|k| lower.contains(k.as_str())))
            .map(|a| a.options.clone())
            .unwrap_or_default()
    }

    pub fn oil_alternatives(&self, p: &VehicleProfile) -> Vec<Alternative> {
        let Some(spec) = p.oil_spec.as_deref().filter(|s| !s.is_empty()) else {
            return vec![];
        };
        let (visc, norm) = parse_oil_spec(spec);
        let visc = visc.unwrap_or_default();
        let norm_txt = if norm.is_empty() { String::new() } else { format!(" portant la norme {norm}") };
        let mut out = vec![Alternative {
            label: format!("{visc}{norm_txt}, marque distributeur ou générique"),
            compatibility: Compatibility::Equivalent,
            saving: Some("30 – 50 %".into()),
            note: "C'est la norme (inscrite au dos du bidon) qui compte, pas la marque. Les huiles des grandes enseignes \
                   portent souvent les mêmes homologations que les grandes marques."
                .into(),
        }];

        if p.vehicle_type == "motorcycle" {
            out.push(Alternative {
                label: "Huile auto (même viscosité) dans une moto à embrayage à bain d'huile".into(),
                compatibility: Compatibility::Forbidden,
                saving: None,
                note: "Les additifs anti-friction des huiles auto font patiner l'embrayage. Exigez JASO MA / MA2 (JASO MB pour les scooters automatiques).".into(),
            });
            if visc == "10W40" || visc == "10W30" {
                out.push(Alternative {
                    label: "10W40 ou 10W50 JASO MA2 selon le climat".into(),
                    compatibility: Compatibility::Compatible,
                    saving: Some("selon promotions".into()),
                    note: "Une viscosité à chaud plus élevée est souvent tolérée en climat chaud ou en usage sportif si la notice la mentionne.".into(),
                });
            }
            return out;
        }

        if p.vehicle_type == "truck" {
            out.push(Alternative {
                label: format!("Huile {visc} ACEA E6 / E4 avec l'homologation constructeur, conditionnement 208 L"),
                compatibility: Compatibility::Equivalent,
                saving: Some("15 – 30 % (vrac)".into()),
                note: "Pour une flotte, le fût réduit nettement le prix au litre.".into(),
            });
            return out;
        }

        let low_viscosity = visc.starts_with("0W16") || visc.starts_with("0W20") || visc.starts_with("5W20");
        if wet_belt(p) {
            out.push(Alternative {
                label: "Toute autre viscosité ou norme (ex. 5W40)".into(),
                compatibility: Compatibility::Forbidden,
                saving: None,
                note: "Moteur à courroie de distribution baignée dans l'huile : une huile non conforme dégrade la courroie, \
                       qui peut obstruer la crépine et casser le moteur. Norme constructeur strictement."
                    .into(),
            });
            return out;
        }
        if low_viscosity {
            out.push(Alternative {
                label: "Huile plus épaisse (5W30 / 5W40) à la place de la préconisation".into(),
                compatibility: Compatibility::Discouraged,
                saving: Some("0 – 15 %".into()),
                note: "Moteur conçu pour une huile très fluide (hybride, distribution variable, tolérances serrées) : \
                       consommation en hausse, risques de codes de calage (P0011) et refus de garantie."
                    .into(),
            });
            return out;
        }
        if visc == "0W30" {
            out.push(Alternative {
                label: format!("5W30{norm_txt}"),
                compatibility: Compatibility::Equivalent,
                saving: Some("10 – 25 %".into()),
                note: "Même homologation, moins fluide à froid uniquement : sans conséquence hors grand froid (< -25 °C).".into(),
            });
        }
        if visc == "5W30" || visc == "0W30" {
            let diesel_dpf = p.fuel == "diesel";
            out.push(Alternative {
                label: if diesel_dpf { "5W40 ACEA C3 (low SAPS)".to_string() } else { "5W40 ACEA C3 / A3/B4".to_string() },
                compatibility: if norm.is_empty() { Compatibility::Compatible } else { Compatibility::Discouraged },
                saving: Some("10 – 30 %".into()),
                note: if norm.is_empty() {
                    "Techniquement compatible sur la plupart des moteurs sans norme particulière, en particulier usés ou en climat chaud. \
                     Légère hausse de consommation."
                        .into()
                } else {
                    format!(
                        "Fonctionne mécaniquement, mais sans l'homologation {norm} : à éviter pendant la garantie. Sur un diesel à FAP, \
                         restez impérativement en « C3 » (faibles cendres) pour ne pas colmater le filtre."
                    )
                },
            });
        }
        out
    }

    pub fn sheet(&self, p: &VehicleProfile) -> VehicleSheet {
        let electric = p.fuel == "electric";
        let typ = self.f.typical.get(&p.vehicle_type).or_else(|| self.f.typical.get("car")).expect("car typical values");
        let mut sections = Vec::new();

        // ---- Capacities
        let mut cap = Vec::new();
        if electric {
            cap.push(item("Huile moteur", "Aucune (moteur électrique)", Source::Vehicle, None));
            cap.push(item("Réducteur", &self.f.electric.gearbox, Source::Typical, None));
            cap.push(item("Refroidissement batterie / électronique", &self.f.electric.coolant_l, Source::Typical, None));
        } else {
            match p.oil_capacity_l {
                Some(l) => cap.push(item("Huile moteur (avec filtre)", format!("{l} L"), Source::Vehicle, Some("Remplir 0,5 L de moins, puis ajuster à la jauge."))),
                None => cap.push(item("Huile moteur (avec filtre)", "À vérifier dans le carnet d'entretien", Source::Typical, None)),
            }
            match p.coolant_l {
                Some(l) => cap.push(item("Liquide de refroidissement", format!("{l} L"), Source::Vehicle, None)),
                None => cap.push(item("Liquide de refroidissement", &typ.coolant_l, Source::Typical, None)),
            }
            cap.push(item("Boîte de vitesses", &typ.gearbox, Source::Typical, None));
            if p.fuel == "diesel" {
                if let Some(a) = &typ.adblue_l {
                    cap.push(item("AdBlue (si équipé)", a, Source::Typical, Some("Ne jamais verser d'AdBlue dans le réservoir de gazole.")));
                }
            }
        }
        cap.push(item("Liquide de frein", &typ.brake_fluid.qty, Source::Typical, None));
        sections.push(SpecSection { title: "Capacités".into(), items: cap });

        // ---- Fluids
        let mut fluids = Vec::new();
        if let Some(spec) = p.oil_spec.as_deref().filter(|s| !s.is_empty()) {
            fluids.push(item("Huile moteur", spec, Source::Vehicle, wet_belt(p).then_some("Courroie de distribution baignée dans l'huile : norme constructeur obligatoire.")));
        } else if !electric {
            fluids.push(item("Huile moteur", "Norme indiquée dans le carnet (ex. ACEA C3 + homologation constructeur)", Source::Typical, None));
        }
        fluids.push(item("Liquide de frein", &typ.brake_fluid.kind, Source::Typical, Some(&typ.brake_fluid.interval)));
        if p.vehicle_type != "truck" || electric {
            fluids.push(item(
                "Liquide de refroidissement",
                if electric { "Liquide spécifique faible conductivité (batterie) + liquide classique (habitacle)" } else { "Technologie OAT / Si-OAT selon constructeur (ne pas mélanger)" },
                Source::Typical,
                None,
            ));
        }
        sections.push(SpecSection { title: "Fluides".into(), items: fluids });

        // ---- Torques
        let mut torques = Vec::new();
        for (label, value, note) in &typ.torques {
            if electric && (label.contains("vidange") || label.contains("Bougie") || label.contains("Filtre à huile")) {
                continue;
            }
            if label.starts_with("Écrous / vis de roue") {
                if let Some(v) = self.f.wheel_torque_by_make.get(&p.make) {
                    torques.push(item(label, v, Source::Make, Some(note)));
                    continue;
                }
            }
            torques.push(item(label, value, Source::Typical, Some(note)));
        }
        sections.push(SpecSection { title: "Couples de serrage".into(), items: torques });

        // ---- Engine / identity
        let mut id = vec![item("Motorisation", &p.engine, Source::Vehicle, None)];
        if let Some(y) = p.years {
            id.push(item("Années", format!("{} – {}", y[0], y[1]), Source::Vehicle, None));
        }
        if let Some(c) = p.cylinders {
            id.push(item("Cylindres", c.to_string(), Source::Vehicle, None));
        }
        if let Some(c) = &p.chain {
            id.push(item("Transmission secondaire", format!("Chaîne {c}"), Source::Vehicle, None));
        } else if let Some(f) = p.final_drive_kind() {
            let (label, source) = match (f, p.final_drive.is_some()) {
                ("shaft", _) => ("Cardan (huile de couple conique à vidanger selon le carnet)", Source::Vehicle),
                ("belt", _) => ("Courroie crantée (sans graissage, contrôle de tension)", Source::Vehicle),
                ("cvt", _) => ("Variateur à courroie (scooter)", Source::Vehicle),
                ("hub", _) => ("Moteur-roue (pas de transmission secondaire)", Source::Vehicle),
                (_, true) => ("Chaîne", Source::Vehicle),
                _ => ("Chaîne (le plus courant)", Source::Typical),
            };
            id.push(item("Transmission secondaire", label, source, None));
        }
        if electric {
            id.push(item("À savoir", &self.f.electric.note, Source::Typical, None));
        }
        sections.insert(0, SpecSection { title: "Véhicule".into(), items: id });

        VehicleSheet { vehicle: p.label(), sections, oil_alternatives: self.oil_alternatives(p), disclaimer: self.f.disclaimer.clone() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maintenance::Maintenance;

    fn profile(id: &str) -> VehicleProfile {
        Maintenance::embedded().profiles.iter().find(|p| p.id == id).unwrap_or_else(|| panic!("profile {id}")).clone()
    }

    #[test]
    fn parses_oil_specs() {
        assert_eq!(parse_oil_spec("5W30 RN17"), (Some("5W30".into()), "RN17".into()));
        assert_eq!(parse_oil_spec("0W16 / 0W20"), (Some("0W16".into()), "0W20".into()));
        assert_eq!(parse_oil_spec("SAE 20W50"), (Some("20W50".into()), String::new()));
    }

    #[test]
    fn oil_alternatives_respect_engine_constraints() {
        let s = Specs::embedded();
        // PureTech wet belt: any other oil forbidden.
        let alts = s.oil_alternatives(&profile("peugeot-208-puretech"));
        assert!(alts.iter().any(|a| a.compatibility == Compatibility::Forbidden));
        assert!(!alts.iter().any(|a| a.label.starts_with("5W40") && a.compatibility != Compatibility::Forbidden));
        // Renault dCi 5W30 RN0720: same norm generic = equivalent, 5W40 discouraged.
        let alts = s.oil_alternatives(&profile("renault-clio4-dci90"));
        assert_eq!(alts[0].compatibility, Compatibility::Equivalent);
        assert!(alts.iter().any(|a| a.label.contains("5W40") && a.compatibility == Compatibility::Discouraged));
        // Hybrid 0W20: thicker oil discouraged.
        let alts = s.oil_alternatives(&profile("toyota-yaris3-hybrid"));
        assert!(alts.iter().any(|a| a.compatibility == Compatibility::Discouraged));
        // Motorcycle: car oil forbidden.
        let alts = s.oil_alternatives(&profile("yamaha-mt07"));
        assert!(alts.iter().any(|a| a.compatibility == Compatibility::Forbidden && a.label.contains("auto")));
    }

    #[test]
    fn sheets_for_every_profile() {
        let s = Specs::embedded();
        for p in &Maintenance::embedded().profiles {
            let sheet = s.sheet(p);
            assert!(sheet.sections.len() >= 4, "{}", p.id);
            let torques = sheet.sections.iter().find(|x| x.title == "Couples de serrage").unwrap();
            assert!(!torques.items.is_empty(), "{}", p.id);
        }
        let tesla = s.sheet(&profile("tesla-model3-rwd"));
        let wheel = tesla.sections.iter().flat_map(|x| &x.items).find(|i| i.label.starts_with("Écrous")).unwrap();
        assert_eq!(wheel.source, Source::Make);
        assert!(wheel.value.contains("175"));
        assert!(!tesla.sections.iter().flat_map(|x| &x.items).any(|i| i.label.contains("vidange")));
    }

    #[test]
    fn part_alternatives() {
        let s = Specs::embedded();
        let p = profile("vw-golf7-tdi");
        assert!(s.alternatives_for("Jeu de plaquettes avant", &p).iter().any(|a| a.compatibility == Compatibility::Forbidden));
        assert!(!s.alternatives_for("Filtre à huile", &p).is_empty());
        assert!(s.alternatives_for("Huile moteur 5W30 VW 507.00", &p)[0].label.contains("507.00"));
    }
}
