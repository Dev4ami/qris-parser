//! High-level parse: decode the full payload, verify CRC, and build a
//! friendly summary keyed by canonical field names.

use serde::Serialize;
use std::collections::BTreeMap;

use super::crc::crc16_ccitt;
use super::tlv::{decode, DecodeError, Tlv};

#[derive(Debug, Serialize)]
pub struct ParseResult {
    pub raw: String,
    pub crc_valid: bool,
    pub crc_expected: String,
    pub crc_actual: String,
    pub summary: BTreeMap<String, String>,
    pub tlvs: Vec<Tlv>,
}

#[derive(Debug)]
pub enum ParseError {
    Empty,
    NonAscii,
    Decode(DecodeError),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::Empty => write!(f, "payload is empty"),
            ParseError::NonAscii => write!(f, "payload contains non-ASCII bytes"),
            ParseError::Decode(e) => write!(f, "{e}"),
        }
    }
}

impl From<DecodeError> for ParseError {
    fn from(e: DecodeError) -> Self {
        ParseError::Decode(e)
    }
}

pub fn parse(payload: &str) -> Result<ParseResult, ParseError> {
    if payload.is_empty() {
        return Err(ParseError::Empty);
    }
    if !payload.is_ascii() {
        return Err(ParseError::NonAscii);
    }

    let tlvs = decode(payload, None)?;

    let (crc_valid, crc_expected, crc_actual) = verify_crc(payload, &tlvs)?;
    let summary = build_summary(&tlvs);

    Ok(ParseResult {
        raw: payload.to_string(),
        crc_valid,
        crc_expected,
        crc_actual,
        summary,
        tlvs,
    })
}

fn verify_crc(payload: &str, tlvs: &[Tlv]) -> Result<(bool, String, String), ParseError> {
    let Some(field) = tlvs.iter().find(|t| t.tag == "63") else {
        return Ok((false, String::new(), String::new()));
    };
    // CRC field is always the last element. Hash everything up to and
    // including the "6304" tag+length prefix.
    let idx = payload
        .rfind("6304")
        .ok_or(ParseError::Decode(DecodeError::Truncated { at: 0 }))?;
    let payload_for_crc = &payload[..idx + 4];
    let computed = format!("{:04X}", crc16_ccitt(payload_for_crc.as_bytes()));
    let expected = field.value.to_uppercase();
    Ok((computed == expected, expected, computed))
}

/// Reduce a TLV tree to a flat key/value summary of common fields.
///
/// Values are also lightly humanised (e.g. currency "360" → "IDR",
/// init method "11" → "static") because the summary is intended for
/// quick display, not byte-level work — the raw TLVs remain available
/// in [`ParseResult::tlvs`].
fn build_summary(tlvs: &[Tlv]) -> BTreeMap<String, String> {
    let mut summary = BTreeMap::new();
    for t in tlvs {
        match t.tag.as_str() {
            "00" => {
                summary.insert("payload_format".into(), t.value.clone());
            }
            "01" => {
                let kind = match t.value.as_str() {
                    "11" => "static",
                    "12" => "dynamic",
                    _ => "unknown",
                };
                summary.insert("initiation_method".into(), kind.into());
            }
            "52" => {
                summary.insert("merchant_category_code".into(), t.value.clone());
            }
            "53" => {
                let cur = if t.value == "360" { "IDR" } else { &t.value };
                summary.insert("currency".into(), cur.into());
            }
            "54" => {
                summary.insert("amount".into(), t.value.clone());
            }
            "58" => {
                summary.insert("country".into(), t.value.clone());
            }
            "59" => {
                summary.insert("merchant_name".into(), t.value.clone());
            }
            "60" => {
                summary.insert("merchant_city".into(), t.value.clone());
            }
            "61" => {
                summary.insert("postal_code".into(), t.value.clone());
            }
            _ => {}
        }
    }
    summary
}
