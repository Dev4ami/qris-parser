//! CRC16-CCITT (FALSE) checksum used by EMVCo MPM (and therefore QRIS).
//!
//! - Polynomial: 0x1021
//! - Initial value: 0xFFFF
//! - No reflection, no final XOR
//!
//! Input is the entire payload *up to and including* the literal bytes `6304`
//! (i.e. the tag+length of the CRC field itself); the 4-hex CRC value follows.

pub fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            if crc & 0x8000 != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector() {
        // EMVCo test vector: CRC of the literal string "123456789" with this
        // configuration is 0x29B1.
        assert_eq!(crc16_ccitt(b"123456789"), 0x29B1);
    }
}
