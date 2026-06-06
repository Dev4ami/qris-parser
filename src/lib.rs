//! QRIS / EMVCo MPM parser library.
//!
//! Two surfaces are exposed:
//! - [`parser`] — pure-functional parse, modify, and verify of QRIS payloads.
//!   Suitable for embedding in other applications.
//! - [`server`] — an Axum `Router` that wraps the parser as an HTTP API and
//!   serves the bundled web UI. The binary in `main.rs` is just a thin
//!   listener on top of this.

pub mod parser;
pub mod server;
