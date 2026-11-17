//! Offline engine-sound analysis (heuristic).
//!
//! Works on a mono recording (file or live microphone, captured by the UI):
//!
//! * **Firing frequency / RPM** – autocorrelation of the amplitude envelope. A 4-stroke engine fires
//!   `cylinders / 2` times per crank revolution, so `rpm = f_firing × 120 / cylinders`.
//! * **Misfire** – a cylinder that does not fire breaks the periodicity at the firing period, while
//!   the pattern still repeats every engine cycle (2 revolutions). Comparing both autocorrelation
//!   peaks gives a misfire index.
//! * **Squeal / whistle** – narrow tonal peaks well above the local spectral floor
//!   (1.5–5 kHz: belt or brake squeal, 5–12 kHz: turbo whistle).
//! * **Ticking** – sharp periodic transients in the high band (valve lifters, injectors, exhaust leak).
//! * **Hiss** – flat, broadband high-frequency noise (air or vacuum leak).
//!
//! These are hints to guide the user, never a verdict: microphone quality, background noise and
//! placement matter a lot. The results feed the symptom questionnaire as extra evidence.

use serde::{Deserialize, Serialize};

use crate::symptoms::ExtraEvidence;

#[derive(Debug, Clone, Deserialize)]
pub struct AudioRequest {
    pub sample_rate: f32,
    #[serde(default)]
    pub cylinders: Option<u32>,
    /// Expected RPM range (e.g. 600–1100 when the user says the engine idles, or an OBD reading ±10 %).
    #[serde(default)]
    pub rpm_min: Option<f64>,
    #[serde(default)]
    pub rpm_max: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Tone {
    pub hz: f64,
    pub prominence_db: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioFinding {
    pub id: &'static str,
    pub title: &'static str,
    /// 0–1
    pub confidence: f64,
    pub explanation: String,
    /// Symptom-guide hypotheses this finding supports.
    pub hypotheses: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioReport {
    pub duration_s: f64,
    pub level_db: f64,
    pub firing_hz: Option<f64>,
    pub estimated_rpm: Option<f64>,
    pub cylinders_assumed: u32,
    /// 0–1: how strongly periodic the engine sound is.
    pub periodicity: f64,
    pub misfire_index: Option<f64>,
    pub tones: Vec<Tone>,
    pub findings: Vec<AudioFinding>,
    pub warnings: Vec<String>,
    /// For display: log-frequency spectrum (dB) and its bin centre frequencies.
    pub spectrum_db: Vec<f32>,
    pub spectrum_hz: Vec<f32>,
    /// For display: normalised amplitude envelope (≈ 1 point / 10 ms, max 600 points).
    pub envelope: Vec<f32>,
}

impl AudioReport {
    /// Converts findings into evidence for [`crate::symptoms::SymptomGuide::evaluate`].
    pub fn as_evidence(&self) -> Vec<ExtraEvidence> {
        self.findings
            .iter()
            .flat_map(|f| {
                f.hypotheses.iter().map(move |h| ExtraEvidence {
                    hypothesis: h.to_string(),
                    weight: (f.confidence * 9.0).round(),
                    label: format!("Audio : {}", f.title.to_lowercase()),
                })
            })
            .filter(|e| e.weight > 0.0)
            .collect()
    }
}

// ---------------------------------------------------------------------------------------------
// DSP helpers

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    debug_assert!(n.is_power_of_two());
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f64::consts::PI / len as f64;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let a = start + k;
                let b = a + len / 2;
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
}

/// Welch-averaged power spectrum (linear), `n` bins up to Nyquist.
fn power_spectrum(x: &[f64], size: usize) -> Vec<f64> {
    let hann: Vec<f64> = (0..size).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / size as f64).cos()).collect();
    let mut acc = vec![0.0; size / 2];
    let mut frames = 0;
    let mut start = 0;
    while start + size <= x.len() {
        let mut re: Vec<f64> = x[start..start + size].iter().zip(&hann).map(|(a, w)| a * w).collect();
        let mut im = vec![0.0; size];
        fft(&mut re, &mut im);
        for k in 0..size / 2 {
            acc[k] += re[k] * re[k] + im[k] * im[k];
        }
        frames += 1;
        start += size / 2;
    }
    if frames > 0 {
        acc.iter_mut().for_each(|v| *v /= frames as f64);
    }
    acc
}

/// RMS envelope with one value per `hop` samples.
fn envelope(x: &[f64], hop: usize) -> Vec<f64> {
    x.chunks(hop).map(|c| (c.iter().map(|v| v * v).sum::<f64>() / c.len() as f64).sqrt()).collect()
}

/// Normalised autocorrelation of a zero-mean series at `lag`.
fn autocorr(e: &[f64], lag: usize) -> f64 {
    if lag >= e.len() {
        return 0.0;
    }
    let (a, b) = (&e[..e.len() - lag], &e[lag..]);
    let num: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let den = (a.iter().map(|x| x * x).sum::<f64>() * b.iter().map(|y| y * y).sum::<f64>()).sqrt();
    if den > 0.0 { num / den } else { 0.0 }
}

fn percentile(v: &[f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    s[((s.len() - 1) as f64 * p).round() as usize]
}

fn db(p: f64) -> f64 {
    10.0 * (p.max(1e-20)).log10()
}

fn zero_mean(v: &[f64]) -> Vec<f64> {
    let m = v.iter().sum::<f64>() / v.len().max(1) as f64;
    v.iter().map(|x| x - m).collect()
}

// ---------------------------------------------------------------------------------------------

pub fn analyze(samples: &[f32], req: &AudioRequest) -> AudioReport {
    let sr = req.sample_rate as f64;
    let max_len = (sr * 20.0) as usize;
    let x: Vec<f64> = zero_mean(&samples[..samples.len().min(max_len)].iter().map(|&s| s as f64).collect::<Vec<_>>());
    let duration_s = x.len() as f64 / sr;
    let cyl = req.cylinders.unwrap_or(4).clamp(1, 16);
    let mut warnings = Vec::new();
    let mut findings = Vec::new();

    let rms = (x.iter().map(|v| v * v).sum::<f64>() / x.len().max(1) as f64).sqrt();
    let level_db = 20.0 * rms.max(1e-9).log10();

    let empty = |warnings: Vec<String>| AudioReport {
        duration_s,
        level_db,
        firing_hz: None,
        estimated_rpm: None,
        cylinders_assumed: cyl,
        periodicity: 0.0,
        misfire_index: None,
        tones: vec![],
        findings: vec![],
        warnings,
        spectrum_db: vec![],
        spectrum_hz: vec![],
        envelope: vec![],
    };
    if duration_s < 2.0 {
        return empty(vec!["Enregistrement trop court : il faut au moins 2 secondes (idéalement 8 à 10).".into()]);
    }
    if level_db < -55.0 {
        return empty(vec!["Signal trop faible : rapprochez le micro du moteur.".into()]);
    }
    if req.cylinders.is_none() {
        warnings.push("Nombre de cylindres inconnu : 4 supposés. Choisissez votre véhicule pour un régime plus juste.".into());
    }
    if sr < 22_000.0 {
        warnings.push("Fréquence d'échantillonnage faible : les sifflements aigus (turbo) ne sont pas analysables.".into());
    }
    let clipped = x.iter().filter(|v| v.abs() > 0.98).count() as f64 / x.len() as f64;
    if clipped > 0.01 {
        warnings.push("Saturation détectée : éloignez un peu le micro ou baissez le gain.".into());
    }

    // --- Envelope at 1 kHz --------------------------------------------------------------------
    let hop = (sr / 1000.0).round().max(1.0) as usize;
    let env_raw = envelope(&x, hop);
    let env = zero_mean(&env_raw);
    let env_rate = sr / hop as f64;

    let rpm_min = req.rpm_min.unwrap_or(500.0).max(200.0);
    let rpm_max = req.rpm_max.unwrap_or(4500.0).max(rpm_min + 50.0);
    let fire_hz = |rpm: f64| rpm / 60.0 * cyl as f64 / 2.0;
    let lag_lo = ((env_rate / fire_hz(rpm_max)).floor() as usize).max(2);
    let lag_hi = ((env_rate / fire_hz(rpm_min)).ceil() as usize).min(env.len() / 3);

    let mut firing_hz = None;
    let mut estimated_rpm = None;
    let mut periodicity = 0.0;
    let mut misfire_index = None;

    if lag_lo < lag_hi {
        let ac: Vec<(usize, f64)> = (lag_lo..=lag_hi).map(|l| (l, autocorr(&env, l))).collect();
        let best = ac.iter().map(|a| a.1).fold(f64::MIN, f64::max);
        // Smallest lag that is a local maximum close to the global best (avoids sub-harmonics).
        let pick = ac
            .windows(3)
            .filter(|w| w[1].1 >= w[0].1 && w[1].1 >= w[2].1 && w[1].1 >= 0.85 * best)
            .map(|w| w[1])
            .next()
            .or_else(|| ac.iter().copied().max_by(|a, b| a.1.total_cmp(&b.1)));
        if let Some((lag, r)) = pick {
            // Parabolic interpolation for a sub-sample lag.
            let (r0, r2) = (autocorr(&env, lag - 1), autocorr(&env, lag + 1));
            let denom = r0 - 2.0 * r + r2;
            let frac = if denom.abs() > 1e-12 { 0.5 * (r0 - r2) / denom } else { 0.0 };
            let lag_f = lag as f64 + frac.clamp(-0.5, 0.5);
            periodicity = r.max(0.0);
            if r > 0.2 {
                let f = env_rate / lag_f;
                firing_hz = Some((f * 100.0).round() / 100.0);
                estimated_rpm = Some((f * 120.0 / cyl as f64 / 10.0).round() * 10.0);

                // Misfire: periodicity at the engine cycle vs at the firing period.
                if cyl >= 2 {
                    let cycle = (lag_f * cyl as f64).round() as usize;
                    let r_cycle = (cycle.saturating_sub(2)..=cycle + 2).map(|l| autocorr(&env, l)).fold(f64::MIN, f64::max);
                    if r_cycle > 0.3 {
                        let idx = ((r_cycle - r) / r_cycle).clamp(0.0, 1.0);
                        misfire_index = Some((idx * 100.0).round() / 100.0);
                    }
                }
            }
        }
        // If the cycle pattern dominates so much that the firing period was missed entirely,
        // look for a strong peak at cyl × lag in an extended range.
        if firing_hz.is_none() && cyl >= 2 {
            let hi = (lag_hi * cyl as usize).min(env.len() / 3);
            let lo = lag_lo * cyl as usize;
            if lo < hi {
                if let Some((l, r)) = (lo..=hi).map(|l| (l, autocorr(&env, l))).max_by(|a, b| a.1.total_cmp(&b.1)) {
                    if r > 0.4 {
                        let f = env_rate * cyl as f64 / l as f64;
                        firing_hz = Some((f * 100.0).round() / 100.0);
                        estimated_rpm = Some((f * 120.0 / cyl as f64 / 10.0).round() * 10.0);
                        misfire_index = Some(1.0);
                        periodicity = r;
                    }
                }
            }
        }
    }

    match (misfire_index, estimated_rpm) {
        (Some(m), Some(rpm)) if m >= 0.25 => findings.push(AudioFinding {
            id: "misfire",
            title: "Combustion irrégulière (ratés probables)",
            confidence: ((m - 0.15) * 1.6).clamp(0.2, 0.95),
            explanation: format!(
                "Le son se répète à chaque cycle moteur (≈ {:.0} tr/min) mais pas à chaque explosion : \
                 un cylindre semble ne pas brûler correctement. Vérifiez bougies et bobines.",
                rpm
            ),
            hypotheses: vec!["misfire_ignition", "injector_fault"],
        }),
        _ => {}
    }
    if firing_hz.is_none() {
        warnings.push("Pas de rythme moteur net : bruit de fond trop fort ou micro trop loin ?".into());
    }

    // --- Spectrum ------------------------------------------------------------------------------
    let fft_size = 4096.min(x.len().next_power_of_two() / 2).max(256);
    let ps = power_spectrum(&x, fft_size);
    let bin_hz = sr / fft_size as f64;
    let ps_db: Vec<f64> = ps.iter().map(|&p| db(p)).collect();

    let mut tones: Vec<Tone> = Vec::new();
    let half_win = (150.0 / bin_hz).ceil() as usize;
    for k in 2..ps_db.len().saturating_sub(2) {
        let hz = k as f64 * bin_hz;
        if hz < 800.0 || hz > sr / 2.0 * 0.95 {
            continue;
        }
        if !(ps_db[k] > ps_db[k - 1] && ps_db[k] >= ps_db[k + 1]) {
            continue;
        }
        let lo = k.saturating_sub(half_win);
        let hi = (k + half_win).min(ps_db.len() - 1);
        let floor = percentile(&ps_db[lo..=hi], 0.5);
        let prom = ps_db[k] - floor;
        if prom >= 15.0 {
            tones.push(Tone { hz: hz.round(), prominence_db: (prom * 10.0).round() / 10.0 });
        }
    }
    tones.sort_by(|a, b| b.prominence_db.total_cmp(&a.prominence_db));
    tones.truncate(5);

    let total_power: f64 = ps.iter().sum();
    let tone_energy_share = |t: &Tone| {
        let k = (t.hz / bin_hz).round() as usize;
        let e: f64 = ps[k.saturating_sub(2)..(k + 3).min(ps.len())].iter().sum();
        e / total_power.max(1e-20)
    };
    if let Some(t) = tones.iter().find(|t| (1500.0..5000.0).contains(&t.hz) && tone_energy_share(t) > 0.01) {
        findings.push(AudioFinding {
            id: "squeal",
            title: "Couinement aigu (son pur)",
            confidence: ((t.prominence_db - 12.0) / 20.0).clamp(0.25, 0.9),
            explanation: format!(
                "Son pur vers {:.0} Hz. Si le bruit apparaît au démarrage ou en braquant : courroie d'accessoires. \
                 S'il apparaît au freinage : témoin d'usure des plaquettes.",
                t.hz
            ),
            hypotheses: vec!["accessory_belt", "brake_wear"],
        });
    }
    if let Some(t) = tones.iter().find(|t| (5000.0..12_000.0).contains(&t.hz) && tone_energy_share(t) > 0.005) {
        findings.push(AudioFinding {
            id: "whistle",
            title: "Sifflement très aigu",
            confidence: ((t.prominence_db - 12.0) / 20.0).clamp(0.25, 0.85),
            explanation: format!(
                "Sifflement vers {:.0} Hz. S'il monte avec le régime sur un moteur turbo, le turbo est à faire contrôler.",
                t.hz
            ),
            hypotheses: vec!["turbo_worn"],
        });
    }

    // Broadband hiss: spectral flatness in 2–8 kHz with notable energy share.
    let band = |a: f64, b: f64| -> &[f64] {
        let lo = (a / bin_hz) as usize;
        let hi = ((b / bin_hz) as usize).min(ps.len());
        if lo < hi { &ps[lo..hi] } else { &[] }
    };
    let hiss_band = band(2000.0, 8000.0_f64.min(sr / 2.0));
    if !hiss_band.is_empty() {
        let geo = (hiss_band.iter().map(|p| p.max(1e-20).ln()).sum::<f64>() / hiss_band.len() as f64).exp();
        let arith = hiss_band.iter().sum::<f64>() / hiss_band.len() as f64;
        let flatness = geo / arith.max(1e-20);
        let share = hiss_band.iter().sum::<f64>() / total_power.max(1e-20);
        if flatness > 0.45 && share > 0.25 && tones.is_empty() {
            findings.push(AudioFinding {
                id: "hiss",
                title: "Souffle large bande",
                confidence: ((share - 0.2) * 1.5).clamp(0.2, 0.7),
                explanation: "Beaucoup d'énergie en souffle aigu sans note précise : typique d'une fuite d'air \
                              (durite de dépression ou de turbo) si le micro est près de l'admission."
                    .into(),
                hypotheses: vec!["vacuum_leak", "turbo_leak"],
            });
        }
    }

    // Ticking: sharp transients in the high band (second difference ≈ high-pass).
    let hp: Vec<f64> = x.windows(3).map(|w| w[2] - 2.0 * w[1] + w[0]).collect();
    let hp_env = zero_mean(&envelope(&hp, hop));
    let p50 = percentile(&envelope(&hp, hop), 0.5);
    let p99 = percentile(&envelope(&hp, hop), 0.99);
    let crest = if p50 > 0.0 { p99 / p50 } else { 0.0 };
    if crest > 4.0 {
        // Periodic? Check the camshaft (half crank) and crank frequencies around the estimated RPM.
        let periodic = estimated_rpm
            .map(|rpm| {
                [rpm / 120.0, rpm / 60.0, fire_hz(rpm)]
                    .iter()
                    .map(|f| autocorr(&hp_env, (env_rate / f).round() as usize))
                    .fold(f64::MIN, f64::max)
            })
            .unwrap_or(0.0);
        if periodic > 0.3 {
            findings.push(AudioFinding {
                id: "tick",
                title: "Tic-tic régulier",
                confidence: ((crest - 3.0) / 8.0 + periodic / 3.0).clamp(0.2, 0.85),
                explanation: "Claquements secs au rythme du moteur. Pensez d'abord au niveau d'huile (poussoirs), \
                              puis à une fuite d'échappement au collecteur ou à un injecteur bruyant."
                    .into(),
                hypotheses: vec!["oil_low", "exhaust_leak", "injector_fault"],
            });
        }
    }

    // Idle stability: coefficient of variation of the 100 ms RMS.
    let slow = envelope(&x, (sr / 10.0) as usize);
    if slow.len() >= 20 {
        let m = slow.iter().sum::<f64>() / slow.len() as f64;
        let sd = (slow.iter().map(|v| (v - m).powi(2)).sum::<f64>() / slow.len() as f64).sqrt();
        let cv = sd / m.max(1e-12);
        if cv > 0.25 && !findings.iter().any(|f| f.id == "misfire") {
            findings.push(AudioFinding {
                id: "unstable",
                title: "Régime / volume instable",
                confidence: ((cv - 0.2) * 2.0).clamp(0.15, 0.6),
                explanation: "Le niveau sonore varie beaucoup d'une seconde à l'autre. Si le moteur était au ralenti sans \
                              action sur l'accélérateur, le ralenti « pompe » : prise d'air ou boîtier papillon encrassé."
                    .into(),
                hypotheses: vec!["vacuum_leak"],
            });
        }
    }

    findings.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));

    // --- Display data --------------------------------------------------------------------------
    let (mut spectrum_db, mut spectrum_hz) = (Vec::new(), Vec::new());
    let (f_lo, f_hi) = (30.0_f64, (sr / 2.0).min(16_000.0));
    let n_bins = 96;
    for i in 0..n_bins {
        let a = f_lo * (f_hi / f_lo).powf(i as f64 / n_bins as f64);
        let b = f_lo * (f_hi / f_lo).powf((i + 1) as f64 / n_bins as f64);
        let (ka, kb) = ((a / bin_hz) as usize, ((b / bin_hz).ceil() as usize).min(ps.len()));
        let p = if ka < kb { ps[ka..kb].iter().sum::<f64>() / (kb - ka) as f64 } else { ps[ka.min(ps.len() - 1)] };
        spectrum_db.push(db(p) as f32);
        spectrum_hz.push(((a * b).sqrt()) as f32);
    }
    let step = (env_raw.len() / 600).max(10);
    let env_disp: Vec<f64> = env_raw.chunks(step).map(|c| c.iter().cloned().fold(0.0, f64::max)).collect();
    let env_max = env_disp.iter().cloned().fold(1e-12, f64::max);

    AudioReport {
        duration_s: (duration_s * 10.0).round() / 10.0,
        level_db: (level_db * 10.0).round() / 10.0,
        firing_hz,
        estimated_rpm,
        cylinders_assumed: cyl,
        periodicity: (periodicity * 100.0).round() / 100.0,
        misfire_index,
        tones,
        findings,
        warnings,
        spectrum_db,
        spectrum_hz,
        envelope: env_disp.iter().map(|v| (v / env_max) as f32).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 24_000.0;

    /// Synthetic engine: a decaying 180 Hz "thump" for every firing, optionally skipping one
    /// cylinder, plus light noise.
    fn engine(rpm: f64, cyl: u32, misfire: bool, seconds: f64) -> Vec<f32> {
        let n = (SR as f64 * seconds) as usize;
        let period = 60.0 / rpm * 2.0 / cyl as f64;
        let mut out = vec![0.0f32; n];
        let mut seed: u32 = 12345;
        let mut noise = || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            ((seed >> 16) as f32 / 32768.0 - 1.0) * 0.02
        };
        let mut t = 0.0;
        let mut k = 0u32;
        while t < seconds {
            let fire = !(misfire && k % cyl == 1);
            if fire {
                let start = (t * SR as f64) as usize;
                for i in 0..(SR as usize / 50) {
                    if start + i >= n {
                        break;
                    }
                    let tt = i as f64 / SR as f64;
                    out[start + i] += (0.6 * (-tt * 120.0).exp() * (2.0 * std::f64::consts::PI * 180.0 * tt).sin()) as f32;
                }
            }
            t += period;
            k += 1;
        }
        out.iter_mut().for_each(|s| *s += noise());
        out
    }

    fn req(cyl: u32) -> AudioRequest {
        AudioRequest { sample_rate: SR, cylinders: Some(cyl), rpm_min: Some(600.0), rpm_max: Some(1100.0) }
    }

    #[test]
    fn estimates_idle_rpm() {
        let r = analyze(&engine(820.0, 4, false, 6.0), &req(4));
        let rpm = r.estimated_rpm.expect("rpm");
        assert!((rpm - 820.0).abs() < 40.0, "rpm {rpm}");
        assert!(!r.findings.iter().any(|f| f.id == "misfire"), "{:?}", r.findings);
    }

    #[test]
    fn detects_misfire() {
        let r = analyze(&engine(800.0, 4, true, 6.0), &req(4));
        assert!(r.findings.iter().any(|f| f.id == "misfire"), "misfire index {:?} findings {:?}", r.misfire_index, r.findings);
        let rpm = r.estimated_rpm.unwrap();
        assert!((rpm - 800.0).abs() < 60.0, "rpm {rpm}");
        assert!(r.as_evidence().iter().any(|e| e.hypothesis == "misfire_ignition"));
    }

    #[test]
    fn detects_belt_squeal() {
        let mut s = engine(850.0, 4, false, 5.0);
        for (i, v) in s.iter_mut().enumerate() {
            *v += 0.08 * (2.0 * std::f32::consts::PI * 3200.0 * i as f32 / SR).sin();
        }
        let r = analyze(&s, &req(4));
        assert!(r.findings.iter().any(|f| f.id == "squeal"), "{:?} tones {:?}", r.findings, r.tones);
        assert!(r.tones.iter().any(|t| (t.hz - 3200.0).abs() < 20.0));
    }

    #[test]
    fn rejects_short_or_silent_input() {
        assert!(!analyze(&vec![0.1; 1000], &req(4)).warnings.is_empty());
        assert!(!analyze(&vec![0.0; 100_000], &req(4)).warnings.is_empty());
    }
}
