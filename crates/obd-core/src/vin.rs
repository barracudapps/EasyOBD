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

fn make_from_wmi(wmi: &str) -> Option<&'static str> {
    const TABLE: &[(&str, &str)] = &[
        ("VF1", "Renault"), ("VF6", "Renault Trucks"), ("VF3", "Peugeot"), ("VF7", "Citroën"), ("VR3", "Peugeot"),
        ("VR7", "Citroën"), ("VR1", "DS"), ("UU1", "Dacia"), ("VSS", "Seat"), ("VSK", "Nissan"), ("WVW", "Volkswagen"),
        ("WV1", "Volkswagen Utilitaires"), ("WV2", "Volkswagen Utilitaires"), ("WAU", "Audi"), ("WBA", "BMW"),
        ("WBS", "BMW M"), ("WMW", "Mini"), ("WDB", "Mercedes-Benz"), ("WDD", "Mercedes-Benz"), ("W1K", "Mercedes-Benz"),
        ("WP0", "Porsche"), ("W0L", "Opel"), ("W0V", "Opel"), ("TMB", "Škoda"), ("ZFA", "Fiat"), ("ZAR", "Alfa Romeo"),
        ("ZFF", "Ferrari"), ("SAL", "Land Rover"), ("SAJ", "Jaguar"), ("YV1", "Volvo"), ("JTD", "Toyota"),
        ("JT2", "Toyota"), ("SB1", "Toyota"), ("VNK", "Toyota"), ("JHM", "Honda"), ("JN1", "Nissan"), ("SJN", "Nissan"),
        ("JMZ", "Mazda"), ("KMH", "Hyundai"), ("TMA", "Hyundai"), ("KNA", "Kia"), ("U5Y", "Kia"), ("WF0", "Ford"),
        ("1FA", "Ford"), ("1G1", "Chevrolet"), ("5YJ", "Tesla"), ("XP7", "Tesla"), ("7SA", "Tesla"), ("LRW", "Tesla"),
        ("JS2", "Suzuki"), ("TSM", "Suzuki"), ("JMB", "Mitsubishi"), ("SJA", "Bentley"),
        ("LSJ", "MG"), ("SDP", "MG"), ("LGX", "BYD"), ("LC0", "BYD"), ("YS2", "Scania"), ("YV2", "Volvo Trucks"),
        ("XLR", "DAF"), ("WMA", "MAN"), ("ZCF", "Iveco"), ("WDF", "Mercedes-Benz Utilitaires"), ("W1V", "Mercedes-Benz Utilitaires"),
        ("ZDM", "Ducati"), ("VBK", "KTM"), ("SMT", "Triumph"), ("JYA", "Yamaha"), ("JH2", "Honda Moto"), ("JKA", "Kawasaki"),
        ("WB1", "BMW Motorrad"), ("ZAP", "Piaggio"), ("538", "Zero Motorcycles"), ("WMZ", "Mini"), ("VSE", "Cupra / Seat"),
        ("LVS", "Ford (Chine)"), ("LFV", "Volkswagen (Chine)"),
    ];
    TABLE.iter().find(|(p, _)| wmi.starts_with(p)).map(|(_, m)| *m)
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
}
