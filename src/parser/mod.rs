//! QRIS / EMVCo MPM parser.
//!
//! This module is the public face of the parser. Internals are split by
//! concern; consumers only need the re-exports below.
//!
//! ```no_run
//! use qris_parser::parser;
//!
//! let result = parser::parse("00020101...").unwrap();
//! assert!(result.crc_valid);
//!
//! let modified = parser::modify(
//!     &result.raw,
//!     parser::ModifyOptions {
//!         set: &[("amount".into(), "50000".into())],
//!         remove: &[],
//!         auto_dynamic: true,
//!     },
//! ).unwrap();
//! ```

mod crc;
mod modify;
mod parse;
mod tags;
mod tlv;

pub use modify::{modify, ModifyError, ModifyOptions};
pub use parse::{parse, ParseError, ParseResult};
pub use tlv::Tlv;

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "00020101021126740025ID.CO.BANKNEOCOMMERCE.WWW011893600490594035176202120005601164090303UMI51550025ID.CO.BANKNEOCOMMERCE.WWW0215ID10243177317000303UMI5204581253033605502015802ID5917COFFEE SHOP HOUSE6006BLITAR6105661526233052230017677787106486558720703T0163041088";

    #[test]
    fn parses_sample() {
        let r = parse(SAMPLE).expect("parse ok");
        assert_eq!(r.summary.get("merchant_name").unwrap(), "COFFEE SHOP HOUSE");
        assert_eq!(r.summary.get("merchant_city").unwrap(), "BLITAR");
        assert_eq!(r.summary.get("country").unwrap(), "ID");
        assert_eq!(r.summary.get("currency").unwrap(), "IDR");
    }

    #[test]
    fn crc_matches() {
        let r = parse(SAMPLE).expect("parse ok");
        assert!(r.crc_valid, "expected {} got {}", r.crc_expected, r.crc_actual);
    }

    #[test]
    fn modify_inject_amount_auto_dynamic() {
        let new_payload = modify(
            SAMPLE,
            ModifyOptions {
                set: &[("amount".into(), "50000".into())],
                remove: &[],
                auto_dynamic: true,
            },
        )
        .expect("modify ok");

        let r = parse(&new_payload).expect("re-parse ok");
        assert!(r.crc_valid, "CRC must validate after modification");
        assert_eq!(r.summary.get("amount").unwrap(), "50000");
        assert_eq!(r.summary.get("initiation_method").unwrap(), "dynamic");
    }

    #[test]
    fn modify_change_merchant() {
        let new_payload = modify(
            SAMPLE,
            ModifyOptions {
                set: &[
                    ("merchant_name".into(), "WARUNG BARU".into()),
                    ("merchant_city".into(), "JAKARTA".into()),
                ],
                remove: &[],
                auto_dynamic: false,
            },
        )
        .expect("modify ok");

        let r = parse(&new_payload).expect("re-parse ok");
        assert!(r.crc_valid);
        assert_eq!(r.summary.get("merchant_name").unwrap(), "WARUNG BARU");
        assert_eq!(r.summary.get("merchant_city").unwrap(), "JAKARTA");
    }

    #[test]
    fn modify_remove_field() {
        let new_payload = modify(
            SAMPLE,
            ModifyOptions {
                set: &[],
                remove: &["55".into()],
                auto_dynamic: false,
            },
        )
        .expect("modify ok");

        let r = parse(&new_payload).expect("re-parse ok");
        assert!(r.crc_valid);
        assert!(r.tlvs.iter().all(|t| t.tag != "55"));
    }
}
