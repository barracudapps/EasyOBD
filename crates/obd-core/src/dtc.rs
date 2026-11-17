//! Diagnostic Trouble Codes (SAE J2012 / ISO 15031-6).

use serde::{Deserialize, Serialize};

/// Which OBD-II service the code came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DtcKind {
    /// Service 03 – confirmed, usually lights the MIL ("check engine").
    Stored,
    /// Service 07 – detected during the current / last drive cycle, not confirmed yet.
    Pending,
    /// Service 0A – cannot be erased by a scan tool, clears itself once the monitor passes.
    Permanent,
}

impl DtcKind {
    pub const ALL: [DtcKind; 3] = [DtcKind::Stored, DtcKind::Pending, DtcKind::Permanent];

    pub fn request(self) -> &'static str {
        match self {
            DtcKind::Stored => "03",
            DtcKind::Pending => "07",
            DtcKind::Permanent => "0A",
        }
    }

    pub fn response_byte(self) -> u8 {
        match self {
            DtcKind::Stored => 0x43,
            DtcKind::Pending => 0x47,
            DtcKind::Permanent => 0x4A,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Dtc {
    pub code: String,
    pub kind: DtcKind,
}

/// Decodes the two raw bytes of a DTC into its 5-character form (e.g. `0x01 0x33` → `P0133`).
pub fn decode(a: u8, b: u8) -> String {
    let system = ['P', 'C', 'B', 'U'][(a >> 6) as usize];
    format!("{system}{}{:X}{:02X}", (a >> 4) & 0x03, a & 0x0F, b)
}

/// Normalizes user input ("p0301 ", "P 0301") and checks it looks like a DTC.
pub fn normalize(code: &str) -> Option<String> {
    let c: String = code.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_uppercase();
    let mut chars = c.chars();
    let ok = c.len() == 5
        && matches!(chars.next(), Some('P' | 'C' | 'B' | 'U'))
        && matches!(chars.next(), Some('0'..='3'))
        && chars.all(|ch| ch.is_ascii_hexdigit());
    ok.then_some(c)
}

/// Extracts DTCs from assembled OBD messages (see [`crate::elm327::assemble_messages`]).
///
/// * CAN (ISO 15765): `43 <count> AA BB AA BB ...`
/// * Legacy (ISO 9141 / KWP / J1850): `43 AA BB AA BB AA BB` (three slots, zero padded)
///
/// When the protocol is unknown, CAN is assumed for even-length messages (1 + 1 + 2n bytes)
/// and legacy for odd lengths (1 + 2n bytes).
pub fn parse_messages(messages: &[Vec<u8>], kind: DtcKind, is_can: Option<bool>) -> Vec<Dtc> {
    let mut out: Vec<Dtc> = Vec::new();
    for msg in messages {
        if msg.first() != Some(&kind.response_byte()) {
            continue;
        }
        let can = is_can.unwrap_or(msg.len() % 2 == 0);
        let (payload, max) = if can && msg.len() >= 2 {
            (&msg[2..], msg[1] as usize)
        } else {
            (&msg[1..], usize::MAX)
        };
        for pair in payload.chunks_exact(2).take(max) {
            if pair[0] == 0 && pair[1] == 0 {
                continue;
            }
            let dtc = Dtc { code: decode(pair[0], pair[1]), kind };
            if !out.contains(&dtc) {
                out.push(dtc);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_all_systems() {
        assert_eq!(decode(0x01, 0x33), "P0133");
        assert_eq!(decode(0x03, 0x01), "P0301");
        assert_eq!(decode(0x04, 0x20), "P0420");
        assert_eq!(decode(0x41, 0x23), "C0123");
        assert_eq!(decode(0x92, 0x34), "B1234");
        assert_eq!(decode(0xC1, 0x00), "U0100");
        assert_eq!(decode(0x2A, 0x00), "P2A00");
    }

    #[test]
    fn normalizes_input() {
        assert_eq!(normalize(" p0301"), Some("P0301".into()));
        assert_eq!(normalize("P 04 20"), Some("P0420".into()));
        assert_eq!(normalize("X0420"), None);
        assert_eq!(normalize("P042"), None);
        assert_eq!(normalize("P4420"), None);
    }

    #[test]
    fn parses_can_and_legacy() {
        let can = vec![vec![0x43, 0x02, 0x01, 0x33, 0x03, 0x01]];
        let codes: Vec<_> = parse_messages(&can, DtcKind::Stored, Some(true)).into_iter().map(|d| d.code).collect();
        assert_eq!(codes, ["P0133", "P0301"]);

        let legacy = vec![vec![0x43, 0x04, 0x20, 0x00, 0x00, 0x00, 0x00]];
        let codes: Vec<_> = parse_messages(&legacy, DtcKind::Stored, None).into_iter().map(|d| d.code).collect();
        assert_eq!(codes, ["P0420"]);

        // no codes
        assert!(parse_messages(&[vec![0x43, 0x00]], DtcKind::Stored, Some(true)).is_empty());
        // wrong service ignored
        assert!(parse_messages(&can, DtcKind::Pending, Some(true)).is_empty());
    }
}
