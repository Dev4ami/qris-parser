//! Binary entry point — wires up the router and binds the listener.
//!
//! Address can be overridden via the `BIND` environment variable
//! (e.g. `BIND=127.0.0.1:8080 cargo run --release`). Defaults to
//! `0.0.0.0:3000` so the server is reachable from a phone on the same
//! Wi-Fi network during development.

use qris_parser::server;

#[tokio::main]
async fn main() {
    let addr = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0:3000".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("qris-parser listening on http://{addr}");
    axum::serve(listener, server::router()).await.unwrap();
}
