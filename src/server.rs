//! HTTP layer: Axum router and request handlers.
//!
//! All static assets are embedded in the binary via [`include_str!`] so the
//! deployable artifact is a single executable. There are two API endpoints:
//!
//! - `POST /parse`  — `{ payload }`        → `{ tlvs, summary, crc_* }`
//! - `POST /modify` — `{ payload, set, remove, auto_dynamic }` → `{ payload, parsed }`
//!
//! Plus `GET /parse` for quick command-line testing via a query parameter.

use axum::{
    Json, Router,
    extract::Query,
    http::{StatusCode, header},
    response::{Html, IntoResponse},
    routing::{get, post},
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::parser;



pub fn router() -> Router {
    Router::new()
        // Static assets — all embedded at compile time.
        .route("/", get(index))
        .route("/style.css", get(style_css))
        .route("/app.js", get(app_js))
        .route("/qrcode.min.js", get(qrcode_js))
        .route("/jsqr.min.js", get(jsqr_js))
        // Health + API.
        .route("/health", get(health))
        .route("/parse", post(parse_post).get(parse_get))
        .route("/modify", post(modify_post))
}

// ---------------------------------------------------------------------------
// Embedded static assets
// ---------------------------------------------------------------------------

const INDEX_HTML: &str = include_str!("../static/index.html");
const STYLE_CSS: &str = include_str!("../static/style.css");
const APP_JS: &str = include_str!("../static/app.js");
const QRCODE_JS: &str = include_str!("../static/qrcode.min.js");
const JSQR_JS: &str = include_str!("../static/jsqr.min.js");

// HTML changes often during development; cache shortly. Library bundles are
// vendored and never change, so they get an immutable cache header.
const CACHE_SHORT: &str = "public, max-age=300";
const CACHE_IMMUTABLE: &str = "public, max-age=31536000, immutable";
const JS_TYPE: &str = "application/javascript; charset=utf-8";
const CSS_TYPE: &str = "text/css; charset=utf-8";

async fn index() -> impl IntoResponse {
    ([(header::CACHE_CONTROL, CACHE_SHORT)], Html(INDEX_HTML))
}

async fn style_css() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, CSS_TYPE),
            (header::CACHE_CONTROL, CACHE_SHORT),
        ],
        STYLE_CSS,
    )
}

async fn app_js() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, JS_TYPE),
            (header::CACHE_CONTROL, CACHE_SHORT),
        ],
        APP_JS,
    )
}

async fn qrcode_js() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, JS_TYPE),
            (header::CACHE_CONTROL, CACHE_IMMUTABLE),
        ],
        QRCODE_JS,
    )
}

async fn jsqr_js() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, JS_TYPE),
            (header::CACHE_CONTROL, CACHE_IMMUTABLE),
        ],
        JSQR_JS,
    )
}

async fn health() -> &'static str {
    "ok"
}

// ---------------------------------------------------------------------------
// API: /parse
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ParseBody {
    payload: String,
}

async fn parse_post(Json(body): Json<ParseBody>) -> impl IntoResponse {
    handle_parse(&body.payload)
}

async fn parse_get(Query(q): Query<HashMap<String, String>>) -> impl IntoResponse {
    match q.get("payload") {
        Some(p) => handle_parse(p),
        None => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "missing query param `payload`"})),
        ),
    }
}

fn handle_parse(payload: &str) -> (StatusCode, Json<serde_json::Value>) {
    match parser::parse(payload) {
        Ok(r) => (StatusCode::OK, Json(serde_json::to_value(r).unwrap())),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}

// ---------------------------------------------------------------------------
// API: /modify
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ModifyBody {
    payload: String,
    #[serde(default)]
    set: HashMap<String, String>,
    #[serde(default)]
    remove: Vec<String>,
    #[serde(default = "default_true")]
    auto_dynamic: bool,
}

fn default_true() -> bool {
    true
}

async fn modify_post(Json(body): Json<ModifyBody>) -> (StatusCode, Json<serde_json::Value>) {
    let set: Vec<(String, String)> = body.set.into_iter().collect();
    let opts = parser::ModifyOptions {
        set: &set,
        remove: &body.remove,
        auto_dynamic: body.auto_dynamic,
    };
    match parser::modify(&body.payload, opts) {
        Ok(new_payload) => {
            let parsed = parser::parse(&new_payload).ok();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "payload": new_payload,
                    "parsed": parsed,
                })),
            )
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        ),
    }
}
