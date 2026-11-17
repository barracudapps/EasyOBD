//! "Diagnostic à l'œil" – symptom questionnaire without any scan tool.
//!
//! Each answer option adds (or removes) weight to hypotheses. Hypotheses link to knowledge-base codes,
//! 3D components, next checks and maintenance tutorials. Audio-analysis findings can be added as
//! extra evidence.

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::knowledge::{KnowledgeBase, Severity};
use crate::{Error, Result};

const EMBEDDED: &str = include_str!("../../../data/symptoms.fr.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub weights: BTreeMap<String, f64>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Display condition on another question's answer (e.g. only for electric vehicles).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub question: String,
    pub options: Vec<String>,
}

impl Condition {
    fn matches(&self, answers: &HashMap<String, Vec<String>>) -> bool {
        answers.get(&self.question).is_some_and(|a| a.iter().any(|o| self.options.contains(o)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub id: String,
    pub sense: String,
    pub multi: bool,
    pub text: String,
    #[serde(default)]
    pub help: Option<String>,
    pub options: Vec<AnswerOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_if: Option<Condition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide_if: Option<Condition>,
}

impl Question {
    /// Whether the question applies given the answers so far.
    pub fn visible(&self, answers: &HashMap<String, Vec<String>>) -> bool {
        self.show_if.as_ref().is_none_or(|c| c.matches(answers)) && !self.hide_if.as_ref().is_some_and(|c| c.matches(answers))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hypothesis {
    pub id: String,
    pub title: String,
    pub explanation: String,
    #[serde(default)]
    pub codes: Vec<String>,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub next_checks: Vec<String>,
    pub severity: Severity,
    #[serde(default)]
    pub tutorial: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SymptomsFile {
    version: String,
    intro: String,
    questions: Vec<Question>,
    hypotheses: Vec<Hypothesis>,
}

/// Evidence coming from another source (e.g. the audio analysis).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraEvidence {
    pub hypothesis: String,
    pub weight: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodeRef {
    pub code: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RankedHypothesis {
    pub id: String,
    pub title: String,
    pub explanation: String,
    pub score: f64,
    /// Relative to the best hypothesis (0–100).
    pub relative: u8,
    /// "forte", "moyenne" or "faible" – from the absolute score.
    pub strength: &'static str,
    pub evidence: Vec<String>,
    pub codes: Vec<CodeRef>,
    pub components: Vec<String>,
    pub next_checks: Vec<String>,
    pub severity: Severity,
    pub tutorial: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Evaluation {
    pub hypotheses: Vec<RankedHypothesis>,
    /// Reassuring notes triggered by answers (e.g. "white vapour when cold is normal").
    pub notes: Vec<String>,
}

pub struct SymptomGuide {
    pub version: String,
    pub intro: String,
    pub questions: Vec<Question>,
    pub hypotheses: Vec<Hypothesis>,
}

impl SymptomGuide {
    pub fn embedded() -> &'static SymptomGuide {
        static G: OnceLock<SymptomGuide> = OnceLock::new();
        G.get_or_init(|| SymptomGuide::from_json(EMBEDDED).expect("embedded symptom guide must be valid"))
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let f: SymptomsFile = serde_json::from_str(json).map_err(|e| Error::KnowledgeBase(format!("symptômes : {e}")))?;
        Ok(Self { version: f.version, intro: f.intro, questions: f.questions, hypotheses: f.hypotheses })
    }

    /// `answers`: question id → selected option ids.
    pub fn evaluate(&self, kb: &KnowledgeBase, answers: &HashMap<String, Vec<String>>, extra: &[ExtraEvidence]) -> Evaluation {
        let mut scores: HashMap<&str, (f64, Vec<String>)> = HashMap::new();
        let mut notes = Vec::new();
        for q in self.questions.iter().filter(|q| q.visible(answers)) {
            let Some(selected) = answers.get(&q.id) else { continue };
            for opt in q.options.iter().filter(|o| selected.contains(&o.id)) {
                if let Some(n) = &opt.note {
                    notes.push(n.clone());
                }
                for (h, w) in &opt.weights {
                    let e = scores.entry(h.as_str()).or_default();
                    e.0 += w;
                    if *w > 0.0 {
                        e.1.push(opt.label.clone());
                    }
                }
            }
        }
        for x in extra {
            if let Some(h) = self.hypotheses.iter().find(|h| h.id == x.hypothesis) {
                let e = scores.entry(h.id.as_str()).or_default();
                e.0 += x.weight;
                e.1.push(x.label.clone());
            }
        }

        let mut ranked: Vec<RankedHypothesis> = self
            .hypotheses
            .iter()
            .filter_map(|h| {
                let (score, evidence) = scores.get(h.id.as_str())?.clone();
                // Require positive evidence, not just a fuel-type bias.
                (score >= 3.0 && !evidence.is_empty()).then(|| RankedHypothesis {
                    id: h.id.clone(),
                    title: h.title.clone(),
                    explanation: h.explanation.clone(),
                    score,
                    relative: 0,
                    strength: if score >= 12.0 { "forte" } else if score >= 7.0 { "moyenne" } else { "faible" },
                    evidence,
                    codes: h
                        .codes
                        .iter()
                        .filter_map(|c| kb.lookup(c, None).map(|d| CodeRef { code: d.code, title: d.title }))
                        .collect(),
                    components: h.components.clone(),
                    next_checks: h.next_checks.clone(),
                    severity: h.severity,
                    tutorial: h.tutorial.clone(),
                })
            })
            .collect();
        ranked.sort_by(|a, b| b.score.total_cmp(&a.score).then(b.severity.cmp(&a.severity)));
        ranked.truncate(6);
        if let Some(best) = ranked.first().map(|r| r.score) {
            for r in &mut ranked {
                r.relative = ((r.score / best) * 100.0).round().clamp(0.0, 100.0) as u8;
            }
        }
        Evaluation { hypotheses: ranked, notes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maintenance::Maintenance;

    fn answers(pairs: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        pairs.iter().map(|(q, o)| (q.to_string(), o.iter().map(|s| s.to_string()).collect())).collect()
    }

    #[test]
    fn data_references_are_valid() {
        let g = SymptomGuide::embedded();
        let kb = KnowledgeBase::embedded();
        let m = Maintenance::embedded();
        let ids: Vec<_> = g.hypotheses.iter().map(|h| h.id.as_str()).collect();
        for q in &g.questions {
            for o in &q.options {
                for h in o.weights.keys() {
                    assert!(ids.contains(&h.as_str()), "{}/{}: unknown hypothesis {h}", q.id, o.id);
                }
            }
        }
        for h in &g.hypotheses {
            for c in &h.codes {
                assert!(kb.lookup(c, None).is_some(), "{}: {c}", h.id);
            }
            for c in &h.components {
                assert!(kb.component_info(c).is_some() || m.components.contains_key(c), "{}: component {c}", h.id);
            }
            if let Some(t) = &h.tutorial {
                assert!(m.tutorial(t).is_some(), "{}: tutorial {t}", h.id);
            }
        }
    }

    #[test]
    fn ranks_obvious_cases() {
        let g = SymptomGuide::embedded();
        let kb = KnowledgeBase::embedded();
        let e = g.evaluate(kb, &answers(&[("fuel", &["petrol"]), ("lights", &["mil_flash"]), ("behaviour", &["shake_idle"]), ("when", &["rain"])]), &[]);
        assert_eq!(e.hypotheses[0].id, "misfire_ignition");
        assert_eq!(e.hypotheses[0].relative, 100);
        assert_eq!(e.hypotheses[0].strength, "forte");

        let e = g.evaluate(kb, &answers(&[("smoke", &["white_thin"])]), &[]);
        assert!(e.hypotheses.is_empty());
        assert_eq!(e.notes.len(), 1);

        // Electric vehicle: engine hypotheses are excluded, EV ones come up.
        let e = g.evaluate(kb, &answers(&[("fuel", &["electric"]), ("behaviour", &["no_ready"]), ("noises", &["slow_crank", "whine_speed"])]), &[]);
        assert_eq!(e.hypotheses[0].id, "ev_12v");
        assert!(e.hypotheses.iter().all(|h| h.id != "misfire_ignition" && h.id != "alternator"));
        assert!(e.hypotheses.iter().any(|h| h.id == "reducer_noise"));
        // Smoke answers are ignored for an EV (question hidden).
        let e = g.evaluate(kb, &answers(&[("fuel", &["electric"]), ("smoke", &["blue"])]), &[]);
        assert!(e.hypotheses.is_empty());

        let extra = [ExtraEvidence { hypothesis: "accessory_belt".into(), weight: 8.0, label: "Audio : couinement tonal".into() }];
        let e = g.evaluate(kb, &HashMap::new(), &extra);
        assert_eq!(e.hypotheses[0].id, "accessory_belt");
    }
}
