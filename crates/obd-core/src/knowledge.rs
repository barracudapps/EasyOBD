//! Repair knowledge base.
//!
//! The data lives in `data/knowledge_base.fr.json` (embedded at compile time). Each entry describes
//! a code or a range of codes: plain-language explanation, the 3D components involved, probable
//! causes, and repair solutions with parts (price ranges + shop search links), time and skill level.
//!
//! Range entries (e.g. misfires `P0301`..`P0312`) use `{n}` placeholders, replaced by the cylinder
//! number computed as `last two digits - n_offset`.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::dtc;
use crate::{Error, Result};

const EMBEDDED: &str = include_str!("../../../data/knowledge_base.fr.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    /// URL with a `{q}` placeholder for the URL-encoded search terms.
    pub url_template: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentInfo {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// A fault code linked to a component (part picked in the 3D view).
#[derive(Debug, Clone, Serialize)]
pub struct ComponentCode {
    pub code: String,
    pub title: String,
    pub system: String,
    pub severity: Severity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cause {
    pub text: String,
    /// Rough probability in percent, used to sort and draw bars.
    pub likelihood: u8,
}

/// A check the driver can do with their own senses to confirm or rule out a lead,
/// so the problem can be recognised next time without a scan tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensoryCheck {
    /// `sight`, `sound`, `smell`, `touch` or `feel` (behaviour felt while driving).
    pub sense: String,
    pub tip: String,
    /// What this observation points to or rules out.
    #[serde(default)]
    pub means: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PartDef {
    name: String,
    query: String,
    price_min: f64,
    price_max: f64,
    #[serde(default = "one")]
    qty: u32,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SolutionDef {
    title: String,
    #[serde(default)]
    description: Option<String>,
    difficulty: u8,
    time_min: u32,
    time_max: u32,
    #[serde(default)]
    tools: Vec<String>,
    #[serde(default)]
    steps: Vec<String>,
    #[serde(default)]
    parts: Vec<PartDef>,
}

#[derive(Debug, Clone, Deserialize)]
struct EntryDef {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    range: Option<[String; 2]>,
    #[serde(default)]
    n_offset: i32,
    title: String,
    description: String,
    system: String,
    severity: Severity,
    drivable: String,
    #[serde(default)]
    how_it_works: Option<String>,
    #[serde(default)]
    sensory_checks: Vec<SensoryCheck>,
    #[serde(default)]
    symptoms: Vec<String>,
    #[serde(default)]
    components: Vec<String>,
    #[serde(default)]
    causes: Vec<Cause>,
    #[serde(default)]
    solutions: Vec<SolutionDef>,
}

#[derive(Debug, Clone, Deserialize)]
struct FallbackDef {
    prefix: String,
    title: String,
    description: String,
    system: String,
    #[serde(default)]
    components: Vec<String>,
    severity: Severity,
}

#[derive(Debug, Deserialize)]
struct KbFile {
    version: String,
    labor_rate_eur_h: f64,
    providers: Vec<Provider>,
    components: BTreeMap<String, ComponentInfo>,
    entries: Vec<Value>,
    fallbacks: Vec<FallbackDef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    /// A dedicated entry exists for this exact code.
    Exact,
    /// Matched a range entry (e.g. any misfire cylinder).
    Range,
    /// Only the code family is known: generic explanation, no repair data.
    Generic,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShopLink {
    pub provider: String,
    pub name: String,
    pub url: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Part {
    pub name: String,
    pub qty: u32,
    pub price_min: f64,
    pub price_max: f64,
    pub links: Vec<ShopLink>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct CostEstimate {
    pub parts_min: f64,
    pub parts_max: f64,
    /// Garage labour for the same job at the configured hourly rate.
    pub labor_min: f64,
    pub labor_max: f64,
    pub garage_min: f64,
    pub garage_max: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Solution {
    pub title: String,
    pub description: Option<String>,
    /// 1 (beginner) to 5 (professional only).
    pub difficulty: u8,
    pub difficulty_label: &'static str,
    pub time_min: u32,
    pub time_max: u32,
    pub tools: Vec<String>,
    pub steps: Vec<String>,
    pub parts: Vec<Part>,
    pub cost: CostEstimate,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComponentRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Diagnosis {
    pub code: String,
    pub match_kind: MatchKind,
    pub manufacturer_specific: bool,
    pub title: String,
    pub description: String,
    pub system: String,
    pub severity: Severity,
    pub drivable: String,
    /// Plain-language explanation of the system, for learning.
    pub how_it_works: Option<String>,
    pub sensory_checks: Vec<SensoryCheck>,
    pub symptoms: Vec<String>,
    pub components: Vec<ComponentRef>,
    pub causes: Vec<Cause>,
    pub solutions: Vec<Solution>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogItem {
    pub code: String,
    pub title: String,
    pub system: String,
    pub severity: Severity,
}

pub struct KnowledgeBase {
    pub version: String,
    pub labor_rate_eur_h: f64,
    pub providers: Vec<Provider>,
    pub components: BTreeMap<String, ComponentInfo>,
    entries: Vec<(Value, EntryDef)>,
    fallbacks: Vec<FallbackDef>,
}

pub fn difficulty_label(d: u8) -> &'static str {
    match d {
        0 | 1 => "Débutant",
        2 => "Facile",
        3 => "Intermédiaire",
        4 => "Avancé",
        _ => "Professionnel",
    }
}

/// Percent-encodes search terms for a URL query string.
pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn substitute(v: &Value, n: &str) -> Value {
    match v {
        Value::String(s) => Value::String(s.replace("{n}", n)),
        Value::Array(a) => Value::Array(a.iter().map(|x| substitute(x, n)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), substitute(x, n))).collect()),
        other => other.clone(),
    }
}

fn code_value(code: &str) -> Option<(char, u32)> {
    let c = code.chars().next()?;
    Some((c, u32::from_str_radix(&code[1..], 16).ok()?))
}

fn in_range(code: &str, range: &[String; 2]) -> bool {
    match (code_value(code), code_value(&range[0]), code_value(&range[1])) {
        (Some((s, v)), Some((s0, lo)), Some((s1, hi))) => s == s0 && s == s1 && (lo..=hi).contains(&v),
        _ => false,
    }
}

/// `P1xxx`, `C1xxx`, `B1xxx`, `U1xxx` and `P30xx`–`P33xx` are defined by each manufacturer.
pub fn is_manufacturer_specific(code: &str) -> bool {
    let b = code.as_bytes();
    b.len() == 5 && (b[1] == b'1' || (b[0] == b'P' && b[1] == b'3' && b[2] <= b'3'))
}

impl KnowledgeBase {
    /// The French knowledge base bundled with the application.
    pub fn embedded() -> &'static KnowledgeBase {
        static KB: OnceLock<KnowledgeBase> = OnceLock::new();
        KB.get_or_init(|| KnowledgeBase::from_json(EMBEDDED).expect("embedded knowledge base must be valid"))
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let file: KbFile = serde_json::from_str(json).map_err(|e| Error::KnowledgeBase(e.to_string()))?;
        let mut entries = Vec::new();
        for raw in file.entries {
            let def: EntryDef = serde_json::from_value(raw.clone()).map_err(|e| {
                Error::KnowledgeBase(format!("{} : {e}", raw.get("code").or(raw.get("range")).unwrap_or(&Value::Null)))
            })?;
            if def.code.is_none() && def.range.is_none() {
                return Err(Error::KnowledgeBase(format!("entrée sans code ni plage : {}", def.title)));
            }
            entries.push((raw, def));
        }
        Ok(Self {
            version: file.version,
            labor_rate_eur_h: file.labor_rate_eur_h,
            providers: file.providers,
            components: file.components,
            entries,
            fallbacks: file.fallbacks,
        })
    }

    /// Resolves a component id, including numbered ones (`coil_3` → template `coil_{n}`).
    pub fn component_info(&self, id: &str) -> Option<ComponentInfo> {
        if let Some(c) = self.components.get(id) {
            return Some(c.clone());
        }
        let (base, n) = id.rsplit_once('_')?;
        n.parse::<u32>().ok()?;
        let tpl = self.components.get(&format!("{base}_{{n}}"))?;
        Some(ComponentInfo { name: tpl.name.replace("{n}", n), description: tpl.description.as_ref().map(|d| d.replace("{n}", n)) })
    }

    /// Fault codes that involve a 3D component (`coil_2` → P0352, `cam_sensor` → P0340…),
    /// most severe first. Numbered parts resolve the matching code inside a range.
    pub fn codes_for_component(&self, id: &str) -> Vec<ComponentCode> {
        let (base, num) = match id.rsplit_once('_') {
            Some((b, n)) if n.parse::<i32>().is_ok() => (b, n.parse::<i32>().ok()),
            _ => (id, None),
        };
        let mut out: Vec<(usize, ComponentCode)> = Vec::new();
        for (_, d) in &self.entries {
            // Position of the part in the entry's list: 0 = the code is about this very part.
            let hit = d.components.iter().enumerate().find_map(|(i, c)| {
                if c == id {
                    return Some((i, None));
                }
                let tpl = c.strip_suffix("_{n}")?;
                (tpl == base).then_some((i, num))
            });
            let Some((rank, n)) = hit else { continue };
            let code = match (&d.code, &d.range, n) {
                (Some(c), _, _) => c.clone(),
                (None, Some(r), Some(n)) => {
                    let c = format!("{}{:02}", &r[0][..3], n + d.n_offset);
                    if !in_range(&c, r) {
                        continue;
                    }
                    c
                }
                (None, Some(r), None) => r[0].clone(),
                _ => continue,
            };
            if out.iter().any(|(_, o)| o.code == code) {
                continue;
            }
            let title = match n {
                Some(n) => d.title.replace("{n}", &n.to_string()),
                None => d.title.replace("{n}", "n"),
            };
            out.push((rank.min(2), ComponentCode { code, title, system: d.system.clone(), severity: d.severity }));
        }
        out.sort_by(|(ra, a), (rb, b)| ra.cmp(rb).then(b.severity.cmp(&a.severity)).then(a.code.cmp(&b.code)));
        out.into_iter().map(|(_, c)| c).collect()
    }

    pub(crate) fn component_ref(&self, id: &str) -> ComponentRef {
        let name = self.component_info(id).map(|c| c.name).unwrap_or_else(|| id.replace('_', " "));
        ComponentRef { id: id.to_string(), name }
    }

    /// Search links for every configured shop. `make` (or "make model") narrows the search.
    pub fn links(&self, query: &str, make: Option<&str>) -> Vec<ShopLink> {
        let terms = match make {
            Some(m) if !m.is_empty() => format!("{query} {m}"),
            _ => query.to_string(),
        };
        let q = url_encode(&terms);
        self.providers
            .iter()
            .map(|p| ShopLink { provider: p.id.clone(), name: p.name.clone(), url: p.url_template.replace("{q}", &q), color: p.color.clone() })
            .collect()
    }

    pub(crate) fn build_solution(&self, s: SolutionDef, make: Option<&str>) -> Solution {
        let parts: Vec<Part> = s
            .parts
            .into_iter()
            .map(|p| Part {
                links: self.links(&p.query, make),
                name: p.name,
                qty: p.qty,
                price_min: p.price_min * p.qty as f64,
                price_max: p.price_max * p.qty as f64,
            })
            .collect();
        let parts_min: f64 = parts.iter().map(|p| p.price_min).sum();
        let parts_max: f64 = parts.iter().map(|p| p.price_max).sum();
        let rate = self.labor_rate_eur_h / 60.0;
        let labor_min = (s.time_min as f64 * rate).round();
        let labor_max = (s.time_max as f64 * rate).round();
        Solution {
            difficulty_label: difficulty_label(s.difficulty),
            title: s.title,
            description: s.description,
            difficulty: s.difficulty.clamp(1, 5),
            time_min: s.time_min,
            time_max: s.time_max,
            tools: s.tools,
            steps: s.steps,
            cost: CostEstimate {
                parts_min,
                parts_max,
                labor_min,
                labor_max,
                garage_min: parts_min + labor_min,
                garage_max: parts_max + labor_max,
            },
            parts,
        }
    }

    /// Full diagnosis for a code. `make` (e.g. "Renault") refines the shop searches.
    /// Returns `None` only if `code` is not a syntactically valid DTC.
    pub fn lookup(&self, code: &str, make: Option<&str>) -> Option<Diagnosis> {
        let code = dtc::normalize(code)?;
        let manufacturer_specific = is_manufacturer_specific(&code);

        let exact = self.entries.iter().find(|(_, d)| d.code.as_deref() == Some(code.as_str()));
        let found = exact.map(|(raw, _)| (raw.clone(), MatchKind::Exact)).or_else(|| {
            self.entries.iter().find_map(|(raw, d)| {
                let range = d.range.as_ref()?;
                if !in_range(&code, range) {
                    return None;
                }
                let n = code[3..].parse::<i32>().ok()? - d.n_offset;
                Some((substitute(raw, &n.to_string()), MatchKind::Range))
            })
        });

        if let Some((raw, match_kind)) = found {
            let e: EntryDef = serde_json::from_value(raw).ok()?;
            let mut causes = e.causes;
            causes.sort_by(|a, b| b.likelihood.cmp(&a.likelihood));
            return Some(Diagnosis {
                code,
                match_kind,
                manufacturer_specific,
                title: e.title,
                description: e.description,
                system: e.system,
                severity: e.severity,
                drivable: e.drivable,
                how_it_works: e.how_it_works,
                sensory_checks: e.sensory_checks,
                symptoms: e.symptoms,
                components: e.components.iter().map(|c| self.component_ref(c)).collect(),
                causes,
                solutions: e.solutions.into_iter().map(|s| self.build_solution(s, make)).collect(),
            });
        }

        let fb = self
            .fallbacks
            .iter()
            .filter(|f| code.starts_with(&f.prefix))
            .max_by_key(|f| f.prefix.len())?;
        let mut description = fb.description.clone();
        if manufacturer_specific {
            description.push_str(
                " Ce code est spécifique au constructeur : sa signification exacte dépend de la marque. \
                 Consultez la documentation constructeur ou un forum dédié à votre modèle.",
            );
        }
        Some(Diagnosis {
            code,
            match_kind: MatchKind::Generic,
            manufacturer_specific,
            title: fb.title.clone(),
            description,
            system: fb.system.clone(),
            severity: fb.severity,
            how_it_works: None,
            sensory_checks: vec![],
            drivable: "À évaluer : faites contrôler le véhicule si un voyant est allumé ou si le comportement a changé.".into(),
            symptoms: vec![],
            components: fb.components.iter().map(|c| self.component_ref(c)).collect(),
            causes: vec![],
            solutions: vec![],
        })
    }

    /// Every code with dedicated content (ranges expanded), for search / autocomplete.
    pub fn catalog(&self) -> Vec<CatalogItem> {
        let mut out = Vec::new();
        for (_, d) in &self.entries {
            let codes: Vec<String> = match (&d.code, &d.range) {
                (Some(c), _) => vec![c.clone()],
                (None, Some(r)) => match (code_value(&r[0]), code_value(&r[1])) {
                    (Some((s, lo)), Some((_, hi))) => (lo..=hi)
                        .map(|v| format!("{s}{v:04X}"))
                        .filter(|c| c[3..].parse::<i32>().is_ok())
                        .collect(),
                    _ => vec![],
                },
                _ => vec![],
            };
            for c in codes {
                if let Some(diag) = self.lookup(&c, None) {
                    out.push(CatalogItem { code: diag.code, title: diag.title, system: diag.system, severity: diag.severity });
                }
            }
        }
        out.sort_by(|a, b| a.code.cmp(&b.code));
        out.dedup_by(|a, b| a.code == b.code);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_kb_is_consistent() {
        let kb = KnowledgeBase::embedded();
        assert!(kb.catalog().len() > 40, "catalog: {}", kb.catalog().len());
        // Every referenced component must exist in the 3D component table.
        for item in kb.catalog() {
            let d = kb.lookup(&item.code, None).unwrap();
            for c in &d.components {
                assert!(kb.component_info(&c.id).is_some(), "{}: unknown component {}", item.code, c.id);
            }
            for s in &d.solutions {
                assert!(s.time_min <= s.time_max, "{}: {}", item.code, s.title);
                assert!((1..=5).contains(&s.difficulty));
                for p in &s.parts {
                    assert!(p.price_min <= p.price_max, "{}: {}", item.code, p.name);
                }
            }
            assert!(!d.title.contains("{n}"));
            if !matches!(d.match_kind, MatchKind::Generic) {
                assert!(d.how_it_works.is_some(), "{}: missing how_it_works", item.code);
                assert!(d.sensory_checks.len() >= 2, "{}: needs sensory checks", item.code);
                for c in &d.sensory_checks {
                    assert!(["sight", "sound", "smell", "touch", "feel"].contains(&c.sense.as_str()), "{}: {}", item.code, c.sense);
                }
            }
        }
    }

    #[test]
    fn exact_range_and_generic_matches() {
        let kb = KnowledgeBase::embedded();
        let d = kb.lookup("p0420", None).unwrap();
        assert!(matches!(d.match_kind, MatchKind::Exact));
        assert!(!d.solutions.is_empty());

        let d = kb.lookup("P0303", None).unwrap();
        assert!(matches!(d.match_kind, MatchKind::Range));
        assert!(d.title.contains('3'), "{}", d.title);
        assert!(d.components.iter().any(|c| c.id == "cylinder_3"));

        let d = kb.lookup("P1234", None).unwrap();
        assert!(matches!(d.match_kind, MatchKind::Generic));
        assert!(d.manufacturer_specific);

        assert!(kb.lookup("hello", None).is_none());
    }

    #[test]
    fn shop_links_and_costs() {
        let kb = KnowledgeBase::embedded();
        let d = kb.lookup("P0420", Some("Peugeot")).unwrap();
        let part = d.solutions.iter().flat_map(|s| &s.parts).next().unwrap();
        assert_eq!(part.links.len(), kb.providers.len());
        assert!(part.links.iter().all(|l| l.url.starts_with("https://") && l.url.contains("Peugeot")));
        let s = &d.solutions[0];
        assert!(s.cost.garage_min >= s.cost.parts_min);
    }

    #[test]
    fn encodes_urls() {
        assert_eq!(url_encode("sonde lambda é"), "sonde+lambda+%C3%A9");
    }
}
