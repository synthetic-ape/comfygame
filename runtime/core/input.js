/* Input: keyboard, gamepad, mouse and on-screen touch controls, unified into actions. */
CG.Input = class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keymap = {
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      Space: "a", KeyZ: "a", KeyK: "a",
      KeyX: "b", KeyJ: "b",
      ShiftLeft: "c", ShiftRight: "c", KeyC: "c", KeyL: "c",
      Escape: "pause", KeyP: "pause", Enter: "start",
      KeyM: "mute", KeyF: "fullscreen",
    };
    this.actions = ["left", "right", "up", "down", "a", "b", "c", "pause", "start", "mute", "fullscreen"];
    this.keys = {};
    this.latch = {};
    this.cur = {};
    this.prev = {};
    this.pressedNow = {};
    this.mouse = { x: 0, y: 0, down: false, active: false, lastMove: -10 };
    this.touch = { enabled: false, points: new Map(), held: {}, stick: { x: 0, y: 0, id: null, ox: 0, oy: 0 } };
    this.gamepad = { connected: false, held: {}, ax: 0, ay: 0, rx: 0, ry: 0 };
    this.lastDevice = "keyboard";
    this.anyLatch = false;
    this.time = 0;
    this.view = { scale: 1, ox: 0, oy: 0, w: 480, h: 270 };
    this._bind();
  }

  _bind() {
    window.addEventListener("keydown", (e) => {
      const act = this.keymap[e.code];
      if (act) {
        if (!this.keys[e.code]) this.latch[act] = true;
        this.keys[e.code] = true;
        e.preventDefault();
      }
      this.anyLatch = true;
      this.lastDevice = "keyboard";
    });
    window.addEventListener("keyup", (e) => { this.keys[e.code] = false; });
    window.addEventListener("blur", () => { this.keys = {}; });
    const c = this.canvas;
    const toGame = (cx, cy) => {
      const r = c.getBoundingClientRect();
      const px = (cx - r.left) * (c.width / r.width), py = (cy - r.top) * (c.height / r.height);
      return { x: (px - this.view.ox) / this.view.scale, y: (py - this.view.oy) / this.view.scale, px, py };
    };
    c.addEventListener("mousemove", (e) => {
      const p = toGame(e.clientX, e.clientY);
      this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.active = true; this.mouse.lastMove = this.time;
    });
    c.addEventListener("mousedown", (e) => {
      if (e.button === 0) { this.mouse.down = true; this.latch.fire = true; }
      this.anyLatch = true; this.lastDevice = "mouse";
    });
    window.addEventListener("mouseup", () => { this.mouse.down = false; });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    const touchHandler = (e) => {
      e.preventDefault();
      this.touch.enabled = true;
      this.lastDevice = "touch";
      if (e.type === "touchstart") this.anyLatch = true;
      const pts = this.touch.points;
      const seen = new Set();
      for (const t of e.touches) {
        const p = toGame(t.clientX, t.clientY);
        seen.add(t.identifier);
        if (!pts.has(t.identifier)) pts.set(t.identifier, { sx: p.px, sy: p.py });
        const rec = pts.get(t.identifier);
        rec.px = p.px; rec.py = p.py;
      }
      for (const id of [...pts.keys()]) if (!seen.has(id)) pts.delete(id);
      this._layoutTouch();
    };
    for (const ev of ["touchstart", "touchmove", "touchend", "touchcancel"]) c.addEventListener(ev, touchHandler, { passive: false });
    window.addEventListener("gamepadconnected", () => { this.gamepad.connected = true; });
  }

  // Touch layout lives in display pixels so buttons stay finger-sized at any game resolution.
  touchLayout() {
    const W = this.canvas.width, H = this.canvas.height;
    const u = Math.min(W, H) / 6;
    return {
      stick: { x: u * 1.3, y: H - u * 1.3, r: u * 0.9 },
      buttons: [
        { act: "a", label: "A", x: W - u * 1.0, y: H - u * 1.1, r: u * 0.55 },
        { act: "b", label: "B", x: W - u * 2.15, y: H - u * 0.75, r: u * 0.48 },
        { act: "c", label: "C", x: W - u * 1.9, y: H - u * 1.95, r: u * 0.42 },
      ],
      pause: { act: "pause", x: W - u * 0.5, y: u * 0.5, r: u * 0.32 },
    };
  }

  _layoutTouch() {
    const L = this.touchLayout();
    const held = {};
    const st = this.touch.stick;
    let stickFound = false;
    for (const [id, p] of this.touch.points) {
      for (const b of [...L.buttons, L.pause]) {
        if (Math.hypot(p.px - b.x, p.py - b.y) < b.r * 1.25) held[b.act] = true;
      }
      if (p.sx < this.canvas.width * 0.45) {
        stickFound = true;
        if (st.id !== id) { st.id = id; st.ox = p.sx; st.oy = p.sy; }
        const dx = p.px - st.ox, dy = p.py - st.oy, m = Math.hypot(dx, dy), R = L.stick.r * 0.7;
        st.x = m > 6 ? (dx / Math.max(m, R)) : 0;
        st.y = m > 6 ? (dy / Math.max(m, R)) : 0;
      }
    }
    if (!stickFound) { st.id = null; st.x = st.y = 0; }
    for (const a in held) if (held[a] && !this.touch.held[a]) this.latch[a] = true;
    this.touch.held = held;
  }

  _pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    const g = this.gamepad;
    g.held = {};
    if (!gp) { g.ax = g.ay = g.rx = g.ry = 0; return; }
    g.connected = true;
    const btn = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    const dz = (v) => (Math.abs(v) < 0.22 ? 0 : v);
    g.ax = dz(gp.axes[0] || 0); g.ay = dz(gp.axes[1] || 0);
    g.rx = dz(gp.axes[2] || 0); g.ry = dz(gp.axes[3] || 0);
    const h = g.held;
    h.a = btn(0); h.c = btn(1) || btn(5) || btn(7); h.b = btn(2) || btn(4) || btn(6); h.start = btn(9);
    h.pause = btn(9) || btn(8);
    h.left = btn(14) || g.ax < -0.4; h.right = btn(15) || g.ax > 0.4;
    h.up = btn(12) || g.ay < -0.5; h.down = btn(13) || g.ay > 0.5;
    if (Object.values(h).some(Boolean) || g.rx || g.ry) this.lastDevice = "gamepad";
  }

  // Called at the start of every fixed update step.
  poll(time) {
    this.time = time;
    this._pollGamepad();
    for (const a of this.actions) {
      this.prev[a] = this.cur[a];
      let held = !!(this.gamepad.held[a] || this.touch.held[a]);
      if (!held) for (const code in this.keys) if (this.keys[code] && this.keymap[code] === a) { held = true; break; }
      this.cur[a] = held;
      this.pressedNow[a] = !!this.latch[a] || (held && !this.prev[a]);
    }
    const st = this.touch.stick;
    if (st.id !== null) {
      this.cur.left = this.cur.left || st.x < -0.35; this.cur.right = this.cur.right || st.x > 0.35;
      this.cur.up = this.cur.up || st.y < -0.45; this.cur.down = this.cur.down || st.y > 0.45;
    }
    this.pressedNow.fire = !!this.latch.fire;
    this.anyPressed = this.anyLatch || Object.keys(this.latch).length > 0;
    if (this.mouse.active && time - this.mouse.lastMove > 4 && !this.mouse.down) this.mouse.active = false;
  }
  endStep() { this.latch = {}; this.anyLatch = false; }

  down(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.pressedNow[a]; }
  // Menu confirm accepts the usual suspects.
  confirm() { return this.pressed("a") || this.pressed("start") || this.pressedNow.fire; }
  back() { return this.pressed("b") || this.pressed("pause"); }

  axis() {
    let x = 0, y = 0;
    if (this.cur.left) x -= 1;
    if (this.cur.right) x += 1;
    if (this.cur.up) y -= 1;
    if (this.cur.down) y += 1;
    const g = this.gamepad;
    if (Math.abs(g.ax) > 0.22 || Math.abs(g.ay) > 0.22) { x = g.ax; y = g.ay; }
    const st = this.touch.stick;
    if (st.id !== null && (st.x || st.y)) { x = st.x; y = st.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  // Aim direction from right stick or mouse (relative to a point in game space), or null.
  aim(fromX, fromY) {
    const g = this.gamepad;
    if (Math.abs(g.rx) > 0.3 || Math.abs(g.ry) > 0.3) return { x: g.rx, y: g.ry, firing: true };
    if (this.mouse.active || this.mouse.down) {
      const dx = this.mouse.x - fromX, dy = this.mouse.y - fromY, m = Math.hypot(dx, dy) || 1;
      return { x: dx / m, y: dy / m, firing: this.mouse.down };
    }
    return null;
  }

  drawTouch(ctx) {
    if (!this.touch.enabled) return;
    const L = this.touchLayout();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, L.stick.r * 0.05);
    const st = this.touch.stick;
    const sx = st.id !== null ? st.ox : L.stick.x, sy = st.id !== null ? st.oy : L.stick.y;
    ctx.beginPath(); ctx.arc(sx, sy, L.stick.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(sx + st.x * L.stick.r * 0.6, sy + st.y * L.stick.r * 0.6, L.stick.r * 0.38, 0, TAU); ctx.fill();
    ctx.font = `bold ${Math.round(L.buttons[0].r * 0.7)}px monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const b of [...L.buttons, L.pause]) {
      ctx.globalAlpha = this.touch.held[b.act] ? 0.75 : 0.4;
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillText(b.label || "II", b.x, b.y + 1);
    }
    ctx.restore();
  }
};
