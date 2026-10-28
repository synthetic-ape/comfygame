/* Graphics: low-res pixel buffer, scaling to the window, sprites, bitmap font, panels, post effects. */

// Classic 5x7 font, columns bit0 = top row, ASCII 32..126.
const FONT5x7 =
  "0000000000" + "00005f0000" + "0007000700" + "147f147f14" + "242a7f2a12" + "2313086462" + "3649552250" + "0005030000" +
  "001c224100" + "0041221c00" + "082a1c2a08" + "08083e0808" + "0050300000" + "0808080808" + "0060600000" + "2010080402" +
  "3e5149453e" + "00427f4000" + "4261514946" + "2141454b31" + "1814127f10" + "2745454539" + "3c4a494930" + "0171090503" +
  "3649494936" + "064949291e" + "0036360000" + "0056360000" + "0008142241" + "1414141414" + "4122140800" + "0201510906" +
  "324979413e" + "7e1111117e" + "7f49494936" + "3e41414122" + "7f4141221c" + "7f49494941" + "7f09090101" + "3e41415132" +
  "7f0808087f" + "00417f4100" + "2040413f01" + "7f08142241" + "7f40404040" + "7f0204027f" + "7f0408107f" + "3e4141413e" +
  "7f09090906" + "3e4151215e" + "7f09192946" + "4649494931" + "01017f0101" + "3f4040403f" + "1f2040201f" + "7f2018207f" +
  "6314081463" + "0304780403" + "6151494543" + "007f414100" + "0204081020" + "0041417f00" + "0402010204" + "4040404040" +
  "0001020400" + "2054545478" + "7f48444438" + "3844444420" + "384444487f" + "3854545418" + "087e090102" + "081454543c" +
  "7f08040478" + "00447d4000" + "2040443d00" + "007f102844" + "00417f4000" + "7c04180478" + "7c08040478" + "3844444438" +
  "7c14141408" + "081414187c" + "7c08040408" + "4854545420" + "043f444020" + "3c4040207c" + "1c2040201c" + "3c4030403c" +
  "4428102844" + "0c5050503c" + "4464544c44" + "0008364100" + "00007f0000" + "0041360800" + "08082a1c08";

CG.Gfx = class Gfx {
  constructor(spec) {
    const res = (spec.style && spec.style.resolution) || [480, 270];
    this.W = res[0] | 0;
    this.H = res[1] | 0;
    this.display = document.createElement("canvas");
    this.display.id = "cg-screen";
    document.body.appendChild(this.display);
    this.dctx = this.display.getContext("2d");
    this.buf = this.makeCanvas(this.W, this.H);
    this.ctx = this.buf.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.crt = !!(spec.style && spec.style.crt);
    this.bgColor = (spec.style && spec.style.letterbox) || "#05050a";
    this.fontCache = {};
    this.flashCache = new Map();
    this.flashAlpha = 0;
    this.flashColor = "#fff";
    this._buildFont();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ww = window.innerWidth, wh = window.innerHeight;
    this.display.width = Math.floor(ww * dpr);
    this.display.height = Math.floor(wh * dpr);
    this.display.style.width = ww + "px";
    this.display.style.height = wh + "px";
    const fit = Math.min(this.display.width / this.W, this.display.height / this.H);
    // Integer scaling keeps pixels perfectly square; use it unless it would waste more than ~12% of the screen.
    this.scale = fit >= 2 && (fit - Math.floor(fit)) / fit < 0.12 ? Math.floor(fit) : fit;
    this.ox = Math.floor((this.display.width - this.W * this.scale) / 2);
    this.oy = Math.floor((this.display.height - this.H * this.scale) / 2);
    this.dctx.imageSmoothingEnabled = false;
    this._scanlines = null;
    this._vignette = null;
    if (this.onResize) this.onResize();
  }

  present(input) {
    const d = this.dctx;
    d.fillStyle = this.bgColor;
    d.fillRect(0, 0, this.display.width, this.display.height);
    d.imageSmoothingEnabled = false;
    d.drawImage(this.buf, this.ox, this.oy, this.W * this.scale, this.H * this.scale);
    if (this.flashAlpha > 0.01) {
      d.globalAlpha = this.flashAlpha;
      d.fillStyle = this.flashColor;
      d.fillRect(this.ox, this.oy, this.W * this.scale, this.H * this.scale);
      d.globalAlpha = 1;
    }
    if (this.crt && this.scale >= 2) {
      if (!this._scanlines) {
        const c = this.makeCanvas(this.W * this.scale, this.H * this.scale), x = c.getContext("2d");
        x.fillStyle = "rgba(0,0,0,0.22)";
        const step = Math.max(2, Math.round(this.scale));
        for (let y = 0; y < c.height; y += step) x.fillRect(0, y + step - Math.max(1, step >> 2), c.width, Math.max(1, step >> 2));
        const g = x.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.35, c.width / 2, c.height / 2, c.height * 0.85);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.45)");
        x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
        this._scanlines = c;
      }
      d.drawImage(this._scanlines, this.ox, this.oy);
    }
    if (input) {
      input.view = { scale: this.scale, ox: this.ox, oy: this.oy, w: this.W, h: this.H };
      input.drawTouch(d);
    }
  }

  flash(color = "#fff", alpha = 0.6) { this.flashColor = color; this.flashAlpha = Math.max(this.flashAlpha, alpha); }
  update(dt) { this.flashAlpha = Math.max(0, this.flashAlpha - dt * 3.5); }

  // ---------- images & sprites ----------
  static loadImage(src) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => { console.warn("[ComfyGame] image failed to load"); res(null); };
      img.src = src;
    });
  }

  // White silhouette of an image, for hit flashes.
  silhouette(img, color = "#ffffff") {
    const key = img;
    let m = this.flashCache.get(key);
    if (!m) { m = {}; this.flashCache.set(key, m); }
    if (!m[color]) {
      const c = this.makeCanvas(img.width, img.height), x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = "source-in";
      x.fillStyle = color;
      x.fillRect(0, 0, c.width, c.height);
      m[color] = c;
    }
    return m[color];
  }

  // Draw frame `f` of sprite `spr` anchored at its foot (bottom-center).
  sprite(spr, f, x, y, o = {}) {
    if (!spr || !spr.img) return;
    const ctx = o.ctx || this.ctx;
    const fw = spr.fw, fh = spr.fh, cols = spr.cols || spr.frames || 1;
    const frame = ((f | 0) % (spr.frames || 1) + (spr.frames || 1)) % (spr.frames || 1);
    const sx = (frame % cols) * fw, sy = Math.floor(frame / cols) * fh;
    const scale = o.scale || 1, sxs = (o.sx || 1) * scale, sys = (o.sy || 1) * scale;
    const ax = o.anchorX != null ? o.anchorX : 0.5, ay = o.anchorY != null ? o.anchorY : 1;
    const img = o.flash ? this.silhouette(spr.img, o.flashColor || "#ffffff") : spr.img;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.translate(Math.round(x), Math.round(y));
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.flip ? -sxs : sxs, sys);
    ctx.drawImage(img, sx, sy, fw, fh, -fw * ax, -fh * ay, fw, fh);
    ctx.restore();
  }

  // ---------- font ----------
  _buildFont() {
    const n = FONT5x7.length / 10;
    const c = this.makeCanvas(n * 6, 8), x = c.getContext("2d");
    x.fillStyle = "#fff";
    for (let i = 0; i < n; i++) {
      for (let col = 0; col < 5; col++) {
        const bits = parseInt(FONT5x7.substr(i * 10 + col * 2, 2), 16);
        for (let row = 0; row < 8; row++) if (bits & (1 << row)) x.fillRect(i * 6 + col, row, 1, 1);
      }
    }
    this.fontWhite = c;
  }

  _fontFor(color) {
    if (!this.fontCache[color]) {
      const c = this.makeCanvas(this.fontWhite.width, this.fontWhite.height), x = c.getContext("2d");
      x.drawImage(this.fontWhite, 0, 0);
      x.globalCompositeOperation = "source-in";
      x.fillStyle = color;
      x.fillRect(0, 0, c.width, c.height);
      this.fontCache[color] = c;
    }
    return this.fontCache[color];
  }

  textWidth(str, scale = 1) { return Math.max(0, String(str).length * 6 - 1) * scale; }

  _glyphs(ctx, str, x, y, color, scale, wave, time) {
    const atlas = this._fontFor(color);
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      if (code < 32 || code > 126) code = 63;
      const oy = wave ? Math.round(Math.sin(time * 6 + i * 0.6) * wave) : 0;
      ctx.drawImage(atlas, (code - 32) * 6, 0, 5, 8, x + i * 6 * scale, y + oy, 5 * scale, 8 * scale);
    }
  }

  text(str, x, y, o = {}) {
    const ctx = o.ctx || this.ctx;
    str = String(str);
    const scale = o.scale || 1, color = o.color || "#ffffff";
    const w = this.textWidth(str, scale);
    let tx = Math.round(o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x);
    const ty = Math.round(y);
    if (o.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]])
        this._glyphs(ctx, str, tx + dx * Math.max(1, scale >> 1), ty + dy * Math.max(1, scale >> 1), o.outline, scale, o.wave, o.time);
    }
    if (o.shadow) this._glyphs(ctx, str, tx + Math.max(1, scale >> 1), ty + Math.max(1, scale >> 1) + (o.outline ? 1 : 0), o.shadow, scale, o.wave, o.time);
    this._glyphs(ctx, str, tx, ty, color, scale, o.wave, o.time);
    return w;
  }

  // Word-wrap to a pixel width; returns lines.
  wrap(str, maxW, scale = 1) {
    const words = String(str).split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (this.textWidth(t, scale) > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---------- primitives ----------
  rect(x, y, w, h, color, ctx = this.ctx) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  circle(x, y, r, color, ctx = this.ctx) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), Math.max(0.5, r), 0, TAU); ctx.fill(); }
  ring(x, y, r, color, width = 1, ctx = this.ctx) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(Math.round(x), Math.round(y), Math.max(0.5, r), 0, TAU); ctx.stroke(); }

  // Pixel panel with a 1px bevel; colors come from the game theme.
  panel(x, y, w, h, theme, alpha = 0.92) {
    const ctx = this.ctx;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    ctx.save();
    ctx.globalAlpha = alpha;
    this.rect(x + 2, y + 2, w, h, "rgba(0,0,0,0.45)");
    this.rect(x + 1, y, w - 2, h, theme.panelEdge);
    this.rect(x, y + 1, w, h - 2, theme.panelEdge);
    this.rect(x + 1, y + 1, w - 2, h - 2, theme.panel);
    this.rect(x + 2, y + 1, w - 4, 1, theme.panelLight);
    ctx.restore();
  }

  bar(x, y, w, h, frac, fg, bg = "rgba(0,0,0,0.5)", edge = "#000") {
    this.rect(x - 1, y - 1, w + 2, h + 2, edge);
    this.rect(x, y, w, h, bg);
    this.rect(x, y, Math.max(0, Math.round(w * clamp(frac, 0, 1))), h, fg);
    this.rect(x, y, Math.max(0, Math.round(w * clamp(frac, 0, 1))), 1, "rgba(255,255,255,0.35)");
  }

  // Ordered-dither vertical gradient, cached per size/colors (used when no background art exists).
  gradient(colors, w, h) {
    const key = colors.join(",") + w + "x" + h;
    this._grad = this._grad || {};
    if (this._grad[key]) return this._grad[key];
    const c = this.makeCanvas(w, h), x = c.getContext("2d");
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const rgb = colors.map(CG.hexToRgb);
    const img = x.createImageData(w, h);
    for (let py = 0; py < h; py++) {
      const t = (py / Math.max(1, h - 1)) * (rgb.length - 1);
      for (let px = 0; px < w; px++) {
        const th = bayer[(py & 3) * 4 + (px & 3)] / 16;
        const i0 = Math.min(rgb.length - 1, Math.floor(t + th * 0.999));
        const col = rgb[clamp(i0, 0, rgb.length - 1)];
        const o = (py * w + px) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    this._grad[key] = c;
    return c;
  }
};
