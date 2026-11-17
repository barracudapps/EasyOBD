//! Vehicle Identification Number (mode 09 PID 02) reading and light decoding.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
pub struct VehicleInfo {
    pub vin: Option<String>,
    pub make: Option<String>,
    pub model_year: Option<u16>,
    pub country: Option<String>,
}

/// Extracts the VIN from assembled mode 09 messages.
///
/// * CAN: a single message `49 02 01 <17 ASCII bytes>`
/// * Legacy: five messages `49 02 <seq> <4 bytes>` to concatenate in sequence order
pub fn parse_vin(messages: &[Vec<u8>]) -> Option<String> {
    let mut parts: Vec<(u8, &[u8])> = messages
        .iter()
        .filter(|m| m.len() > 3 && m[0] == 0x49 && m[1] == 0x02)
        .map(|m| (m[2], &m[3..]))
        .collect();
    parts.sort_by_key(|p| p.0);
    let raw: String = parts
        .iter()
        .flat_map(|p| p.1.iter())
        .filter(|b| b.is_ascii_alphanumeric())
        .map(|&b| b as char)
        .collect();
    (raw.len() >= 17).then(|| raw[raw.len() - 17..].to_string())
}

pub fn decode(vin: &str) -> VehicleInfo {
    let vin = vin.trim().to_uppercase();
    let wmi = vin.get(0..3).unwrap_or("");
    VehicleInfo {
        make: make_from_wmi(wmi).map(str::to_string),
        model_year: vin.chars().nth(9).and_then(model_year),
        country: vin.chars().next().and_then(country).map(str::to_string),
        vin: Some(vin),
    }
}

const WMI_TABLE: &[(&str, &str)] = &[
        ("VF1", "Renault"), ("VF6", "Renault Trucks"), ("VF3", "Peugeot"), ("VF7", "Citroën"), ("VR3", "Peugeot"),
        ("VR7", "Citroën"), ("VR1", "DS"), ("UU1", "Dacia"), ("VSS", "Seat"), ("VSK", "Nissan"), ("WVW", "Volkswagen"),
        ("WV1", "Volkswagen Utilitaires"), ("WV2", "Volkswagen Utilitaires"), ("WAU", "Audi"), ("WBA", "BMW"),
        ("WBS", "BMW M"), ("WMW", "Mini"), ("WDB", "Mercedes-Benz"), ("WDD", "Mercedes-Benz"), ("W1K", "Mercedes-Benz"),
        ("WP0", "Porsche"), ("W0L", "Opel"), ("W0V", "Opel"), ("TMB", "Škoda"), ("ZFA", "Fiat"), ("ZAR", "Alfa Romeo"),
        ("ZFF", "Ferrari"), ("SAL", "Land Rover"), ("SAJ", "Jaguar"), ("YV1", "Volvo"), ("YV4", "Volvo"), ("LYV", "Volvo (Chine)"), ("YS3", "Saab"), ("ZD4", "Aprilia"), ("ZCG", "MV Agusta"), ("LBB", "Benelli"), ("LCE", "CFMoto"), ("5HD", "Harley-Davidson"), ("56K", "Indian"), ("WP1", "Porsche"), ("JTH", "Lexus"), ("JF1", "Subaru"), ("JF2", "Subaru"), ("1C4", "Jeep"), ("ZAC", "Jeep"), ("LPS", "Polestar"), ("JTD", "Toyota"),
        ("JT2", "Toyota"), ("SB1", "Toyota"), ("VNK", "Toyota"), ("JHM", "Honda"), ("JN1", "Nissan"), ("SJN", "Nissan"),
        ("JMZ", "Mazda"), ("KMH", "Hyundai"), ("TMA", "Hyundai"), ("KNA", "Kia"), ("U5Y", "Kia"), ("WF0", "Ford"),
        ("1FA", "Ford"), ("1G1", "Chevrolet"), ("5YJ", "Tesla"), ("XP7", "Tesla"), ("7SA", "Tesla"), ("LRW", "Tesla"),
        ("JS2", "Suzuki"), ("TSM", "Suzuki"), ("JMB", "Mitsubishi"), ("SJA", "Bentley"),
        ("LSJ", "MG"), ("SDP", "MG"), ("LGX", "BYD"), ("LC0", "BYD"), ("YS2", "Scania"), ("YV2", "Volvo Trucks"),
        ("XLR", "DAF"), ("WMA", "MAN"), ("ZCF", "Iveco"), ("WDF", "Mercedes-Benz Utilitaires"), ("W1V", "Mercedes-Benz Utilitaires"),
        ("ZDM", "Ducati"), ("VBK", "KTM"), ("SMT", "Triumph"), ("JYA", "Yamaha"), ("JH2", "Honda Moto"), ("JKA", "Kawasaki"),
        ("WB1", "BMW Motorrad"), ("ZAP", "Piaggio"), ("538", "Zero Motorcycles"), ("WMZ", "Mini"), ("VSE", "Cupra / Seat"),
        ("LVS", "Ford (Chine)"), ("LFV", "Volkswagen (Chine)"), ("WME", "Smart"), ("ZLA", "Lancia"),
        ("ZGU", "Moto Guzzi"), ("JAL", "Isuzu"), ("ME3", "Royal Enfield"), ("RFB", "Kymco"),
    ];

fn make_from_wmi(wmi: &str) -> Option<&'static str> {
    WMI_TABLE.iter().find(|(p, _)| wmi.starts_with(p)).map(|(_, m)| *m)
}

fn fold(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'é' | 'è' | 'ë' | 'É' => 'e',
            'Š' | 'š' => 's',
            c => c.to_ascii_lowercase(),
        })
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Brand → WMI for demo VINs. `kind` ("car", "motorcycle", "truck", "van") picks the right
/// division when a brand has several (BMW / BMW Motorrad, Volvo / Volvo Trucks…).
fn wmi_for(make: &str, kind: &str) -> Option<&'static str> {
    let m = fold(make);
    // Brands sold under another maker's WMI.
    let alias = match m.as_str() {
        "abarth" => Some("ZFA"),
        "cupra" => Some("VSS"),
        "husqvarna" => Some("VBK"),
        "zero" => Some("538"),
        _ => None,
    };
    if alias.is_some() {
        return alias;
    }
    let division = match kind {
        "motorcycle" => ["motorrad", "moto"].as_slice(),
        "truck" => ["trucks"].as_slice(),
        "van" => ["utilitaires"].as_slice(),
        _ => [].as_slice(),
    };
    let candidates: Vec<&(&str, &str)> = WMI_TABLE
        .iter()
        .filter(|(_, n)| {
            let n = fold(n);
            n == m || (n.starts_with(&m) && !n.contains("chine"))
        })
        .collect();
    candidates
        .iter()
        .find(|(_, n)| division.iter().any(|d| fold(n).contains(d)))
        .or_else(|| candidates.iter().find(|(_, n)| fold(n) == m))
        .or(candidates.first())
        .map(|(w, _)| *w)
}

/// ISO 3779 / FMVSS 115 check digit (9th character).
fn check_digit(vin: &[u8; 17]) -> u8 {
    const WEIGHTS: [u32; 17] = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    let value = |c: u8| -> u32 {
        match c {
            b'0'..=b'9' => (c - b'0') as u32,
            b'A'..=b'H' => (c - b'A' + 1) as u32,
            b'J'..=b'N' => (c - b'J' + 1) as u32,
            b'P' => 7,
            b'R' => 9,
            b'S'..=b'Z' => (c - b'S' + 2) as u32,
            _ => 0,
        }
    };
    let sum: u32 = vin.iter().zip(WEIGHTS).map(|(c, w)| value(*c) * w).sum();
    match sum % 11 {
        10 => b'X',
        r => b'0' + r as u8,
    }
}

/// Plausible, well-formed demo VIN for the simulator, matching the selected vehicle
/// (brand WMI, model year, valid check digit). Unknown brands get the neutral WMI `SIM`.
pub fn demo_vin(make: &str, kind: &str, year: Option<u16>) -> String {
    const CODES: &[u8] = b"ABCDEFGHJKLMNPRSTVWXY123456789";
    let wmi = wmi_for(make, kind).unwrap_or("SIM");
    let year = year.unwrap_or(2020).clamp(1998, 2027);
    let ychar = CODES[(year as i32 - 2010).rem_euclid(30) as usize];
    let mut v = [0u8; 17];
    v[..3].copy_from_slice(wmi.as_bytes());
    v[3..8].copy_from_slice(b"DEM0Z");
    v[8] = b'0';
    v[9] = ychar;
    v[10] = b'S';
    v[11..].copy_from_slice(b"123456");
    v[8] = check_digit(&v);
    String::from_utf8_lossy(&v).into_owned()
}

fn country(c: char) -> Option<&'static str> {
    Some(match c {
        'V' => "France / Espagne",
        'W' => "Allemagne",
        'Z' => "Italie",
        'S' => "Royaume-Uni",
        'T' => "Suisse / Tchéquie / Hongrie",
        'U' => "Roumanie / Slovaquie",
        'Y' => "Suède / Finlande / Belgique",
        'J' => "Japon",
        'K' => "Corée du Sud",
        'L' => "Chine",
        '1' | '4' | '5' => "États-Unis",
        '2' => "Canada",
        '3' => "Mexique",
        _ => return None,
    })
}

/// 10th VIN character → model year (30-year cycle; the most recent plausible year is chosen).
fn model_year(c: char) -> Option<u16> {
    const CODES: &str = "ABCDEFGHJKLMNPRSTVWXY123456789";
    let idx = CODES.find(c)? as u16;
    let year = 2010 + idx; // 'A' = 2010 ... '9' = 2039
    Some(if year > 2027 { year - 30 } else { year })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_can_vin() {
        let mut msg = vec![0x49, 0x02, 0x01];
        msg.extend_from_slice(b"VF1RFB00X12345678");
        assert_eq!(parse_vin(&[msg]).as_deref(), Some("VF1RFB00X12345678"));
    }

    #[test]
    fn parses_legacy_vin() {
        let vin = b"\0\0\0WVWZZZ1KZ6W123456";
        let msgs: Vec<Vec<u8>> = vin
            .chunks(4)
            .enumerate()
            .rev()
            .map(|(i, c)| [&[0x49, 0x02, i as u8 + 1][..], c].concat())
            .collect();
        assert_eq!(parse_vin(&msgs).as_deref(), Some("WVWZZZ1KZ6W123456"));
    }

    #[test]
    fn decodes_vin() {
        let v = decode("VF1RFB00X6W123456");
        assert_eq!(v.make.as_deref(), Some("Renault"));
        assert_eq!(v.model_year, Some(2006));
        let v = decode("WVWZZZ1KZPW123456");
        assert_eq!(v.make.as_deref(), Some("Volkswagen"));
        assert_eq!(v.model_year, Some(2023));
    }

    #[test]
    fn demo_vins_match_the_vehicle() {
        // Reference VIN with a known valid check digit.
        let mut r = [0u8; 17];
        r.copy_from_slice(b"1M8GDM9AXKP042788");
        assert_eq!(check_digit(&r), b'X');
        for (make, kind, year, expected) in [
            ("Peugeot", "car", 2021, "Peugeot"),
            ("BMW", "motorcycle", 2024, "BMW Motorrad"),
            ("BMW", "car", 2019, "BMW"),
            ("Renault", "car", 2018, "Renault"),
            ("Renault Trucks", "truck", 2020, "Renault Trucks"),
            ("Volvo", "truck", 2022, "Volvo Trucks"),
            ("Skoda", "car", 2017, "Škoda"),
            ("Triumph", "motorcycle", 2015, "Triumph"),
            ("Citroën", "car", 2008, "Citroën"),
        ] {
            let vin = demo_vin(make, kind, Some(year));
            assert_eq!(vin.len(), 17);
            let mut b = [0u8; 17];
            b.copy_from_slice(vin.as_bytes());
            assert_eq!(check_digit(&b), b[8], "{vin}");
            let d = decode(&vin);
            assert_eq!(d.make.as_deref(), Some(expected), "{make} {kind} → {vin}");
            assert_eq!(d.model_year, Some(year), "{vin}");
        }
        assert!(decode(&demo_vin("Inconnue", "car", None)).make.is_none());
    }
}
