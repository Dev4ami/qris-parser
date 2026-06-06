# qris-parser

Parse, verify, and edit QRIS (Indonesian QR Code Payment) strings — backend in
Rust + Axum, frontend in vanilla HTML/CSS/JS. Single-binary deploy: all assets
are embedded at compile time.

QRIS follows the [EMVCo MPM](https://www.emvco.com/specifications/) (Merchant
Presented Mode) specification, with [Bank Indonesia](https://www.bi.go.id/QRIS/)
overlays. Payloads are TLV (tag-length-value) encoded ASCII strings ending in a
CRC16-CCITT checksum.

## Features

- **Parse** any EMVCo MPM payload into a TLV tree + a friendly summary, with
  CRC verification.
- **Edit** the safe-to-change fields (amount, merchant name/city, MCC,
  currency, country, postal code, tip indicator) and re-emit a valid QRIS with
  a freshly-computed CRC.
- **Soft validations**:
  - country/currency pair sanity (e.g. ID + USD → flag),
  - bill-payment detection (tag 62.01 / 62.02) warning that the amount is
    bound to a backend record,
  - read-only display of acquirer info (tags 26–51) with an explanation of why
    those fields cannot be edited safely.
- **Image input**: paste, drag-and-drop, or take a photo of a QR — decoded
  client-side via [jsQR](https://github.com/cozmo/jsQR).
- **QR preview** of the modified payload, generated client-side via
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).

## Running

Requires Rust 1.74+ (Axum 0.7 MSRV).

```sh
cargo run --release
# qris-parser listening on http://0.0.0.0:3000
```

Override the bind address:

```sh
BIND=127.0.0.1:8080 cargo run --release
```

Tests:

```sh
cargo test --lib
```

## HTTP API

### `POST /parse`

```json
{ "payload": "00020101021126..." }
```

Returns the decoded TLV tree, a flat summary of common fields, and the CRC
check result:

```json
{
  "raw": "00020101...",
  "crc_valid": true,
  "crc_expected": "1088",
  "crc_actual": "1088",
  "summary": {
    "amount": "10000",
    "country": "ID",
    "currency": "IDR",
    "merchant_city": "BLITAR",
    "merchant_name": "COFFEE SHOP HOUSE",
    "initiation_method": "dynamic"
  },
  "tlvs": [ { "tag": "00", "name": "Payload Format Indicator", ... }, ... ]
}
```

`GET /parse?payload=...` is provided for quick command-line use; the POST body
form is preferred everywhere else.

### `POST /modify`

```json
{
  "payload": "00020101...",
  "set":    { "amount": "50000", "merchant_city": "JAKARTA" },
  "remove": ["55"],
  "auto_dynamic": true
}
```

- `set` — map of `{ alias_or_tag: value }`. Aliases: `amount`,
  `merchant_name`, `merchant_city`, `postal_code`, `currency`, `country`,
  `mcc`, `initiation_method`, `tip_indicator`, `fee_fixed`, `fee_percent`.
  Two-digit tags (e.g. `"54"`) are also accepted.
- `remove` — list of aliases or tags to drop.
- `auto_dynamic` (default `true`) — if `set` includes an amount and the
  payload is currently static (`01=11`), flip it to dynamic (`01=12`). Static
  QRIS is not supposed to carry a transaction amount.

Returns the re-encoded payload and a fresh parse of it:

```json
{
  "payload": "00020101...6304XXXX",
  "parsed":  { ... same shape as /parse ... }
}
```

### `GET /health`

Returns `"ok"`. Useful for uptime checks.

## What's NOT editable, and why

The acquirer template tags (26–51) carry the **GUID** (acquirer domain), the
**PAN** (merchant's account at that acquirer), and the **NMID** (National
Merchant ID issued by Bank Indonesia / ASPI). These identify *who gets paid*.
Editing them through this tool would either:

- route a payment to a different (or non-existent) merchant,
- forge an NMID that the switching network does not recognise.

In both cases the transaction will be rejected at the acquirer or the national
switch. The tool surfaces these fields read-only for transparency, but
deliberately does not expose them in the modify endpoint.

Similarly, when the QR is a **bill payment** (a `62.01 Bill Number` or
`62.02 Mobile Number` sub-tag is present), the amount is bound to a record on
the acquirer's backend. Editing the amount produces a structurally-valid QR
that will be rejected with `Amount Mismatch` / `Bill Not Found`.

## Architecture

```
qris-parser/
├── src/
│   ├── lib.rs                # public surface: parser + server
│   ├── main.rs               # binary: bind + serve
│   ├── server.rs             # Axum router, handlers, embedded assets
│   └── parser/
│       ├── mod.rs            # public API: parse, modify, Tlv, errors
│       ├── crc.rs            # CRC16-CCITT (FALSE)
│       ├── tags.rs           # tag metadata + alias resolution
│       ├── tlv.rs            # decode / encode primitives
│       ├── parse.rs          # high-level parse + summary
│       └── modify.rs         # set/remove + recompute CRC
└── static/                   # embedded via include_str! at build time
    ├── index.html
    ├── style.css
    ├── app.js                # frontend application
    ├── qrcode.min.js         # vendored — qrcode-generator
    └── jsqr.min.js           # vendored — jsQR
```

### Parser pipeline

```
                     ┌──────────────┐
   payload (str)  ──▶│ decode (TLV) │──▶ Vec<Tlv>
                     └──────────────┘            │
                                                 ▼
                                          ┌─────────────┐
                                          │ verify CRC  │
                                          │  + summary  │
                                          └─────────────┘
                                                 │
                                                 ▼
                                          ParseResult
```

Modify is a TLV round-trip with surgical edits and a CRC recompute:

```
parse → strip CRC → set/remove → sort by tag → reserialise + "6304" + CRC16
```

### Frontend flow

```
[paste / drop image / camera]
     │
     ▼
(image)  ──jsQR──▶  QR string ──┐
(text)   ──────────────────────▶│
                                ▼
                          POST /parse  ──▶  TLV tree
                                                │
                                                ▼
                          edit fields ──▶  POST /modify  ──▶  new payload
                                                                  │
                                                                  ▼
                                                       qrcode-generator → <canvas>
```

The QR generator and image decoder bundles are lazy-loaded on first use to
keep initial page weight light.

## Development notes

- **Why a single binary** — the entire app (UI + libraries + handlers)
  compiles into one executable. Deployment is `scp` the binary, optionally
  fronted by a reverse proxy.
- **Why no JS framework** — the UI is small enough that a framework would be
  more code than the app itself. Vanilla DOM keeps refresh cost low and the
  source readable end-to-end.
- **Caching** — `index.html`, `style.css`, and `app.js` use a short
  `max-age=300` so changes propagate quickly; the vendored libraries are
  `max-age=1y, immutable`.
- **Termux on Android** — if the dev server feels frozen after switching
  apps, Android's Doze mode is suspending Termux. Run `termux-wake-lock`
  (from the `termux-api` package) before `cargo run`.

## License

Personal project. Vendored libraries retain their own licenses (jsQR — Apache
2.0; qrcode-generator — MIT).
