// src/main.js
// UI bindings, status, robust first render, presets.

const $ = (id) => /** @type {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} */ (document.getElementById(id));

/* ----- canvas ----- */
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const ctx = canvas ? canvas.getContext("2d", { alpha: true }) : null;

/* ----- status badge (robust) ----- */
let statusEl = document.getElementById("status");
if (!statusEl) {
  const h = document.querySelector("header") || document.body;
  statusEl = document.createElement("span");
  statusEl.id = "status";
  statusEl.className = "status-badge";
  h.appendChild(statusEl);
}
function ensureStatusParts() {
  if (!statusEl.querySelector(".dot") || !statusEl.querySelector(".txt")) {
    statusEl.innerHTML = `<span class="dot"></span><span class="txt">Ready</span>`;
  }
  return {
    dot: /** @type {HTMLElement} */ (statusEl.querySelector(".dot")),
    txt: /** @type {HTMLElement} */ (statusEl.querySelector(".txt")),
  };
}
function setStatus(state, message) {
  const { dot, txt } = ensureStatusParts();
  dot.classList.remove("running","ok","warn","err");
  if (state === "running") dot.classList.add("running");
  if (state === "ok") dot.classList.add("ok");
  if (state === "warn") dot.classList.add("warn");
  if (state === "err") dot.classList.add("err");
  txt.textContent = message;
}

/* ----- worker & tokens ----- */
let worker = null;
try {
  worker = new Worker("./src/worker.js", { type: "module" });
} catch (e) {
  console.error("Worker init failed:", e);
  setStatus("err", "Worker init failed");
}
let currentToken = 0;
const nextToken = () => (++currentToken);

/* ----- read config from DOM ----- */
function readConfig() {
  const num = (el, def) => (el && el.value !== "" ? Number(el.value) : def);
  const str = (el, def) => (el && el.value !== "" ? String(el.value) : def);

  const gen_mode = str($("gen_mode"), "F1_VS_F2");
  const title    = str($("title"), "F1_vs_F2 Web Playground");
  const notes    = str($("notes"), "");
  const exactAlways = $("exact_always") ? $("exact_always").checked : false;

  const f1 = str($("f1"), "x^2 - y^2");
  const f2 = str($("f2"), "2*x + y");
  const func_seed   = Math.trunc(num($("func_seed"), 12345));
  const points_seed = Math.trunc(num($("points_seed"), 777));

  const space_mode  = str($("space_mode"), "grid");
  const grid_phase  = str($("grid_phase"), "on_lines");

  const grid_step_single = Number.isFinite(num($("grid_step"), NaN)) ? num($("grid_step"), 0.01) : undefined;
  const grid_step_on      = Number.isFinite(num($("grid_step_on"), NaN)) ? num($("grid_step_on"), 0.01) : (grid_step_single ?? 0.01);
  const grid_step_between = Number.isFinite(num($("grid_step_between"), NaN)) ? num($("grid_step_between"), 0.01) : (grid_step_single ?? 0.01);

  const n_points   = Math.trunc(num($("n_points"), 50000));
  const x_min = num($("x_min"), -2), x_max = num($("x_max"), 2);
  const y_min = num($("y_min"), -2), y_max = num($("y_max"), 2);

  const projection = str($("projection"), "RECTILINEAR").toUpperCase();
  const marker     = str($("marker"), "CIRCLE").toUpperCase();
  const spot_size  = Math.trunc(num($("spot_size"), 1));
  const rotation_deg = Math.trunc(num($("rotation_deg"), 0));
  const alpha = Math.max(0, Math.min(1, Number(num($("alpha"), 0.3))));
  const dpi   = Math.trunc(num($("dpi"), 300));
  const fg    = str($("fg"), "#000000");
  const bg    = str($("bg"), "#FFFFFF");

  return {
    exactAlways,
    generation_mode: gen_mode,
    functions: { f1, f2, func_seed },
    space: {
      x_min, x_max, y_min, y_max,
      mode: space_mode,
      grid_phase,
      grid_step: grid_step_on, // legacy
      grid_step_on,
      grid_step_between,
      n_points
    },
    render: { projection, marker, spot_size, rotation_deg, alpha, dpi, fg, bg },
    seeds:  { points_seed, style_seed: 42 },
    meta:   { title, notes }
  };
}

/* ----- schedule & start render ----- */
let rafId = null;
let settleTimer = null;

function scheduleRender(profile = "full") {
  if (!worker) return;
  if (rafId) cancelAnimationFrame(rafId);
  const token = nextToken();
  setStatus("running", `Rendering… ${profile}`);
  rafId = requestAnimationFrame(() => startRender(token, profile));
}

function startRender(token, profile) {
  if (!worker) return;
  const config = readConfig();
  try {
    worker.postMessage({ type: "render", token, config, profile });
  } catch (e) {
    console.error("postMessage failed:", e);
    setStatus("err", "Render dispatch failed");
  }
}

function scheduleLive() {
  if (readConfig().exactAlways) return scheduleRender("full");
  scheduleRender("fastest");
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => scheduleRender("full"), 250);
}

/* ----- worker events ----- */
if (worker) {
  worker.onmessage = (ev) => {
    const { type, token } = ev.data || {};
    if (token !== currentToken) return;

    if (type === "started") {
      setStatus("running", `Rendering… ${ev.data.profile}`);
      return;
    }
    if (type === "status") return;

    if (type === "bitmap") {
      if (!ctx) return;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(ev.data.bitmap, 0, 0);
      return;
    }
    if (type === "done") {
      setStatus("ok", `Rendered in ${ev.data.ms} ms — ${ev.data.profile} • points=${ev.data.points}`);
      return;
    }
    if (type === "error") {
      console.error("Worker error:", ev.data.message);
      setStatus("err", `Error: ${ev.data.message}`);
      return;
    }
  };
  worker.onerror = (e) => { console.error("Worker onerror:", e); setStatus("err", "Worker runtime error"); };
  worker.onmessageerror = (e) => { console.error("Worker message error:", e); setStatus("err", "Worker message error"); };
}

/* ----- bind inputs ----- */
const INPUT_IDS = [
  "gen_mode","title","notes","exact_always",
  "f1","f2","func_seed","points_seed",
  "space_mode","grid_phase","grid_step","grid_step_on","grid_step_between",
  "x_min","x_max","y_min","y_max","n_points",
  "projection","marker","spot_size","rotation_deg","alpha","dpi","fg","bg"
].filter((id) => document.getElementById(id));

for (const id of INPUT_IDS) {
  const el = document.getElementById(id);
  const handler = el.tagName === "SELECT" ? "change" : "input";
  el.addEventListener(handler, scheduleLive);
  if (handler !== "change") el.addEventListener("change", () => scheduleRender("full"));
}

/* ----- presets & export ----- */
const btnSave = document.getElementById("save_preset");
const btnPNG  = document.getElementById("download_png");
const upPreset = document.getElementById("load_preset");
const cfgPreview = document.getElementById("cfg_preview");

function currentConfigJSON() {
  const cfg = readConfig();
  const txt = JSON.stringify(cfg, null, 2);
  if (cfgPreview) cfgPreview.textContent = txt;
  return txt;
}
function downloadBlob(data, filename, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  });
}
if (btnSave) {
  btnSave.addEventListener("click", () => {
    const cfgTxt = currentConfigJSON();
    const name = ( $("title")?.value?.trim() || "preset" ).replace(/[^\w\-.]+/g, "_");
    downloadBlob(cfgTxt, `${name}.json`, "application/json");
  });
}
if (btnPNG) {
  btnPNG.addEventListener("click", () => {
    const name = ( $("title")?.value?.trim() || "image" ).replace(/[^\w\-.]+/g, "_");
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${name}.png`, "image/png");
    }, "image/png");
  });
}
if (upPreset) {
  upPreset.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const cfg = JSON.parse(txt);
      const setIf = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = String(val); };

      setIf("gen_mode", cfg.generation_mode);
      setIf("title", cfg.meta?.title);
      setIf("notes", cfg.meta?.notes);

      setIf("f1", cfg.functions?.f1);
      setIf("f2", cfg.functions?.f2);
      setIf("func_seed", cfg.functions?.func_seed);
      setIf("points_seed", cfg.seeds?.points_seed);

      setIf("space_mode", cfg.space?.mode);
      setIf("grid_phase", cfg.space?.grid_phase);
      setIf("grid_step", cfg.space?.grid_step);
      setIf("grid_step_on", cfg.space?.grid_step_on);
      setIf("grid_step_between", cfg.space?.grid_step_between);
      setIf("x_min", cfg.space?.x_min);
      setIf("x_max", cfg.space?.x_max);
      setIf("y_min", cfg.space?.y_min);
      setIf("y_max", cfg.space?.y_max);
      setIf("n_points", cfg.space?.n_points);

      setIf("projection", cfg.render?.projection);
      setIf("marker", cfg.render?.marker);
      setIf("spot_size", cfg.render?.spot_size);
      setIf("rotation_deg", cfg.render?.rotation_deg);
      setIf("alpha", cfg.render?.alpha);
      setIf("dpi", cfg.render?.dpi);
      setIf("fg", cfg.render?.fg);
      setIf("bg", cfg.render?.bg);

      if ($("exact_always")) $("exact_always").checked = !!cfg.exactAlways;

      currentConfigJSON();
      scheduleRender("full");
    } catch (err) {
      console.error(err);
      setStatus("err", "Invalid preset JSON");
    } finally {
      e.target.value = "";
    }
  });
}

/* ----- robust initial render ----- */
function kickoff() {
  try {
    ensureStatusParts(); // ensure structure exists
    currentConfigJSON();
    if (ctx && canvas) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    scheduleRender("full");
  } catch (e) {
    console.error("kickoff failed:", e);
    setStatus("err", "Init failed");
  }
}
if (document.readyState === "complete" || document.readyState === "interactive") {
  kickoff();
} else {
  window.addEventListener("DOMContentLoaded", kickoff, { once: true });
  window.addEventListener("load", kickoff, { once: true });
}
