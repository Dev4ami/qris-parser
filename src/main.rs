//! Binary entry point — wires up the router and binds the listener.
//!
//! Address can be overridden via the `BIND` environment variable
//! (e.g. `BIND=127.0.0.1:9090 cargo run --release`). If `BIND` is unset but
//! `PORT` is (the convention used by Coolify / Nixpacks / most PaaS), bind
//! `0.0.0.0:$PORT`. Otherwise default to `0.0.0.0:8080` so the server is
//! reachable from a phone on the same Wi-Fi network during development.

use qris_parser::server;

#[tokio::main]
async fn main() {
    let addr = std::env::var("BIND").unwrap_or_else(|_| {
        let port = std::env::var("PORT").unwrap_or_else(|_| "8080".into());
        format!("0.0.0.0:{port}")
    });
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("qris-parser listening on http://{addr}");
    axum::serve(listener, server::router()).await.unwrap();
}
