/* Juice: camera with trauma shake, particles, floating text, screen transitions. */
CG.Camera = class Camera {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.x = 0; this.y = 0;
    this.trauma = 0;
    this.ox = 0; this.oy = 0;
    this.bounds = null;
    this.t = 0;
  }
  setBounds(x, y, w, h) { this.bounds = { x, y, w, h }; }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  follow(tx, ty, dt, rate = 8, lookX = 0, lookY = 0) {
    const gx = tx - this.w / 2 + lookX, gy = ty - this.h / 2 + lookY;
    this.x = damp(this.x, gx, rate, dt);
    this.y = damp(this.y, gy, rate, dt);
    this.clamp();
  }
  snap(tx, ty) { this.x = tx - this.w / 2; this.y = ty - this.h / 2; this.clamp(); }
  clamp() {
    const b = this.bounds;
    if (!b) return;
    this.x = b.w <= this.w ? b.x + (b.w - this.w) / 2 : clamp(this.x, b.x, b.x + b.w - this.w);
    this.y = b.h <= this.h ? b.y + (b.h - this.h) / 2 : clamp(this.y, b.y, b.y + b.h - this.h);
  }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma * 9;
    this.ox = s * (Math.sin(this.t * 71.3) * 0.6 + Math.sin(this.t * 37.1) * 0.4);
    this.oy = s * (Math.sin(this.t * 53.7 + 1.3) * 0.6 + Math.sin(this.t * 29.3) * 0.4);
  }
  // Integer-snapped view origin used for drawing.
  get vx() { return Math.round(this.x + this.ox); }
  get vy() { return Math.round(this.y + this.oy); }
  visible(x, y, w, h, margin = 16) { return x + w > this.x - margin && x < this.x + this.w + margin && y + h > this.y - margin && y < this.y + this.h + margin; }
};

CG.Particles = class Particles {
  constructor(max = 900) { this.p = []; this.max = max; }
  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, life: o.life || 0.5, t: 0,
      size: o.size != null ? o.size : 2, endSize: o.endSize != null ? o.endSize : 0,
      color: o.color || "#fff", color2: o.color2 || null, g: o.g || 0, drag: o.drag != null ? o.drag : 2,
      shape: o.shape || "rect", rot: o.rot || 0, vr: o.vr || 0, layer: o.layer || 0, glow: !!o.glow,
    });
  }
  burst(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread != null ? o.spread : TAU) : Math.random() * TAU;
      const sp = (o.speed || 80) * (0.35 + Math.random() * 0.65);
      const colors = o.colors || [o.color || "#fff"];
      this.emit({
        x: x + (Math.random() - 0.5) * (o.jitter || 0), y: y + (Math.random() - 0.5) * (o.jitter || 0),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life || 0.5) * (0.6 + Math.random() * 0.6),
        size: o.size != null ? o.size * (0.7 + Math.random() * 0.6) : 2, endSize: o.endSize, color: colors[(Math.random() * colors.length) | 0],
        g: o.g || 0, drag: o.drag, shape: o.shape, vr: (Math.random() - 0.5) * 12, layer: o.layer, glow: o.glow,
      });
    }
  }
  update(dt) {
    const arr = this.p;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.t += dt;
      if (q.t >= q.life) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vy = q.vy * k + q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.rot += q.vr * dt;
      arr[w++] = q;
    }
    arr.length = w;
  }
  draw(ctx, camX, camY, layer = 0) {
    for (const q of this.p) {
      if ((q.layer || 0) !== layer) continue;
      const k = q.t / q.life;
      const s = lerp(q.size, q.endSize, k);
      if (s <= 0.05) continue;
      const x = q.x - camX, y = q.y - camY;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.fillStyle = q.color2 && k > 0.5 ? q.color2 : q.color;
      if (q.glow) ctx.globalCompositeOperation = "lighter";
      if (q.shape === "circle") { ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); }
      else if (q.shape === "spark") {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(q.vy, q.vx));
        ctx.fillRect(-s * 2, -0.5, s * 4, 1); ctx.restore();
      } else {
        const r = Math.max(1, Math.round(s));
        ctx.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), r, r);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }
  clear() { this.p.length = 0; }
};

CG.Floaters = class Floaters {
  constructor() { this.list = []; }
  add(text, x, y, color = "#fff", o = {}) { this.list.push({ text: String(text), x, y, color, t: 0, life: o.life || 0.9, vy: o.vy || -28, scale: o.scale || 1 }); }
  update(dt) {
    for (const f of this.list) { f.t += dt; f.y += f.vy * dt; f.vy *= Math.exp(-3 * dt); }
    this.list = this.list.filter((f) => f.t < f.life);
  }
  draw(gfx, camX, camY) {
    for (const f of this.list) {
      const k = f.t / f.life;
      gfx.ctx.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
      const pop = f.t < 0.12 ? 1 + (0.12 - f.t) * 4 : 1;
      gfx.text(f.text, f.x - camX, f.y - camY, { color: f.color, align: "center", outline: "#000", scale: Math.max(1, Math.round(f.scale * pop)) });
    }
    gfx.ctx.globalAlpha = 1;
  }
};

// Screen transition: a closing/opening iris of pixel diamonds.
CG.Transition = class Transition {
  constructor() { this.t = 1; this.dir = 0; this.cb = null; this.dur = 0.45; }
  out(cb, dur = 0.45) { this.dir = 1; this.t = 0; this.cb = cb; this.dur = dur; }
  in(dur = 0.45) { this.dir = -1; this.t = 1; this.dur = dur; }
  get busy() { return this.dir !== 0; }
  update(dt) {
    if (this.dir === 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      if (this.t >= 1) { this.dir = 0; const cb = this.cb; this.cb = null; cb && cb(); this.in(this.dur); }
    } else if (this.dir === -1) {
      this.t = Math.max(0, this.t - dt / this.dur);
      if (this.t <= 0) this.dir = 0;
    }
  }
  draw(gfx, color = "#000") {
    if (this.t <= 0) return;
    const ctx = gfx.ctx, W = gfx.W, H = gfx.H;
    const cell = 16;
    ctx.fillStyle = color;
    const k = CG.ease.inOutQuad(this.t);
    for (let y = 0; y < H + cell; y += cell) {
      for (let x = 0; x < W + cell; x += cell) {
        const d = (Math.abs(x + cell / 2 - W / 2) / W + Math.abs(y + cell / 2 - H / 2) / H) * 0.5;
        const local = clamp(k * 2.2 - d * 1.6, 0, 1);
        const s = local * cell * 1.42;
        if (s <= 0) continue;
        ctx.save();
        ctx.translate(x + cell / 2, y + cell / 2);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }
  }
};

// Ambient weather layer drawn over the world in screen space (leaves, snow, embers, dust, bubbles...).
CG.Weather = class Weather {
  constructor(theme, w, h) {
    this.w = w; this.h = h;
    const kinds = {
      forest: "leaves", jungle: "fireflies", snow: "snow", mountains: "snow_light", volcano: "embers", castle: "dust", cave: "dust",
      desert: "sand", candy: "sparkles", ocean: "spray", underwater: "bubbles", city: "rain", sky: "sparkles", space: null,
    };
    this.kind = kinds[theme] === undefined ? "dust" : kinds[theme];
    this.p = [];
    const n = { leaves: 18, fireflies: 22, snow: 70, snow_light: 25, embers: 40, dust: 30, sand: 45, sparkles: 22, spray: 20, bubbles: 26, rain: 90 }[this.kind] || 0;
    for (let i = 0; i < n; i++) this.p.push(this.spawn(true));
  }
  spawn(anywhere) {
    const r = Math.random;
    const q = { x: r() * this.w, y: anywhere ? r() * this.h : -6, t: r() * 10, s: 0.5 + r() * 0.8 };
    if (this.kind === "embers" || this.kind === "bubbles") q.y = anywhere ? r() * this.h : this.h + 6;
    return q;
  }
  update(dt, camDX = 0, camDY = 0) {
    if (!this.kind) return;
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i];
      q.t += dt;
      q.x -= camDX * (0.3 + q.s * 0.5); q.y -= camDY * (0.3 + q.s * 0.5);
      switch (this.kind) {
        case "leaves": q.x += (Math.sin(q.t * 1.3) * 14 - 8) * dt; q.y += 14 * q.s * dt; break;
        case "snow": case "snow_light": q.x += Math.sin(q.t * 1.7 + i) * 10 * dt - 4 * dt; q.y += 22 * q.s * dt; break;
        case "embers": q.x += Math.sin(q.t * 2 + i) * 9 * dt; q.y -= 18 * q.s * dt; break;
        case "bubbles": q.x += Math.sin(q.t * 2.5 + i) * 6 * dt; q.y -= 16 * q.s * dt; break;
        case "rain": q.x -= 40 * dt; q.y += 260 * q.s * dt; break;
        case "sand": q.x -= 70 * q.s * dt; q.y += Math.sin(q.t * 3 + i) * 6 * dt; break;
        case "spray": q.x -= 10 * dt; q.y += Math.sin(q.t + i) * 4 * dt; break;
        default: q.x += Math.sin(q.t * 0.7 + i) * 5 * dt; q.y += Math.cos(q.t * 0.6 + i) * 4 * dt;
      }
      if (q.y > this.h + 8 || q.y < -8 || q.x < -8 || q.x > this.w + 8) {
        const n = this.spawn(false);
        if (this.kind === "sand") { n.x = this.w + 4; n.y = Math.random() * this.h; }
        if (q.x < -8 || q.x > this.w + 8) { n.x = q.x < 0 ? this.w + 4 : -4; n.y = Math.random() * this.h; }
        this.p[i] = n;
      }
    }
  }
  draw(ctx, theme) {
    if (!this.kind) return;
    for (const q of this.p) {
      const x = Math.round(q.x), y = Math.round(q.y);
      switch (this.kind) {
        case "leaves": ctx.globalAlpha = 0.85; ctx.fillStyle = Math.sin(q.t * 3) > 0 ? theme.accent : CG.mix(theme.accent, "#000000", 0.3); ctx.fillRect(x, y, 2, Math.sin(q.t * 4) > 0 ? 2 : 1); break;
        case "fireflies": { const a = 0.5 + Math.sin(q.t * 3) * 0.5; ctx.globalAlpha = a; ctx.fillStyle = "#f6f2a0"; ctx.fillRect(x, y, 1, 1); ctx.globalAlpha = a * 0.3; ctx.fillRect(x - 1, y - 1, 3, 3); break; }
        case "snow": case "snow_light": ctx.globalAlpha = 0.6 + q.s * 0.3; ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, q.s > 1 ? 2 : 1, q.s > 1 ? 2 : 1); break;
        case "embers": ctx.globalAlpha = 0.5 + Math.sin(q.t * 6) * 0.4; ctx.fillStyle = q.s > 0.9 ? "#ffd27a" : "#ff7a2a"; ctx.fillRect(x, y, 1, 1); break;
        case "bubbles": ctx.globalAlpha = 0.5; ctx.strokeStyle = "#cff6ff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 1 + q.s * 1.5, 0, TAU); ctx.stroke(); break;
        case "rain": ctx.globalAlpha = 0.35; ctx.fillStyle = "#a8c8ff"; ctx.fillRect(x, y, 1, 4); break;
        case "sand": ctx.globalAlpha = 0.45; ctx.fillStyle = "#f0d8a0"; ctx.fillRect(x, y, 2, 1); break;
        case "sparkles": { const a = Math.max(0, Math.sin(q.t * 2.5)); ctx.globalAlpha = a; ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, 1, 1); if (a > 0.8) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } break; }
        case "spray": ctx.globalAlpha = 0.3; ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, 1, 1); break;
        default: ctx.globalAlpha = 0.25 + Math.sin(q.t) * 0.15; ctx.fillStyle = "#e8e0d0"; ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
};
