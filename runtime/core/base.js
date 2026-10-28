/* ComfyGame runtime: base utilities. Concatenated (in order) into every exported game. */
"use strict";
const CG = (window.CG = window.CG || {});
CG.VERSION = "1.0.0";
CG.genres = {};
CG.defineGenre = (name, impl) => { CG.genres[name] = impl; };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const TAU = Math.PI * 2;
// frame-rate independent smoothing: fraction of the gap closed per second
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function mulberry32(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}
CG.rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);

CG.ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// Sandboxed iframes throw on localStorage access; keep an in-memory fallback.
CG.store = (() => {
  const mem = {};
  let ls = null;
  try { ls = window.localStorage; ls.getItem("_"); } catch (e) { ls = null; }
  return {
    get(key, fallback) {
      try { const v = ls ? ls.getItem(key) : mem[key]; return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      const s = JSON.stringify(value);
      try { if (ls) ls.setItem(key, s); else mem[key] = s; } catch (e) { mem[key] = s; }
    },
  };
})();

CG.hexToRgb = (hex) => {
  const h = String(hex || "#000").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
CG.rgba = (hex, a) => { const [r, g, b] = CG.hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
CG.mix = (h1, h2, t) => {
  const a = CG.hexToRgb(h1), b = CG.hexToRgb(h2);
  const c = a.map((v, i) => Math.round(lerp(v, b[i], t)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};
CG.luma = (hex) => { const [r, g, b] = CG.hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

// Timers that tick with the game clock (pausing with it).
class Timers {
  constructor() { this.list = []; }
  after(sec, fn) { const t = { t: sec, fn }; this.list.push(t); return t; }
  every(sec, fn) { const t = { t: sec, fn, every: sec }; this.list.push(t); return t; }
  cancel(t) { const i = this.list.indexOf(t); if (i >= 0) this.list.splice(i, 1); }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.t -= dt;
      if (t.t <= 0) {
        if (t.every) t.t += t.every; else this.list.splice(i, 1);
        t.fn();
      }
    }
  }
  clear() { this.list.length = 0; }
}
CG.Timers = Timers;

// Tiny tween system for UI and juice.
class Tweens {
  constructor() { this.list = []; }
  to(obj, props, dur, ease = CG.ease.outQuad, done) {
    const from = {};
    for (const k in props) from[k] = obj[k];
    const tw = { obj, from, props, dur, t: 0, ease, done };
    this.list.push(tw);
    return tw;
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t = Math.min(tw.dur, tw.t + dt);
      const k = tw.ease(tw.dur > 0 ? tw.t / tw.dur : 1);
      for (const p in tw.props) tw.obj[p] = lerp(tw.from[p], tw.props[p], k);
      if (tw.t >= tw.dur) { this.list.splice(i, 1); tw.done && tw.done(); }
    }
  }
}
CG.Tweens = Tweens;

// Smooth 2D value noise in 0..1 (deterministic), used for organic floor patches.
CG.vnoise = (x, y, seed = 0) => {
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

CG.formatTime = (sec) => {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), cs = Math.floor((sec * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};
CG.pad = (n, w) => String(Math.floor(n)).padStart(w, "0");
