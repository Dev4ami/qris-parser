//! Tag metadata for EMVCo MPM / QRIS.
//!
//! Every TLV element in a QRIS payload is identified by a 2-digit tag. This
//! module knows the human-readable name of each tag (top-level and within
//! known templates) and the aliases the API accepts for the editable subset.

/// Human-readable name for a top-level QRIS tag.
pub fn tag_name(tag: &str) -> &'static str {
    let n: u32 = match tag.parse() {
        Ok(v) => v,
        Err(_) => return "Unknown",
    };
    match n {
        0 => "Payload Format Indicator",
        1 => "Point of Initiation Method",
        2..=51 => "Merchant Account Information",
        52 => "Merchant Category Code",
        53 => "Transaction Currency",
        54 => "Transaction Amount",
        55 => "Tip or Convenience Indicator",
        56 => "Convenience Fee Fixed",
        57 => "Convenience Fee Percentage",
        58 => "Country Code",
        59 => "Merchant Name",
        60 => "Merchant City",
        61 => "Postal Code",
        62 => "Additional Data Field Template",
        63 => "CRC",
        64 => "Merchant Information Language Template",
        65..=79 => "RFU for EMVCo",
        80..=99 => "Unreserved Templates",
        _ => "Unknown",
    }
}

/// Human-readable name for a sub-tag inside a known template.
pub fn sub_tag_name(parent: &str, tag: &str) -> &'static str {
    match (parent, tag) {
        (p, "00") if is_merchant_account(p) => "Globally Unique Identifier",
        (p, t) if is_merchant_account(p) && matches!(t, "01" | "02" | "03" | "04" | "05") => {
            "Payment Network Specific"
        }
        ("62", "01") => "Bill Number",
        ("62", "02") => "Mobile Number",
        ("62", "03") => "Store Label",
        ("62", "04") => "Loyalty Number",
        ("62", "05") => "Reference Label",
        ("62", "06") => "Customer Label",
        ("62", "07") => "Terminal Label",
        ("62", "08") => "Purpose of Transaction",
        ("62", "09") => "Additional Consumer Data Request",
        ("64", "00") => "Language Preference",
        ("64", "01") => "Merchant Name — Alternate Language",
        ("64", "02") => "Merchant City — Alternate Language",
        _ => "Sub Field",
    }
}

/// Tags 02–51 are the Merchant Account Information templates. Each one carries
/// nested TLVs (GUID, PAN, NMID, criteria) for a single acquirer.
pub fn is_merchant_account(tag: &str) -> bool {
    if let Ok(n) = tag.parse::<u32>() {
        (2..=51).contains(&n)
    } else {
        false
    }
}

/// A "template" is a tag whose value is itself a TLV sequence and should be
/// parsed recursively. Top-level templates in QRIS: 02–51, 62, 64, 80–99.
pub fn is_template(tag: &str) -> bool {
    if is_merchant_account(tag) {
        return true;
    }
    if let Ok(n) = tag.parse::<u32>() {
        n == 62 || n == 64 || (80..=99).contains(&n)
    } else {
        false
    }
}

/// Map a friendly alias (used by the HTTP API) to its 2-digit tag.
///
/// The set is intentionally narrow — only fields a merchant might legitimately
/// edit. Routing-critical fields (GUID/PAN/NMID inside acquirer templates) are
/// deliberately not editable through aliases.
pub fn alias_to_tag(name: &str) -> Option<&'static str> {
    match name {
        "amount" | "transaction_amount" => Some("54"),
        "merchant_name" => Some("59"),
        "merchant_city" => Some("60"),
        "postal_code" => Some("61"),
        "currency" => Some("53"),
        "country" => Some("58"),
        "merchant_category_code" | "mcc" => Some("52"),
        "initiation_method" => Some("01"),
        "tip_indicator" => Some("55"),
        "fee_fixed" => Some("56"),
        "fee_percent" => Some("57"),
        _ => None,
    }
}
