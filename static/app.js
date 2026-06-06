// QRIS Parser — frontend application.
//
// Single-file by intent: the codebase is small and a flat layout makes the
// flow easier to follow than splitting into ES modules. Sections are marked
// with banner comments; jump between them by searching for "// ===".
//
// Network shape:
//   POST /parse   { payload }              → { tlvs, summary, crc_* }
//   POST /modify  { payload, set, remove } → { payload, parsed }

"use strict";

// ===========================================================================
// Constants & data
// ===========================================================================

const SAMPLE = "00020101021126740025ID.CO.BANKNEOCOMMERCE.WWW011893600490594035176202120005601164090303UMI51550025ID.CO.BANKNEOCOMMERCE.WWW0215ID10243177317000303UMI5204581253033605502015802ID5917COFFEE SHOP HOUSE6006BLITAR6105661526233052230017677787106486558720703T0163041088";

// Fields the user can edit through the form. Each entry corresponds to one
// row in the editor. `tag` is the 2-digit EMVCo tag; `alias` is the friendly
// key the API accepts (see `parser::tags::alias_to_tag` on the Rust side).
const EDITABLE_FIELDS = [
  { alias: "amount",            tag: "54", label: "Amount (54)",            type: "text", placeholder: "kosongkan untuk hapus", desc: "Nominal transaksi. Kosongkan untuk QRIS tanpa nominal." },
  { alias: "merchant_name",     tag: "59", label: "Merchant Name (59)",     type: "text", desc: "Nama merchant yang muncul di aplikasi pembayaran." },
  { alias: "merchant_city",     tag: "60", label: "Merchant City (60)",     type: "text", desc: "Kota merchant." },
  { alias: "postal_code",       tag: "61", label: "Postal Code (61)",       type: "text", desc: "Kode pos merchant." },
  { alias: "mcc",               tag: "52", label: "MCC (52)",               type: "select", options: [
      { value: "4111", label: "4111", desc: "Transportasi lokal & komuter" },
      { value: "4814", label: "4814", desc: "Telco — pulsa, paket data" },
      { value: "4900", label: "4900", desc: "Utility — listrik, air, gas" },
      { value: "5311", label: "5311", desc: "Department Store" },
      { value: "5411", label: "5411", desc: "Grocery / Supermarket" },
      { value: "5499", label: "5499", desc: "Toko makanan lainnya" },
      { value: "5541", label: "5541", desc: "SPBU / Pom bensin" },
      { value: "5651", label: "5651", desc: "Pakaian umum" },
      { value: "5732", label: "5732", desc: "Toko elektronik" },
      { value: "5812", label: "5812", desc: "Restoran / Eating Places" },
      { value: "5814", label: "5814", desc: "Fast Food" },
      { value: "5912", label: "5912", desc: "Apotek" },
      { value: "5921", label: "5921", desc: "Toko minuman / Beverage" },
      { value: "5942", label: "5942", desc: "Toko buku" },
      { value: "5999", label: "5999", desc: "Retail umum lainnya" },
      { value: "7011", label: "7011", desc: "Hotel / Penginapan" },
      { value: "7211", label: "7211", desc: "Laundry" },
      { value: "7230", label: "7230", desc: "Salon / Barbershop" },
      { value: "7299", label: "7299", desc: "Jasa pribadi lainnya" },
      { value: "7372", label: "7372", desc: "Layanan komputer & software" },
      { value: "8011", label: "8011", desc: "Praktik Dokter" },
      { value: "8021", label: "8021", desc: "Praktik Dokter Gigi" },
      { value: "8062", label: "8062", desc: "Rumah Sakit" },
      { value: "8211", label: "8211", desc: "Sekolah" },
      { value: "8299", label: "8299", desc: "Pendidikan lainnya" },
      { value: "8398", label: "8398", desc: "Amal / Charity" },
  ]},
  { alias: "currency",          tag: "53", label: "Currency (53)",          type: "select", options: [
      { value: "360", label: "360 — IDR", desc: "Rupiah Indonesia" },
      { value: "840", label: "840 — USD", desc: "Dolar Amerika Serikat" },
      { value: "978", label: "978 — EUR", desc: "Euro" },
      { value: "458", label: "458 — MYR", desc: "Ringgit Malaysia" },
      { value: "702", label: "702 — SGD", desc: "Dolar Singapura" },
      { value: "764", label: "764 — THB", desc: "Baht Thailand" },
      { value: "608", label: "608 — PHP", desc: "Peso Filipina" },
      { value: "392", label: "392 — JPY", desc: "Yen Jepang" },
      { value: "156", label: "156 — CNY", desc: "Yuan Tiongkok" },
  ]},
  { alias: "country",           tag: "58", label: "Country (58)",           type: "select", options: [
      { value: "ID", label: "ID — Indonesia",  desc: "Indonesia" },
      { value: "MY", label: "MY — Malaysia",   desc: "Malaysia" },
      { value: "SG", label: "SG — Singapore",  desc: "Singapura" },
      { value: "TH", label: "TH — Thailand",   desc: "Thailand" },
      { value: "PH", label: "PH — Philippines", desc: "Filipina" },
      { value: "VN", label: "VN — Vietnam",    desc: "Vietnam" },
      { value: "JP", label: "JP — Japan",      desc: "Jepang" },
      { value: "CN", label: "CN — China",      desc: "Tiongkok" },
  ]},
  { alias: "initiation_method", tag: "01", label: "Init Method (01)",       type: "select", options: [
      { value: "11", label: "11 — Static",  desc: "QR bisa di-scan berkali-kali (reusable, biasanya tanpa nominal)" },
      { value: "12", label: "12 — Dynamic", desc: "QR sekali pakai (one-time, biasanya sudah ada nominal)" },
  ]},
  { alias: "tip_indicator",     tag: "55", label: "Tip Indicator (55)",     type: "select", options: [
      { value: "",   label: "(tidak ada)",      desc: "Tag 55 dihapus dari QRIS." },
      { value: "01", label: "01 — Tanpa tip",   desc: "Konsumen tidak diminta tip" },
      { value: "02", label: "02 — Tip diminta", desc: "Konsumen input tip sendiri saat bayar" },
      { value: "03", label: "03 — Tip fixed",   desc: "Tip nominal/persentase tetap (lihat tag 56/57)" },
  ]},
];

// Country (tag 58) → currencies (tag 53) yang lazim / didukung.
// "ID" mengikutkan koridor QRIS Antarnegara (TH/MY/SG/JP).
const COUNTRY_CURRENCY = {
  ID: ["360", "764", "458", "702", "392"],
  MY: ["458", "360"],
  SG: ["702", "360"],
  TH: ["764", "360"],
  PH: ["608"],
  VN: ["704"],
  JP: ["392", "360"],
  CN: ["156"],
  US: ["840"],
};
const CURRENCY_NAME = {
  "360": "IDR", "458": "MYR", "702": "SGD", "764": "THB",
  "608": "PHP", "704": "VND", "392": "JPY", "156": "CNY",
  "840": "USD", "978": "EUR",
};

// Sub-tags inside a Merchant Account Information template (tags 26–51).
const ACQ_SUB_LABELS = {
  "00": { k: "GUID",     hint: "domain acquirer" },
  "01": { k: "PAN",      hint: "nomor akun merchant" },
  "02": { k: "NMID",     hint: "National Merchant ID" },
  "03": { k: "Criteria", hint: "skala usaha (UMI/UKE/UBE/URE)" },
};

// ===========================================================================
// State + small DOM helpers
// ===========================================================================

let currentPayload = "";    // last successfully parsed payload
let originalValues = {};    // alias → raw value at parse time (for diffing)

const $ = (id) => document.getElementById(id);
const showError = (id, msg) => { const el = $(id); el.textContent = msg; el.classList.remove("hidden"); };
const clearError = (id) => $(id).classList.add("hidden");

// QR generator and decoder bundles are heavy and only used after a click.
// Loading them up-front would slow down first paint, so defer to demand.
const _scriptCache = new Map();
function lazyScript(src) {
  if (_scriptCache.has(src)) return _scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Gagal load ${src}`));
    document.head.appendChild(s);
  });
  _scriptCache.set(src, p);
  return p;
}

// ===========================================================================
// API calls
// ===========================================================================

async function parsePayload(payload) {
  const res = await fetch("/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "parse failed");
  return data;
}

async function modifyPayload(payload, set, remove, autoDynamic) {
  const res = await fetch("/modify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload, set, remove, auto_dynamic: autoDynamic }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "modify failed");
  return data;
}

// ===========================================================================
// Render: parsed view (summary / CRC badge / TLV tree)
// ===========================================================================

function renderSummary(target, summary) {
  target.innerHTML = "";
  for (const [k, v] of Object.entries(summary)) {
    const k1 = document.createElement("div"); k1.className = "k"; k1.textContent = k;
    const v1 = document.createElement("div"); v1.className = "v"; v1.textContent = v;
    target.appendChild(k1); target.appendChild(v1);
  }
}

function renderCrcBadge(target, valid, expected, actual) {
  target.className = "crc-badge " + (valid ? "ok" : "bad");
  target.textContent = valid ? `CRC ✓ ${expected}` : `CRC ✗ expected ${expected}, got ${actual}`;
}

function renderTlvs(target, tlvs) {
  target.innerHTML = "";
  for (const t of tlvs) target.appendChild(renderTlvNode(t));
}

function renderTlvNode(t) {
  const wrap = document.createElement("div");
  wrap.className = "tlv-item";
  const head = document.createElement("div");
  head.innerHTML = `<span class="tlv-tag">${t.tag}</span><span class="tlv-name">${t.name} · len ${t.length}</span>`;
  wrap.appendChild(head);
  if (t.children && t.children.length) {
    const c = document.createElement("div");
    c.className = "tlv-children";
    for (const ch of t.children) c.appendChild(renderTlvNode(ch));
    wrap.appendChild(c);
  } else {
    const v = document.createElement("div");
    v.className = "tlv-val";
    v.textContent = t.value;
    wrap.appendChild(v);
  }
  return wrap;
}

// ===========================================================================
// Editor
// ===========================================================================

function buildEditor(tlvs) {
  const editor = $("editor");
  editor.innerHTML = "";
  originalValues = {};

  // summary humanises some values (e.g. "360" → "IDR"). The editor needs the
  // *raw* TLV value to set up initial form state, so index by tag here.
  const rawByTag = {};
  for (const t of tlvs) rawByTag[t.tag] = t.value;

  for (const f of EDITABLE_FIELDS) {
    const val = rawByTag[f.tag] ?? "";
    originalValues[f.alias] = val;
    editor.appendChild(renderField(f, val));
  }

  attachCurrencyCountryWarn(editor);
  attachBillPaymentWarn(editor, tlvs);
  renderAcquirers(editor, tlvs);

  $("editor-empty").classList.add("hidden");
  $("editor-wrap").classList.remove("hidden");
}

function renderField(f, val) {
  const row = document.createElement("div");
  row.className = "field";

  const label = document.createElement("label");
  label.textContent = f.label;
  row.appendChild(label);

  const ctrl = document.createElement("div");
  ctrl.className = "field-ctrl";

  if (f.type === "select") {
    renderSelect(ctrl, f, val);
  } else {
    renderInput(ctrl, f, val);
  }

  row.appendChild(ctrl);
  return row;
}

function renderSelect(ctrl, f, val) {
  const sel = document.createElement("select");
  sel.dataset.alias = f.alias;

  // If the parsed value isn't one of the known options, expose it as a
  // synthetic "current" entry so the user can see the actual state.
  const opts = f.options.slice();
  if (val && !opts.some((o) => o.value === val)) {
    opts.unshift({ value: val, label: `${val} — (current)`, desc: "Nilai saat ini di QRIS." });
  }
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    // If the label already carries context (contains "—") don't duplicate it.
    opt.textContent = (o.desc && !o.label.includes("—")) ? `${o.label} — ${o.desc}` : o.label;
    if (o.value === val) opt.selected = true;
    sel.appendChild(opt);
  }
  ctrl.appendChild(sel);

  const desc = document.createElement("div");
  desc.className = "field-desc";
  const descByValue = Object.fromEntries(opts.map((o) => [o.value, o.desc || ""]));
  desc.textContent = descByValue[sel.value] || f.desc || "";
  sel.addEventListener("change", () => {
    desc.textContent = descByValue[sel.value] || f.desc || "";
  });
  ctrl.appendChild(desc);
}

function renderInput(ctrl, f, val) {
  const inp = document.createElement("input");
  inp.dataset.alias = f.alias;
  inp.value = val;
  inp.placeholder = f.placeholder || "";
  ctrl.appendChild(inp);

  if (f.desc) {
    const desc = document.createElement("div");
    desc.className = "field-desc";
    desc.textContent = f.desc;
    ctrl.appendChild(desc);
  }
}

// Walk the form, compute the diff against parse-time state. Empty inputs mean
// "remove the tag"; anything that hasn't changed is skipped.
function collectEdits() {
  const set = {};
  const remove = [];
  const aliasToTag = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.alias, f.tag]));

  document.querySelectorAll("#editor [data-alias]").forEach((el) => {
    const alias = el.dataset.alias;
    const v = (el.value ?? "").trim();
    const orig = originalValues[alias] ?? "";
    if (v === orig) return;
    if (v === "") {
      remove.push(aliasToTag[alias]);
    } else {
      set[alias] = v;
    }
  });
  return { set, remove };
}

// ===========================================================================
// Editor — soft validations
// ===========================================================================

function attachCurrencyCountryWarn(editor) {
  const curSel = editor.querySelector('select[data-alias="currency"]');
  const ctrySel = editor.querySelector('select[data-alias="country"]');
  if (!curSel || !ctrySel) return;

  const warn = document.createElement("div");
  warn.className = "field-warn hidden";
  editor.appendChild(warn);

  const check = () => {
    const ctry = ctrySel.value;
    const cur = curSel.value;
    const allowed = COUNTRY_CURRENCY[ctry];
    if (!allowed || allowed.includes(cur)) {
      warn.classList.add("hidden");
      return;
    }
    const curName = CURRENCY_NAME[cur] || cur;
    const expected = allowed.map((c) => CURRENCY_NAME[c] || c).join(" / ");
    warn.textContent =
      `⚠ Country ${ctry} biasanya pakai ${expected}, sementara currency dipilih ${curName}. ` +
      `QR akan tetap valid secara TLV/CRC, tapi app pembayar kemungkinan menolak transaksi.`;
    warn.classList.remove("hidden");
  };

  curSel.addEventListener("change", check);
  ctrySel.addEventListener("change", check);
  check();
}

// 62.01 = Bill Number, 62.02 = Mobile Number top-up. In both cases the
// acquirer's backend cross-checks the amount against a registered transaction,
// so an edited amount will be rejected as "amount mismatch" / "bill not found".
function attachBillPaymentWarn(editor, tlvs) {
  const tag62 = tlvs.find((t) => t.tag === "62");
  if (!tag62 || !tag62.children) return;

  const bill = tag62.children.find((c) => c.tag === "01");
  const mobile = tag62.children.find((c) => c.tag === "02");
  if (!bill && !mobile) return;

  const kind = bill ? "Bill Number" : "Mobile Number top-up";
  const ref = (bill || mobile).value;

  const amountInput = editor.querySelector('input[data-alias="amount"]');
  if (!amountInput) return;
  const ctrl = amountInput.closest(".field-ctrl");
  if (!ctrl) return;

  const warn = document.createElement("div");
  warn.className = "field-warn";
  warn.textContent =
    `⚠ QR ini adalah QRIS tagihan (62.01 = ${kind}: ${ref}). ` +
    `Amount terikat ke tagihan di sistem acquirer — mengubahnya akan ditolak ` +
    `dengan kode "amount mismatch" / "bill not found". Jangan edit amount.`;
  ctrl.appendChild(warn);
}

// ===========================================================================
// Acquirer panel (read-only)
//
// Tags 26–51 carry the acquirer's GUID, PAN, NMID, and merchant criteria.
// Changing any of these would break payment routing (or claim a merchant ID
// that doesn't belong to the user), so they are deliberately not editable.
// We render them as a read-only panel for transparency.
// ===========================================================================

function renderAcquirers(editor, tlvs) {
  const acquirers = tlvs.filter((t) => {
    const n = parseInt(t.tag, 10);
    return n >= 26 && n <= 51;
  });
  if (!acquirers.length) return;

  const sec = document.createElement("div");
  sec.className = "acq-section";

  const h = document.createElement("h3");
  h.textContent = "Acquirer Info (read-only)";
  sec.appendChild(h);

  const note = document.createElement("div");
  note.className = "acq-note";
  note.textContent =
    "GUID/PAN/NMID tidak bisa diubah — mengubahnya akan membuat QRIS gagal dibayar (routing salah atau merchant tidak terdaftar di acquirer). Untuk punya QRIS yang menerima pembayaran ke akun anda, lakukan onboarding ke bank/e-wallet acquirer.";
  sec.appendChild(note);

  for (const acq of acquirers) sec.appendChild(renderAcquirerCard(acq));
  editor.appendChild(sec);
}

function renderAcquirerCard(acq) {
  const card = document.createElement("div");
  card.className = "acq-card";

  const head = document.createElement("div");
  head.className = "acq-card-head";
  head.textContent = `Tag ${acq.tag} — ${acq.name}`;
  card.appendChild(head);

  const children = acq.children || [];
  if (!children.length) {
    card.appendChild(renderAcqRow("Raw", "", acq.value));
    return card;
  }
  for (const ch of children) {
    const meta = ACQ_SUB_LABELS[ch.tag] || { k: `Sub ${ch.tag}`, hint: "" };
    card.appendChild(renderAcqRow(`${meta.k} (${ch.tag})`, meta.hint, ch.value));
  }
  return card;
}

function renderAcqRow(label, hint, value) {
  const row = document.createElement("div");
  row.className = "acq-row";
  const k = document.createElement("div");
  k.className = "acq-k";
  k.textContent = label;
  if (hint) k.title = hint;
  const v = document.createElement("div");
  v.className = "acq-v";
  v.textContent = value;
  row.appendChild(k); row.appendChild(v);
  return row;
}

// ===========================================================================
// Result view
// ===========================================================================

function renderPayloadColored(payload) {
  const box = $("new-payload");
  const idx = payload.lastIndexOf("6304");
  if (idx >= 0 && idx === payload.length - 8) {
    const head = payload.slice(0, idx);
    const crcPart = payload.slice(idx);
    box.innerHTML = `${head}<span class="crc-part">${crcPart}</span>`;
  } else {
    box.textContent = payload;
  }
}

async function drawQr(payload) {
  const canvas = $("qr-canvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await lazyScript("/qrcode.min.js");
    const qr = qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 2;
    const totalModules = count + margin * 2;
    const cell = Math.floor(canvas.width / totalModules);
    const offset = Math.floor((canvas.width - cell * count) / 2);
    ctx.fillStyle = "#000";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
        }
      }
    }
  } catch (e) {
    console.error("QR render failed:", e);
    ctx.fillStyle = "#000";
    ctx.font = "12px monospace";
    ctx.fillText("QR error: " + e.message, 10, 20);
  }
}

// ===========================================================================
// Image input — decode a QR image to a payload string (jsQR)
// ===========================================================================

let _previewObjectUrl = null;

async function decodeImageFile(file) {
  const status = $("decode-status");
  const preview = $("preview-img");
  const setStatus = (msg, color) => { status.textContent = msg; status.style.color = color; };

  setStatus("Memuat gambar…", "var(--muted)");

  if (_previewObjectUrl) { URL.revokeObjectURL(_previewObjectUrl); _previewObjectUrl = null; }
  _previewObjectUrl = URL.createObjectURL(file);
  preview.src = _previewObjectUrl;
  preview.classList.remove("hidden");

  // Let the browser paint the preview before the (synchronous) decode starts.
  await new Promise((r) => requestAnimationFrame(r));

  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Gagal memuat gambar"));
      i.src = _previewObjectUrl;
    });
  } catch (e) {
    setStatus(e.message, "var(--danger)");
    return;
  }

  // Scan a smaller image — 600px is plenty for any QR that is still readable
  // and decoding scales O(n²) with side length.
  const MAX = 600;
  let w = img.width, h = img.height;
  if (Math.max(w, h) > MAX) {
    const s = MAX / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }

  setStatus("Memuat decoder…", "var(--muted)");
  try {
    await lazyScript("/jsqr.min.js");
  } catch (e) {
    setStatus(e.message, "var(--danger)");
    return;
  }

  setStatus("Mendekode QR…", "var(--muted)");
  await new Promise((r) => requestAnimationFrame(r));

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const t0 = performance.now();
  const code = jsQR(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
  const dt = Math.round(performance.now() - t0);

  // Release memory aggressively. On Android, holding the original 10MP photo
  // blob plus a full-size decoded canvas can keep ~10MB alive and make
  // page refresh feel sluggish.
  try {
    const thumb = canvas.toDataURL("image/jpeg", 0.6);
    preview.src = thumb;
  } catch (_) { /* tainted canvas — leave preview as-is */ }
  if (_previewObjectUrl) { URL.revokeObjectURL(_previewObjectUrl); _previewObjectUrl = null; }
  fileInput.value = "";
  img = null;
  canvas.width = 0; canvas.height = 0;

  if (!code || !code.data) {
    setStatus(`Tidak menemukan QR (scan ${w}×${h} dalam ${dt}ms). Coba foto lebih jelas / kontras tinggi.`, "var(--danger)");
    return;
  }
  $("input").value = code.data;
  setStatus(`QR terdeteksi (${code.data.length} chars, ${dt}ms). Auto-parsing…`, "var(--ok)");
  $("btn-parse").click();
}

// ===========================================================================
// Wire up: tabs, drag-drop, paste, camera
// ===========================================================================

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const which = t.dataset.tab;
    $("tab-text").classList.toggle("hidden", which !== "text");
    $("tab-image").classList.toggle("hidden", which !== "image");
  });
});

const dz = $("dropzone");
const fileInput = $("file-input");
fileInput.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) decodeImageFile(f);
});
["dragenter", "dragover"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
);
dz.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith("image/")) decodeImageFile(f);
});

window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const it of items) {
    if (it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) {
        document.querySelector('.tab[data-tab="image"]').click();
        decodeImageFile(f);
      }
      break;
    }
  }
});

$("btn-camera").addEventListener("click", () => {
  // capture="environment" launches the rear camera directly on mobile.
  const cam = document.createElement("input");
  cam.type = "file";
  cam.accept = "image/*";
  cam.capture = "environment";
  cam.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) decodeImageFile(f);
  });
  cam.click();
});

$("btn-clear-image").addEventListener("click", () => {
  $("preview-img").src = "";
  $("preview-img").classList.add("hidden");
  $("decode-status").textContent = "";
  fileInput.value = "";
  if (_previewObjectUrl) { URL.revokeObjectURL(_previewObjectUrl); _previewObjectUrl = null; }
});

// ===========================================================================
// Wire up: primary buttons
// ===========================================================================

$("btn-sample").addEventListener("click", () => {
  $("input").value = SAMPLE;
  document.querySelector('.tab[data-tab="text"]').click();
});

$("btn-clear").addEventListener("click", () => {
  $("input").value = "";
  $("parsed").classList.add("hidden");
  $("editor-wrap").classList.add("hidden");
  $("editor-empty").classList.remove("hidden");
  $("result").classList.add("hidden");
  clearError("parse-error"); clearError("gen-error");
});

$("btn-parse").addEventListener("click", async () => {
  clearError("parse-error");
  const payload = $("input").value.trim();
  if (!payload) { showError("parse-error", "QRIS string kosong"); return; }
  try {
    const data = await parsePayload(payload);
    currentPayload = payload;
    renderSummary($("summary"), data.summary);
    renderCrcBadge($("crc-badge"), data.crc_valid, data.crc_expected, data.crc_actual);
    renderTlvs($("tlv-tree"), data.tlvs);
    buildEditor(data.tlvs);
    $("parsed").classList.remove("hidden");
    $("result").classList.add("hidden");
  } catch (e) {
    showError("parse-error", e.message);
  }
});

$("btn-generate").addEventListener("click", async () => {
  clearError("gen-error");
  const { set, remove } = collectEdits();
  if (Object.keys(set).length === 0 && remove.length === 0) {
    showError("gen-error", "Tidak ada perubahan. Edit dulu salah satu field.");
    return;
  }
  try {
    const data = await modifyPayload(currentPayload, set, remove, $("auto-dynamic").checked);
    renderPayloadColored(data.payload);
    renderCrcBadge($("gen-crc-badge"), data.parsed.crc_valid, data.parsed.crc_expected, data.parsed.crc_actual);
    renderSummary($("new-summary"), data.parsed.summary);
    $("result").classList.remove("hidden");
    await drawQr(data.payload);
  } catch (e) {
    showError("gen-error", e.message);
  }
});

$("btn-reset").addEventListener("click", () => {
  document.querySelectorAll("#editor input[data-alias]").forEach((el) => {
    el.value = originalValues[el.dataset.alias] ?? "";
  });
});

$("btn-copy").addEventListener("click", async () => {
  const text = $("new-payload").textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $("btn-copy");
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = old), 1200);
  } catch (e) {
    alert("Copy gagal: " + e.message);
  }
});

$("btn-use").addEventListener("click", () => {
  $("input").value = $("new-payload").textContent;
  $("btn-parse").click();
});
