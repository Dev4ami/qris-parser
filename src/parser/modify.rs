//! Edit a QRIS payload: set or remove top-level tags, then re-encode and
//! recompute the CRC. Sub-fields inside acquirer templates (tags 26–51) are
//! intentionally NOT editable through this path — overriding them would break
//! payment routing.

use super::crc::crc16_ccitt;
use super::tags::alias_to_tag;
use super::tlv::{decode, encode, DecodeError, EncodeError};

pub struct ModifyOptions<'a> {
    pub set: &'a [(String, String)],
    pub remove: &'a [String],
    /// If true and an amount is set, automatically flip a static QR
    /// (`01=11`) to dynamic (`01=12`). Static QRs are not supposed to carry
    /// a transaction amount.
    pub auto_dynamic: bool,
}

#[derive(Debug)]
pub enum ModifyError {
    Decode(DecodeError),
    Encode(EncodeError),
    UnknownKey(String),
}

impl std::fmt::Display for ModifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModifyError::Decode(e) => write!(f, "decode error: {e}"),
            ModifyError::Encode(e) => write!(f, "{e}"),
            ModifyError::UnknownKey(k) => {
                write!(f, "unknown key `{k}` — use a 2-digit tag or known alias")
            }
        }
    }
}

impl From<DecodeError> for ModifyError {
    fn from(e: DecodeError) -> Self {
        ModifyError::Decode(e)
    }
}

impl From<EncodeError> for ModifyError {
    fn from(e: EncodeError) -> Self {
        ModifyError::Encode(e)
    }
}

pub fn modify(payload: &str, opts: ModifyOptions<'_>) -> Result<String, ModifyError> {
    // Strip CRC — we'll rebuild it at the end.
    let mut fields: Vec<(String, String)> = decode(payload, None)?
        .into_iter()
        .filter(|t| t.tag != "63")
        .map(|t| (t.tag, t.value))
        .collect();

    let set_resolved = resolve_pairs(opts.set)?;
    let remove_resolved = resolve_keys(opts.remove)?;

    fields.retain(|(t, _)| !remove_resolved.contains(t));

    let mut amount_set = false;
    for (tag, val) in &set_resolved {
        if tag == "54" {
            amount_set = true;
        }
        match fields.iter_mut().find(|(t, _)| t == tag) {
            Some(existing) => existing.1 = val.clone(),
            None => fields.push((tag.clone(), val.clone())),
        }
    }

    if opts.auto_dynamic && amount_set {
        if let Some(init) = fields.iter_mut().find(|(t, _)| t == "01") {
            if init.1 == "11" {
                init.1 = "12".into();
            }
        }
    }

    // EMVCo TLV elements are ordered by tag.
    fields.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out = String::new();
    for (tag, val) in &fields {
        out.push_str(&encode(tag, val)?);
    }
    out.push_str("6304");
    out.push_str(&format!("{:04X}", crc16_ccitt(out.as_bytes())));
    Ok(out)
}

fn resolve_pairs(set: &[(String, String)]) -> Result<Vec<(String, String)>, ModifyError> {
    set.iter()
        .map(|(k, v)| resolve_key(k).map(|t| (t, v.clone())))
        .collect()
}

fn resolve_keys(remove: &[String]) -> Result<Vec<String>, ModifyError> {
    remove.iter().map(|k| resolve_key(k)).collect()
}

fn resolve_key(k: &str) -> Result<String, ModifyError> {
    if k.len() == 2 && k.chars().all(|c| c.is_ascii_digit()) {
        return Ok(k.to_string());
    }
    alias_to_tag(k)
        .map(str::to_string)
        .ok_or_else(|| ModifyError::UnknownKey(k.to_string()))
}
