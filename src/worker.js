// src/worker.js
import seedrandom from "https://cdn.jsdelivr.net/npm/seedrandom@3.0.5/+esm";
import { Parser } from "https://cdn.jsdelivr.net/npm/expr-eval@2.0.2/+esm";

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp  = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const softsign = (x) => x / (1 + Math.abs(x));
const softplus = (x) => Math.log(1 + Math.exp(x));
const relu = (x) => (x < 0 ? 0 : x);
const lrelu = (x, a = 0.01) => (x < 0 ? a * x : x);
const step = (edge, x) => (x < edge ? 0 : 1);
const smoothstep = (a, b, x) => { if (a === b) return x < a ? 0 : 1; const t = clamp((x - a)/(b - a),0,1); return t*t*(3-2*t); };
const r2 = (x, y) => x * x + y * y;
const angle = (x, y) => Math.atan2(y, x);
const polar_r = (x, y) => Math.hypot(x, y);
const polar_theta = (x, y) => Math.atan2(y, x);
const sinc = (x) => (x === 0 ? 1 : Math.sin(x) / x);
const tri = (x) => 2 * Math.abs(fract(x) - 0.5);
const saw = (x) => fract(x);
const smoothmin = (a, b, k = 4) => -Math.log(Math.exp(-k * a) + Math.exp(-k * b)) / k;
const smoothmax = (a, b, k = 4) => -smoothmin(-a, -b, k);
const gamma = (x, g = 2.2) => Math.pow(Math.max(0, x), 1 / g);
const mapLin = (x, a, b, c, d) => c + (d - c) * ((x - a) / (b - a));

self.onmessage = async (ev) => {
  const { type, token, config, profile } = ev.data || {};
  if (type !== "render") return;

  const t0 = performance.now();
  postMessage({ type: "started", token, profile });

  try {
    const funcSeed = (config.functions?.func_seed != null) ? String(config.functions.func_seed) : "0";
    const rngFunc   = seedrandom(funcSeed);
    const rngPoints = seedrandom(config.seeds?.points_seed != null ? String(config.seeds.points_seed) : undefined);
    const rngStyle  = seedrandom(config.seeds?.style_seed  != null ? String(config.seeds.style_seed)  : undefined);

    const P = Array.from({ length: 8 }, () => rngFunc() * 2 - 1);

    let spare = null;
    const RNG01 = () => rngFunc();
    const RAND  = () => RNG01();
    const UNIFORM = (a = -1, b = 1) => a + (b - a) * RNG01();
    const GAUSS = (mu = 0, sigma = 1) => {
      if (spare != null) { const val = spare; spare = null; return mu + sigma * val; }
      let u = 0, v = 0; while (u === 0) u = RNG01(); while (v === 0) v = RNG01();
      const r = Math.sqrt(-2.0 * Math.log(u)); const t = 2.0 * Math.PI * v;
      spare = r * Math.sin(t); return mu + sigma * (r * Math.cos(t));
    };

    const salt = (parseInt(funcSeed, 10) || 0) * 0.001 + 0.12345;
    const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123);
    const noise2 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi,       yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const n00 = hash2(xi,     yi), n10 = hash2(xi + 1, yi);
      const n01 = hash2(xi,     yi + 1), n11 = hash2(xi + 1, yi + 1);
      const nx0 = lerp(n00, n10, u), nx1 = lerp(n01, n11, u);
      return lerp(nx0, nx1, v);
    };

    let projection = (config.render?.projection || "RECTILINEAR").toUpperCase();
    if (projection === "RANDOM") {
      const list = ["RECTILINEAR","POLAR","AITOFF","HAMMER","LAMBERT","MOLLWEIDE"];
      projection = list[Math.floor(rngStyle() * list.length)];
    }
    let marker = (config.render?.marker || "CIRCLE").toUpperCase();
    if (marker === "RANDOM") {
      const list = ["POINT","PIXEL","CIRCLE","SQUARE","STAR"];
      marker = list[Math.floor(rngStyle() * list.length)];
    }
    let mode = config.generation_mode || "F1_VS_F2";
    if (mode === "RANDOM") {
      const modes = [
        "F1_VS_F2","F2_VS_F1","F1_VС_INDEX","F2_VS_INDEX","INDEX_VS_F1","INDEX_VS_F2",
        "F1_VS_X1","F1_VS_X2","F2_VS_X1","F2_VS_X2","X1_VS_F1","X1_VS_F2","X2_VS_F1","X2_VS_F2",
        "F1F2_VS_F1","F1F2_VS_F2","F1_VS_F1F2","F2_VS_F1F2"
      ];
      mode = modes[Math.floor(rngStyle() * list.length)];
    }

    const parser = new Parser({ operators: { add: true, multiply: true, divide: true, power: true, factorial: false } });
    const sanitize = (s) =>
      (typeof s === "string"
        ? s.trim().replace(/\bnp_/gi, "").replace(/\bmath\./gi, "").replace(/\*\*/g, "^")
        : "0") || "0";

    const SAFE = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan,
      asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
      sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
      log: Math.log, log10: (x) => (Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10),
      sqrt: Math.sqrt, exp: Math.exp, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, pow: Math.pow,
      pi: Math.PI, e: Math.E, tau: Math.PI * 2,

      sign, sgn: sign, sigmoid, logistic: sigmoid, softsign, softplus, relu, lrelu,
      clamp, step, smoothstep, r2, angle, polar_r, polar_theta,
      sinc, tri, saw, smoothmin, smoothmax, gamma, map: mapLin,

      rand: () => RAND(),
      uniform: (a = 0, b = 1) => UNIFORM(Number(a), Number(b)),
      gauss: (mu = 0, sigma = 1) => GAUSS(Number(mu), Number(sigma)),
      hash: (x, y) => hash2(Number(x), Number(y)),
      noise: (x, y) => noise2(Number(x), Number(y)),

      p1: P[0], p2: P[1], p3: P[2], p4: P[3], p5: P[4], p6: P[5], p7: P[6], p8: P[7]
    };
    const allowedVars = new Set(["x","y","p1","p2","p3","p4","p5","p6","p7","p8"]);
    const SAFE_NAMES = new Set(Object.keys(SAFE));

    const compile = (s) => {
      const ast = parser.parse(sanitize(s));
      for (const v of ast.variables()) {
        if (!allowedVars.has(v) && !SAFE_NAMES.has(v)) throw new Error("Only x, y, p1..p8 are allowed");
      }
      const ctx = Object.assign(Object.create(null), SAFE, { x: 0, y: 0 });
      return (x, y) => { ctx.x = x; ctx.y = y; return ast.evaluate(ctx); };
    };

    const f1 = compile(config.functions.f1);
    const f2 = compile(config.functions.f2);

    const { x, y } = buildXY(config.space, rngPoints);
    const { u, v } = computeUV(mode, x, y, f1, f2);

    const rot = (config.render.rotation_deg || 0) * Math.PI / 180;
    let ur = u, vr = v;
    if (rot) {
      ur = new Float64Array(u.length); vr = new Float64Array(v.length);
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let i = 0; i < u.length; i++) { ur[i] = u[i] * c - v[i] * s; vr[i] = u[i] * s + v[i] * c; }
    }

    const proj = project((projection || "RECTILINEAR").toUpperCase(), ur, vr);
    const { px, py } = fitToSquare(proj.x, proj.y, 1600, 0.06);

    const off = new OffscreenCanvas(1600, 1600);
    const g = off.getContext("2d");
    g.fillStyle = config.render.bg || "#FFFFFF";
    g.fillRect(0, 0, 1600, 1600);
    drawPoints(g, px, py, {
      marker,
      spot: Math.max(1, Number(config.render.spot_size || 1)),
      alpha: clamp(Number(config.render.alpha ?? 0.3), 0, 1),
      fg: config.render.fg || "#000000"
    });

    const bitmap = await createImageBitmap(off);
    postMessage({ type: "bitmap", token, bitmap }, [bitmap]);

    const t1 = performance.now();
    postMessage({ type: "done", token, ms: Math.round(t1 - t0), profile, points: x.length });
  } catch (e) {
    postMessage({ type: "error", token, message: e.message || String(e) });
  }
};

/* ----- sampling ----- */
function buildXY(space, rng) {
  const xmin = Number(space.x_min), xmax = Number(space.x_max);
  const ymin = Number(space.y_min), ymax = Number(space.y_max);

  if ((space.mode || "grid") === "grid") {
    const phase = (space.grid_phase || "on_lines");
    const step = Math.max(0.001, Number(phase === "between_lines"
      ? (space.grid_step_between ?? space.grid_step)
      : (space.grid_step_on ?? space.grid_step)));
    const shift = phase === "between_lines" ? step / 2 : 0;

    const xs = range(xmin + shift, xmax + shift, step);
    const ys = range(ymin + shift, ymax + shift, step);
    const n = xs.length * ys.length;

    const x = new Float64Array(n), y = new Float64Array(n);
    let k = 0;
    for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) { x[k] = xs[i]; y[k] = ys[j]; k++; }
    return { x, y };
  }

  const n = Math.max(100, Number(space.n_points || 10000));
  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = xmin + (xmax - xmin) * rng();
    y[i] = ymin + (ymax - ymin) * rng();
  }
  return { x, y };
}
function range(a, b, step) { const out = []; for (let t = a; t <= b; t += step) out.push(t); return out; }

/* ----- modes ----- */
function computeUV(mode, x, y, f1, f2) {
  const n = x.length, u = new Float64Array(n), v = new Float64Array(n);
  let f1v = null, f2v = null;
  const needBoth = ["F1_VS_F2","F2_VS_F1","F1F2_VS_F1","F1F2_VS_F2","F1_VS_F1F2","F2_VS_F1F2"].includes(mode);
  if (needBoth) { f1v = new Float64Array(n); f2v = new Float64Array(n); }
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    const a = needBoth ? (f1v[i] = f1(xi, yi), f1v[i]) : f1(xi, yi);
    const b = needBoth ? (f2v[i] = f2(xi, yi), f2v[i]) : f2(xi, yi);
    switch (mode) {
      case "F1_VS_F2": u[i] = a; v[i] = b; break;
      case "F2_VS_F1": u[i] = b; v[i] = a; break;
      case "F1_VS_INDEX": u[i] = a; v[i] = i; break;
      case "F2_VS_INDEX": u[i] = b; v[i] = i; break;
      case "INDEX_VS_F1": u[i] = i; v[i] = a; break;
      case "INDEX_VS_F2": u[i] = i; v[i] = b; break;
      case "F1_VS_X1": u[i] = a; v[i] = xi; break;
      case "F1_VS_X2": u[i] = a; v[i] = yi; break;
      case "F2_VS_X1": u[i] = b; v[i] = xi; break;
      case "F2_VS_X2": u[i] = b; v[i] = yi; break;
      case "X1_VS_F1": u[i] = xi; v[i] = a; break;
      case "X1_VS_F2": u[i] = xi; v[i] = b; break;
      case "X2_VS_F1": u[i] = yi; v[i] = a; break;
      case "X2_VS_F2": u[i] = yi; v[i] = b; break;
      case "F1F2_VS_F1": u[i] = f1v[i] + f2v[i]; v[i] = f1v[i]; break;
      case "F1F2_VS_F2": u[i] = f1v[i] + f2v[i]; v[i] = f2v[i]; break;
      case "F1_VS_F1F2": u[i] = f1v[i]; v[i] = f1v[i] + f2v[i]; break;
      case "F2_VS_F1F2": u[i] = f2v[i]; v[i] = f1v[i] + f2v[i]; break;
      default: u[i] = a; v[i] = b; break;
    }
  }
  return { u, v };
}

/* ----- projections & fit ----- */
function scaleTo(arr, lo, hi) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < arr.length; i++) { const t = arr[i]; if (t < mn) mn = t; if (t > mx) mx = t; }
  if (!isFinite(mn) || !isFinite(mx) || mn === mx) {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = (lo + hi) * 0.5;
    return out;
  }
  const out = new Float64Array(arr.length), k = (hi - lo) / (mx - mn);
  for (let i = 0; i < arr.length; i++) out[i] = lo + (arr[i] - mn) * k;
  return out;
}
function project(proj, u, v) {
  const n = u.length;
  const x = new Float64Array(n), y = new Float64Array(n);

  if (proj === "RECTILINEAR") {
    for (let i = 0; i < n; i++) { x[i] = u[i]; y[i] = v[i]; }
    return { x, y };
  }
  if (proj === "POLAR") {
    let maxR = 0; for (let i = 0; i < n; i++) { const r = Math.abs(v[i]); if (r > maxR) maxR = r; }
    const mr = maxR || 1;
    for (let i = 0; i < n; i++) {
      const ang = ((u[i] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const rr = Math.abs(v[i]) / mr;
      x[i] = Math.cos(ang) * rr;
      y[i] = Math.sin(ang) * rr;
    }
    return { x, y };
  }

  let a = u, b = v;
  if (["AITOFF","HAMMER","LAMBERT","MOLLWEIDE"].includes(proj)) {
    a = scaleTo(u, -Math.PI, Math.PI);
    b = scaleTo(v, -Math.PI / 2, Math.PI / 2);
  }

  switch (proj) {
    case "AITOFF": {
      for (let i = 0; i < n; i++) {
        const l = a[i], p = b[i];
        const c = Math.acos(Math.cos(p) * Math.cos(l / 2));
        const k = c === 0 ? 1 : Math.sin(c) / c;
        x[i] = 2 * Math.cos(p) * Math.sin(l / 2) / k;
        y[i] = Math.sin(p) / k;
      } break;
    }
    case "HAMMER": {
      for (let i = 0; i < n; i++) {
        const l = a[i], p = b[i];
        const d = Math.sqrt(1 + Math.cos(p) * Math.cos(l / 2));
        x[i] = (2 * Math.SQRT2 * Math.cos(p) * Math.sin(l / 2)) / d;
        y[i] = (Math.SQRT2 * Math.sin(p)) / d;
      } break;
    }
    case "LAMBERT": {
      for (let i = 0; i < n; i++) {
        const l = a[i], p = b[i];
        x[i] = Math.sqrt(2) * Math.cos(p) * Math.sin(l / 2);
        y[i] = Math.sqrt(2) * Math.sin(p);
      } break;
    }
    case "MOLLWEIDE": {
      for (let i = 0; i < n; i++) {
        const l = a[i], p = b[i];
        x[i] = (2 * Math.SQRT2 / Math.PI) * l * Math.cos(p);
        y[i] = Math.SQRT2 * Math.sin(p);
      } break;
    }
  }
  return { x, y };
}
function fitToSquare(x, y, size, pad = 0.06) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < x.length; i++) {
    const xx = x[i], yy = y[i];
    if (xx < xmin) xmin = xx; if (xx > xmax) xmax = xx;
    if (yy < ymin) ymin = yy; if (yy > ymax) ymax = yy;
  }
  if (!isFinite(xmin) || !isFinite(xmax) || !isFinite(ymin) || !isFinite(ymax)) {
    return { px: new Float64Array(x.length), py: new Float64Array(y.length) };
  }
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
  const span = Math.max(xmax - xmin, ymax - ymin) || 1;
  const usable = size * (1 - 2 * pad);
  const k = usable / span;
  const px = new Float64Array(x.length), py = new Float64Array(y.length);
  const Cx = size / 2, Cy = size / 2;
  for (let i = 0; i < x.length; i++) {
    px[i] = Cx + (x[i] - cx) * k;
    py[i] = Cy - (y[i] - cy) * k;
  }
  return { px, py };
}

/* ----- drawing ----- */
function drawPoints(ctx, px, py, o) {
  const a = o.alpha ?? 0.3, s = Math.max(1, Number(o.spot || 1)), m = o.marker;
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = o.fg || "#000";
  if (m === "PIXEL") { for (let i = 0; i < px.length; i++) ctx.fillRect(px[i], py[i], 1, 1); }
  else if (m === "POINT") { for (let i = 0; i < px.length; i++) { ctx.beginPath(); ctx.arc(px[i], py[i], 0.75, 0, Math.PI * 2); ctx.fill(); } }
  else if (m === "CIRCLE") { const r = s / 2; for (let i = 0; i < px.length; i++) { ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, Math.PI * 2); ctx.fill(); } }
  else if (m === "SQUARE") { const r = s / 2; for (let i = 0; i < px.length; i++) ctx.fillRect(px[i] - r, py[i] - r, s, s); }
  else if (m === "STAR") { const r = s / 2; for (let i = 0; i < px.length; i++) drawStar(ctx, px[i], py[i], r); }
  else { const r = s / 2; for (let i = 0; i < px.length; i++) { ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, Math.PI * 2); ctx.fill(); } }
  ctx.restore();
}
function drawStar(ctx, x, y, r) {
  const rot = -Math.PI / 2;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + i * (2 * Math.PI / 5);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(x + Math.cos(a2) * (r * 0.5), y + Math.sin(a2) * (r * 0.5));
  }
  ctx.closePath(); ctx.fill();
}
