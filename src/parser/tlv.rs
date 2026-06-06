//! TLV (Tag-Length-Value) primitives.
//!
//! Each element is encoded as `TT LL VVVV...`:
//! - `TT` — 2 ASCII digits, the tag
//! - `LL` — 2 ASCII digits, the value length (00..=99)
//! - `VVVV...` — exactly `LL` ASCII bytes
//!
//! Template tags (see [`super::tags::is_template`]) carry a nested TLV
//! sequence in their value, which this module decodes recursively.

use serde::Serialize;

use super::tags::{is_template, sub_tag_name, tag_name};

#[derive(Debug, Serialize)]
pub struct Tlv {
    pub tag: String,
    pub name: String,
    pub length: usize,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Tlv>>,
}

#[derive(Debug)]
pub enum DecodeError {
    Truncated { at: usize },
    InvalidLength { at: usize },
    NonAscii,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::Truncated { at } => write!(f, "payload truncated at offset {at}"),
            DecodeError::InvalidLength { at } => write!(f, "invalid length field at offset {at}"),
            DecodeError::NonAscii => write!(f, "payload contains non-ASCII bytes"),
        }
    }
}

/// Decode a TLV sequence. Pass `parent = None` at the top level; recursive
/// calls supply the parent tag so sub-tag names can be resolved.
pub fn decode(s: &str, parent: Option<&str>) -> Result<Vec<Tlv>, DecodeError> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if i + 4 > bytes.len() {
            return Err(DecodeError::Truncated { at: i });
        }
        let tag = std::str::from_utf8(&bytes[i..i + 2])
            .map_err(|_| DecodeError::NonAscii)?
            .to_string();
        let len_str =
            std::str::from_utf8(&bytes[i + 2..i + 4]).map_err(|_| DecodeError::NonAscii)?;
        let length: usize = len_str
            .parse()
            .map_err(|_| DecodeError::InvalidLength { at: i + 2 })?;
        let val_start = i + 4;
        let val_end = val_start + length;
        if val_end > bytes.len() {
            return Err(DecodeError::Truncated { at: val_start });
        }
        let value =
            std::str::from_utf8(&bytes[val_start..val_end]).map_err(|_| DecodeError::NonAscii)?;

        let name = match parent {
            Some(p) => sub_tag_name(p, &tag),
            None => tag_name(&tag),
        }
        .to_string();

        // Only recurse one level: nested templates inside templates are not
        // part of the QRIS profile.
        let children = if is_template(&tag) && parent.is_none() {
            decode(value, Some(&tag)).ok()
        } else {
            None
        };

        out.push(Tlv {
            tag,
            name,
            length,
            value: value.to_string(),
            children,
        });
        i = val_end;
    }
    Ok(out)
}

#[derive(Debug)]
pub enum EncodeError {
    BadTag(String),
    NonAsciiValue(String),
    ValueTooLong { tag: String, len: usize },
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncodeError::BadTag(t) => write!(f, "bad tag `{t}` — must be 2 digits"),
            EncodeError::NonAsciiValue(t) => write!(f, "value for tag {t} contains non-ASCII"),
            EncodeError::ValueTooLong { tag, len } => {
                write!(f, "value for tag {tag} is {len} chars (max 99)")
            }
        }
    }
}

/// Encode a single TLV element.
pub fn encode(tag: &str, value: &str) -> Result<String, EncodeError> {
    if tag.len() != 2 || !tag.chars().all(|c| c.is_ascii_digit()) {
        return Err(EncodeError::BadTag(tag.to_string()));
    }
    if !value.is_ascii() {
        return Err(EncodeError::NonAsciiValue(tag.to_string()));
    }
    let len = value.len();
    if len > 99 {
        return Err(EncodeError::ValueTooLong {
            tag: tag.to_string(),
            len,
        });
    }
    Ok(format!("{tag}{len:02}{value}"))
}
