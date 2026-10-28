/* Game shell: asset loading, theme, the fixed-step loop, menus and the level flow shared by every genre. */
const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];

CG.Game = class Game {
  constructor(spec) {
    this.spec = CG.normalizeSpec(spec);
    this.gfx = new CG.Gfx(this.spec);
    this.W = this.gfx.W; this.H = this.gfx.H;
    this.input = new CG.Input(this.gfx.display);
    this.audio = new CG.Audio();
    this.theme = CG.makeTheme(this.spec);
    this.particles = new CG.Particles();
    this.floaters = new CG.Floaters();
    this.transition = new CG.Transition();
    this.tweens = new CG.Tweens();
    this.timers = new CG.Timers();
    this.sprites = {};
    this.backgrounds = {};
    this.tiles = null;
    this.time = 0;
    this.scene = "loading";
    this.menuIndex = 0;
    this.levelIndex = 0;
    this.world = null;
    this.hitstop = 0;
    this.mods = [];
    this.toast = null;
    this.saveKey = "cg.save." + (this.spec.id || this.spec.title);
    this.best = CG.store.get(this.saveKey, { hiscore: 0, reached: 0 });
    this.genre = CG.genres[this.spec.genre];
    if (!this.genre) throw new Error(`Unknown genre "${this.spec.genre}"`);
  }

  async load() {
    const A = this.spec.assets || {};
    const jobs = [];
    for (const [key, s] of Object.entries(A.sprites || {})) {
      jobs.push(CG.Gfx.loadImage(s.src).then((img) => {
        if (!img) return;
        const frames = s.frames || 1, cols = s.cols || frames;
        this.sprites[key] = { img, fw: s.fw || img.width / cols, fh: s.fh || img.height / Math.ceil(frames / cols), frames, cols, anims: s.anims || {}, key };
      }));
    }
    for (const [key, layers] of Object.entries(A.backgrounds || {})) {
      this.backgrounds[key] = [];
      layers.forEach((L, i) => jobs.push(CG.Gfx.loadImage(L.src).then((img) => { if (img) this.backgrounds[key][i] = Object.assign({}, L, { img }); })));
    }
    if (A.tiles && A.tiles.src) {
      jobs.push(CG.Gfx.loadImage(A.tiles.src).then((img) => { if (img) this.tiles = Object.assign({}, A.tiles, { img }); }));
    }
    await Promise.all(jobs);
    for (const k in this.backgrounds) this.backgrounds[k] = this.backgrounds[k].filter(Boolean);
    const au = this.spec.audio || {};
    for (const [k, src] of Object.entries(au.sfx || {})) this.audio.load("sfx:" + k, src);
    for (const [k, m] of Object.entries(au.music || {})) {
      if (!m) continue;
      if (m.loopEnd) this.audio.loops["music:" + k] = [m.loopStart || 0, m.loopEnd];
      this.audio.load("music:" + k, typeof m === "string" ? m : m.src);
    }
    for (const [k, src] of Object.entries(au.jingles || {})) this.audio.load("jingle:" + k, src);
    this._loadMods();
  }

  _loadMods() {
    const api = CG.modApi(this);
    for (const src of this.spec.scripts || []) {
      try {
        const hooks = new Function("CG", "game", "api", '"use strict";\n' + src)(CG, this, api);
        if (hooks && typeof hooks === "object") this.mods.push(hooks);
      } catch (e) {
        console.error("[ComfyGame] script error", e);
        this.showToast("Script error: " + e.message);
      }
    }
  }

  // Call a hook on every mod; a failing mod is dropped instead of crashing the game.
  emit(hook, ...args) {
    for (const m of this.mods.slice()) {
      if (typeof m[hook] !== "function") continue;
      try { m[hook](...args); } catch (e) {
        console.error("[ComfyGame] script hook failed", hook, e);
        this.showToast(`Script ${hook}: ${e.message}`);
        this.mods.splice(this.mods.indexOf(m), 1);
      }
    }
  }

  showToast(msg, dur = 3) { this.toast = { msg: String(msg).slice(0, 70), t: dur }; }

  start() {
    this.scene = "title";
    this.menuIndex = 0;
    this.titleWorld = null;
    try { this.titleWorld = this.genre.create(this, 0, { demo: true }); } catch (e) { console.warn("[ComfyGame] title demo unavailable", e); }
    this.transition.in(0.6);
    let last = performance.now(), acc = 0;
    const STEP = 1 / 60;
    const frame = (now) => {
      try {
        acc += Math.min(0.1, (now - last) / 1000);
        last = now;
        let steps = 0;
        while (acc >= STEP && steps < 5) { this.step(STEP); acc -= STEP; steps++; }
        if (steps === 5) acc = 0;
        this.draw();
        this.gfx.present(this.input);
        requestAnimationFrame(frame);
      } catch (e) {
        this.crash(e);
      }
    };
    requestAnimationFrame(frame);
  }

  crash(e) {
    console.error(e);
    const d = this.gfx.dctx;
    d.fillStyle = "#200810"; d.fillRect(0, 0, this.gfx.display.width, this.gfx.display.height);
    d.fillStyle = "#ff8899"; d.font = "16px monospace";
    const lines = ["ComfyGame crashed:", String(e && e.message || e), ...(String(e && e.stack || "").split("\n").slice(1, 8))];
    lines.forEach((l, i) => d.fillText(l.slice(0, 120), 20, 40 + i * 22));
  }

  // ---------------- loop ----------------
  step(dt) {
    this.time += dt;
    this.input.poll(this.time);
    const inp = this.input;
    if (inp.anyPressed) this.audio.unlock();
    if (inp.pressed("mute")) { const m = this.audio.toggleMute(); this.showToast(m ? "Sound off" : "Sound on", 1.2); }
    if (inp.pressed("fullscreen")) this.toggleFullscreen();
    this.transition.update(dt);
    this.tweens.update(dt);
    this.gfx.update(dt);
    if (this.toast) { this.toast.t -= dt; if (this.toast.t <= 0) this.toast = null; }
    if (!this.transition.busy || this.transition.dir === -1) this.updateScene(dt);
    else if (this.scene === "play" && this.world) this.world.update(dt * 0.25);
    this.input.endStep();
  }

  updateScene(dt) {
    const inp = this.input;
    switch (this.scene) {
      case "title": {
        if (this.titleWorld && this.titleWorld.demoUpdate) this.titleWorld.demoUpdate(dt);
        this.particles.update(dt);
        const items = this.titleItems();
        this.menuNav(items.length);
        if (inp.confirm()) {
          this.audio.unlock();
          const it = items[this.menuIndex];
          this.audio.play("select");
          if (it.id === "start") this.newGame(0);
          else if (it.id === "continue") this.newGame(Math.min(this.best.reached, this.spec.levels.length - 1));
          else if (it.id === "controls") { this.scene = "controls"; }
          else if (it.id === "sound") { this.audio.toggleMute(); }
        }
        if (this.audio.ctx && !this.audio.musicKey && !this.audio.muted) this.audio.playMusic(this.spec.audio.music.title ? "title" : "main", 1.5);
        break;
      }
      case "controls":
        if (inp.confirm() || inp.back()) { this.audio.play("select"); this.scene = "title"; }
        break;
      case "intro":
        this.introT += dt;
        if (inp.confirm() || inp.pressed("pause")) {
          const full = this.introText().length;
          if (this.introT * 40 < full) this.introT = full / 40 + 1;
          else this.go(() => this.beginLevel(this.levelIndex));
        }
        break;
      case "play":
        if (inp.pressed("pause") || inp.pressed("start")) { this.scene = "pause"; this.menuIndex = 0; this.audio.duck(true); this.audio.play("select"); break; }
        if (this.hitstop > 0) { this.hitstop -= dt; break; }
        this.levelTime += dt;
        this.world.update(dt);
        this.emit("onUpdate", dt, this.world);
        this.particles.update(dt);
        this.floaters.update(dt);
        this.timers.update(dt);
        if (this.banner) { this.banner.t += dt; if (this.banner.t > 2.6) this.banner = null; }
        break;
      case "pause": {
        const items = this.pauseItems();
        this.menuNav(items.length);
        if (inp.pressed("pause") || inp.back()) { this.scene = "play"; this.audio.duck(false); break; }
        if (inp.confirm()) {
          const id = items[this.menuIndex].id;
          this.audio.play("select");
          if (id === "resume") { this.scene = "play"; this.audio.duck(false); }
          else if (id === "restart") { this.audio.duck(false); this.go(() => this.beginLevel(this.levelIndex)); }
          else if (id === "sound") this.audio.toggleMute();
          else if (id === "quit") { this.audio.duck(false); this.go(() => this.toTitle()); }
        }
        break;
      }
      case "clearing":
        this.timers.update(dt);
        this.particles.update(dt);
        this.floaters.update(dt);
        if (this.world.celebrate) this.world.celebrate(dt);
        break;
      case "clear":
        this.clearT += dt;
        this.particles.update(dt);
        if (this.clearT > 0.8 && inp.confirm()) {
          this.audio.play("select");
          const next = this.levelIndex + 1;
          if (next >= this.spec.levels.length) this.go(() => this.toVictory());
          else this.go(() => this.beginLevel(next));
        }
        break;
      case "gameover": {
        this.overT += dt;
        const items = [{ id: "retry" }, { id: "quit" }];
        this.menuNav(items.length);
        if (this.overT > 1 && inp.confirm()) {
          this.audio.play("select");
          if (this.menuIndex === 0) { this.lives = this.spec.rules.lives; this.score = this.levelStartScore; this.go(() => this.beginLevel(this.levelIndex)); }
          else this.go(() => this.toTitle());
        }
        break;
      }
      case "victory":
        this.victoryT += dt;
        this.particles.update(dt);
        if (Math.random() < 0.25) this.fireworks();
        if (this.victoryT > 2 && inp.confirm()) this.go(() => this.toTitle());
        break;
    }
  }

  menuNav(n) {
    const inp = this.input;
    if (inp.pressed("up")) { this.menuIndex = (this.menuIndex + n - 1) % n; this.audio.play("select", { vol: 0.5 }); }
    if (inp.pressed("down")) { this.menuIndex = (this.menuIndex + 1) % n; this.audio.play("select", { vol: 0.5 }); }
  }

  go(fn) { if (!this.transition.busy) this.transition.out(fn); }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch (e) { /* not allowed in this frame */ }
  }

  // ---------------- flow ----------------
  titleItems() {
    const items = [{ id: "start", label: "START GAME" }];
    if (this.best.reached > 0 && this.spec.levels.length > 1) items.push({ id: "continue", label: `CONTINUE  (${this.best.reached + 1}/${this.spec.levels.length})` });
    items.push({ id: "controls", label: "CONTROLS" });
    items.push({ id: "sound", label: this.audio.muted ? "SOUND: OFF" : "SOUND: ON" });
    return items;
  }
  pauseItems() {
    return [
      { id: "resume", label: "RESUME" }, { id: "restart", label: "RESTART LEVEL" },
      { id: "sound", label: this.audio.muted ? "SOUND: OFF" : "SOUND: ON" }, { id: "quit", label: "QUIT TO TITLE" },
    ];
  }

  newGame(level) {
    this.score = 0;
    this.lives = this.spec.rules.lives;
    this.stats = { coins: 0, kills: 0, deaths: 0, time: 0, gems: 0 };
    this.carry = {};
    this.levelIndex = level;
    this.audio.stopMusic(0.5);
    if (level === 0 && this.introText()) this.go(() => { this.scene = "intro"; this.introT = 0; });
    else this.go(() => this.beginLevel(level));
  }

  introText() { return (this.spec.text && this.spec.text.intro) || ""; }

  beginLevel(i) {
    this.levelIndex = i;
    this.levelStartScore = this.score;
    this.particles.clear();
    this.floaters.list.length = 0;
    this.timers.clear();
    this.levelTime = 0;
    this.hitstop = 0;
    this.world = this.genre.create(this, i, {});
    this.scene = "play";
    const L = this.spec.levels[i] || {};
    this.banner = { t: 0, title: L.name || `LEVEL ${i + 1}`, sub: `${this.levelLabel()} ${i + 1}/${this.spec.levels.length}` };
    const music = L.boss && this.spec.audio.music.boss ? "boss" : "main";
    this.audio.playMusic(music, 0.8);
    this.emit("onLevelStart", i, this.world);
  }

  levelLabel() { return ({ platformer: "WORLD", dungeon: "FLOOR", arena: "WAVE", shmup: "STAGE" })[this.spec.genre] || "LEVEL"; }

  addScore(n, x, y) {
    this.score += n;
    if (x != null) this.floaters.add("+" + n, x, y, this.theme.gold);
  }

  levelComplete(extra = {}) {
    if (this.scene !== "play") return;
    this.stats.time += this.levelTime;
    const bonus = Math.max(0, Math.round((extra.timeBonus || 0)));
    this.score += bonus;
    this.clearInfo = Object.assign({ time: this.levelTime, bonus }, extra);
    this.best.reached = Math.max(this.best.reached, Math.min(this.levelIndex + 1, this.spec.levels.length - 1));
    this.best.hiscore = Math.max(this.best.hiscore, this.score);
    CG.store.set(this.saveKey, this.best);
    this.emit("onLevelComplete", this.levelIndex, this.world);
    this.audio.stopMusic(0.3);
    this.audio.jingle("win");
    this.timers.after(0.9, () => { this.scene = "clear"; this.clearT = 0; });
    this.scene = "clearing";
  }

  // Returns true if the run continues (a life was available).
  playerDied() {
    this.stats.deaths++;
    this.lives--;
    this.emit("onPlayerDeath", this.world);
    if (this.lives <= 0) {
      this.audio.stopMusic(0.4);
      this.audio.jingle("lose");
      this.scene = "gameover"; this.overT = 0; this.menuIndex = 0;
      this.best.hiscore = Math.max(this.best.hiscore, this.score);
      CG.store.set(this.saveKey, this.best);
      return false;
    }
    return true;
  }

  toTitle() {
    this.world = null;
    this.audio.stopMusic(0.5);
    this.scene = "title";
    this.menuIndex = 0;
    this.particles.clear();
  }

  toVictory() {
    this.scene = "victory";
    this.victoryT = 0;
    this.world = null;
    this.particles.clear();
    this.best.hiscore = Math.max(this.best.hiscore, this.score);
    CG.store.set(this.saveKey, this.best);
    this.audio.playMusic(this.spec.audio.music.title ? "title" : "main", 1);
    this.emit("onVictory");
  }

  fireworks() {
    const pal = this.theme.fx;
    const x = 40 + Math.random() * (this.W - 80), y = 30 + Math.random() * (this.H * 0.5);
    this.particles.burst(x, y, 26, { colors: [pal[(Math.random() * pal.length) | 0], "#ffffff"], speed: 120, life: 1.1, g: 60, drag: 1.5, size: 2, glow: true });
  }

  // ---------------- drawing ----------------
  draw() {
    const g = this.gfx, ctx = g.ctx, T = this.theme;
    ctx.globalAlpha = 1;
    switch (this.scene) {
      case "title": this.drawTitle(); break;
      case "controls": this.drawTitleBackdrop(); this.drawControls(); break;
      case "intro": this.drawIntro(); break;
      case "play": case "clearing":
        this.world.draw(g);
        this.emit("draw", g, this.world);
        this.world.hud && this.world.hud(g);
        this.drawBanner();
        break;
      case "pause": this.world.draw(g); this.world.hud && this.world.hud(g); this.drawPause(); break;
      case "clear": this.world.draw(g); this.drawClear(); break;
      case "gameover": this.world ? this.world.draw(g) : g.rect(0, 0, this.W, this.H, T.bg); this.drawGameOver(); break;
      case "victory": this.drawVictory(); break;
      default: g.rect(0, 0, this.W, this.H, "#000");
    }
    if (this.toast) {
      const w = g.textWidth(this.toast.msg) + 12;
      g.panel(this.W / 2 - w / 2, this.H - 24, w, 15, T, 0.9);
      g.text(this.toast.msg, this.W / 2, this.H - 20, { align: "center", color: T.text });
    }
    this.transition.draw(g, T.shadow);
  }

  drawTitleBackdrop() {
    const g = this.gfx;
    if (this.titleWorld && this.titleWorld.drawDemo) this.titleWorld.drawDemo(g, this.time);
    else g.ctx.drawImage(g.gradient(this.theme.sky, this.W, this.H), 0, 0);
    g.ctx.fillStyle = CG.rgba(this.theme.shadow, 0.35);
    g.ctx.fillRect(0, 0, this.W, this.H);
  }

  drawTitle() {
    const g = this.gfx, T = this.theme, t = this.time;
    this.drawTitleBackdrop();
    this.particles.draw(g.ctx, 0, 0);
    const title = (this.spec.title || "UNTITLED").toUpperCase();
    let scale = 4;
    while (scale > 1 && g.textWidth(title, scale) > this.W - 24) scale--;
    const ty = this.H * 0.2 + Math.sin(t * 1.6) * 3;
    g.text(title, this.W / 2, ty, { scale, align: "center", color: T.titleColor, outline: T.shadow, shadow: T.accent2, wave: scale >= 3 ? 1.5 : 0, time: t });
    if (this.spec.tagline) {
      const lines = g.wrap(this.spec.tagline, this.W - 60);
      lines.slice(0, 2).forEach((l, i) => g.text(l, this.W / 2, ty + scale * 8 + 10 + i * 10, { align: "center", color: T.textDim, outline: T.shadow }));
    }
    const items = this.titleItems();
    const my = this.H * 0.58;
    items.forEach((it, i) => {
      const sel = i === this.menuIndex;
      const y = my + i * 14;
      if (sel) {
        const w = g.textWidth(it.label) + 20;
        g.panel(this.W / 2 - w / 2, y - 3, w, 13, T, 0.85);
        g.text(">", this.W / 2 - w / 2 + 3 + Math.round(Math.sin(t * 8)), y, { color: T.accent });
      }
      g.text(it.label, this.W / 2, y, { align: "center", color: sel ? T.text : T.textDim, outline: sel ? null : T.shadow });
    });
    if (this.best.hiscore > 0) g.text(`HI ${CG.pad(this.best.hiscore, 7)}`, this.W / 2, this.H - 24, { align: "center", color: T.gold, outline: T.shadow });
    if (!this.audio.ctx || this.audio.ctx.state !== "running") {
      if (Math.floor(t * 2) % 2 === 0) g.text("PRESS ENTER / TAP TO START", this.W / 2, this.H - 12, { align: "center", color: T.text, outline: T.shadow });
    } else {
      g.text("made with ComfyGame", this.W / 2, this.H - 11, { align: "center", color: T.textDim, outline: T.shadow });
    }
  }

  drawControls() {
    const g = this.gfx, T = this.theme;
    const rows = (this.genre.controls || []).concat([["Pause", "Esc / P"], ["Mute", "M"], ["Fullscreen", "F"]]);
    const w = 300, h = 34 + rows.length * 13;
    const x = this.W / 2 - w / 2, y = this.H / 2 - h / 2;
    g.panel(x, y, w, h, T);
    g.text("CONTROLS", this.W / 2, y + 8, { align: "center", color: T.accent, scale: 1 });
    rows.forEach((r, i) => {
      g.text(r[0], x + 14, y + 26 + i * 13, { color: T.textDim });
      g.text(r[1], x + w - 14, y + 26 + i * 13, { color: T.text, align: "right" });
    });
  }

  drawIntro() {
    const g = this.gfx, T = this.theme;
    g.rect(0, 0, this.W, this.H, T.shadow);
    const full = this.introText();
    const shown = full.slice(0, Math.floor(this.introT * 40));
    const lines = g.wrap(shown, this.W - 80);
    const y0 = this.H / 2 - (g.wrap(full, this.W - 80).length * 12) / 2;
    lines.forEach((l, i) => g.text(l, 40, y0 + i * 12, { color: T.text }));
    if (shown.length >= full.length && Math.floor(this.time * 2) % 2 === 0) g.text("PRESS START", this.W - 20, this.H - 16, { align: "right", color: T.accent });
  }

  drawBanner() {
    if (!this.banner) return;
    const g = this.gfx, T = this.theme, b = this.banner;
    const k = b.t < 0.4 ? CG.ease.outBack(b.t / 0.4) : b.t > 2.1 ? 1 - CG.ease.inQuad((b.t - 2.1) / 0.5) : 1;
    const w = Math.max(g.textWidth(b.title, 2), g.textWidth(b.sub)) + 30;
    const x = lerp(-w, this.W / 2 - w / 2, k), y = this.H * 0.3;
    g.panel(x, y, w, 34, T, 0.92);
    g.text(b.sub, x + w / 2, y + 5, { align: "center", color: T.accent });
    g.text(b.title.toUpperCase(), x + w / 2, y + 16, { align: "center", color: T.text, scale: 2 });
  }

  drawPause() {
    const g = this.gfx, T = this.theme;
    g.ctx.fillStyle = CG.rgba(T.shadow, 0.55);
    g.ctx.fillRect(0, 0, this.W, this.H);
    const items = this.pauseItems();
    const w = 160, h = 30 + items.length * 14;
    const x = this.W / 2 - w / 2, y = this.H / 2 - h / 2;
    g.panel(x, y, w, h, T);
    g.text("PAUSED", this.W / 2, y + 8, { align: "center", color: T.accent });
    items.forEach((it, i) => {
      const sel = i === this.menuIndex;
      g.text((sel ? "> " : "  ") + it.label, x + 18, y + 24 + i * 14, { color: sel ? T.text : T.textDim });
    });
  }

  drawClear() {
    const g = this.gfx, T = this.theme, c = this.clearInfo || {};
    g.ctx.fillStyle = CG.rgba(T.shadow, 0.5);
    g.ctx.fillRect(0, 0, this.W, this.H);
    const w = 220, h = 118, x = this.W / 2 - w / 2, y = this.H / 2 - h / 2;
    const k = CG.ease.outBack(clamp(this.clearT / 0.4, 0, 1));
    g.ctx.save();
    g.ctx.translate(this.W / 2, this.H / 2); g.ctx.scale(k, k); g.ctx.translate(-this.W / 2, -this.H / 2);
    g.panel(x, y, w, h, T);
    g.text(this.levelIndex + 1 >= this.spec.levels.length ? "FINAL LEVEL CLEAR!" : "LEVEL CLEAR!", this.W / 2, y + 9, { align: "center", color: T.accent, scale: 1 });
    const rows = [["TIME", CG.formatTime(c.time || 0)]];
    if (c.coins != null) rows.push(["COINS", `${c.coins}${c.coinsTotal ? " / " + c.coinsTotal : ""}`]);
    if (c.gems != null) rows.push(["GEMS", `${c.gems} / ${c.gemsTotal || 3}`]);
    if (c.kills != null) rows.push(["DEFEATED", String(c.kills)]);
    if (c.bonus) rows.push(["BONUS", "+" + c.bonus]);
    rows.push(["SCORE", CG.pad(this.score, 7)]);
    rows.forEach((r, i) => {
      if (this.clearT < 0.35 + i * 0.12) return;
      g.text(r[0], x + 20, y + 28 + i * 12, { color: T.textDim });
      g.text(r[1], x + w - 20, y + 28 + i * 12, { color: T.text, align: "right" });
    });
    if (this.clearT > 0.8 && Math.floor(this.time * 2) % 2 === 0) g.text("PRESS START", this.W / 2, y + h - 14, { align: "center", color: T.accent });
    g.ctx.restore();
  }

  drawGameOver() {
    const g = this.gfx, T = this.theme;
    g.ctx.fillStyle = CG.rgba(T.shadow, clamp(this.overT, 0, 0.75));
    g.ctx.fillRect(0, 0, this.W, this.H);
    const k = clamp(this.overT / 0.6, 0, 1);
    g.text("GAME OVER", this.W / 2, lerp(-20, this.H * 0.3, CG.ease.outBounce(k)), { align: "center", scale: 3, color: T.danger, outline: T.shadow });
    g.text(`SCORE ${CG.pad(this.score, 7)}`, this.W / 2, this.H * 0.3 + 34, { align: "center", color: T.text, outline: T.shadow });
    if (this.overT > 1) {
      ["TRY AGAIN", "QUIT TO TITLE"].forEach((l, i) => {
        const sel = i === this.menuIndex;
        g.text((sel ? "> " : "  ") + l, this.W / 2 - 40, this.H * 0.6 + i * 14, { color: sel ? T.text : T.textDim, outline: T.shadow });
      });
    }
  }

  drawVictory() {
    const g = this.gfx, T = this.theme, t = this.victoryT;
    this.drawTitleBackdrop();
    this.particles.draw(g.ctx, 0, 0);
    g.text("VICTORY!", this.W / 2, 24, { align: "center", scale: 3, color: T.gold, outline: T.shadow, wave: 1.5, time: this.time });
    const ending = (this.spec.text && this.spec.text.ending) || "You did it!";
    g.wrap(ending, this.W - 80).slice(0, 4).forEach((l, i) => g.text(l, this.W / 2, 62 + i * 11, { align: "center", color: T.text, outline: T.shadow }));
    const s = this.stats || { coins: 0, kills: 0, deaths: 0, time: 0 };
    const rows = [["FINAL SCORE", CG.pad(this.score, 7)], ["TIME", CG.formatTime(s.time)], ["DEATHS", String(s.deaths)]];
    if (s.coins) rows.push(["COINS", String(s.coins)]);
    if (s.kills) rows.push(["DEFEATED", String(s.kills)]);
    const y0 = 118;
    rows.forEach((r, i) => {
      if (t < 0.5 + i * 0.25) return;
      g.text(r[0], this.W / 2 - 90, y0 + i * 12, { color: T.textDim, outline: T.shadow });
      g.text(r[1], this.W / 2 + 90, y0 + i * 12, { color: T.text, align: "right", outline: T.shadow });
    });
    if (this.score >= this.best.hiscore && this.score > 0 && Math.floor(this.time * 3) % 2 === 0) g.text("NEW HIGH SCORE!", this.W / 2, y0 + rows.length * 12 + 6, { align: "center", color: T.gold, outline: T.shadow });
    g.text(`${this.spec.title}  -  made with ComfyGame`, this.W / 2, this.H - 24, { align: "center", color: T.textDim, outline: T.shadow });
    if (t > 2 && Math.floor(this.time * 2) % 2 === 0) g.text("PRESS START", this.W / 2, this.H - 12, { align: "center", color: T.accent, outline: T.shadow });
  }

  // ---------------- shared helpers for genres ----------------
  anim(spr, name, t, fallback = "idle") {
    if (!spr) return 0;
    const a = spr.anims[name] || spr.anims[fallback];
    if (!a || !a.frames || !a.frames.length) return 0;
    const fps = a.fps || 8;
    const n = a.frames.length;
    const i = a.loop === false ? Math.min(n - 1, Math.floor(t * fps)) : Math.floor(t * fps) % n;
    return a.frames[i];
  }

  // Draw an actor sprite with procedural squash/stretch so single-frame (AI) art still feels alive.
  drawActor(spr, x, y, o = {}) {
    const g = this.gfx;
    if (!spr) { g.rect(x - 6, y - 12, 12, 12, o.color || this.theme.accent); return; }
    const state = o.state || "idle";
    let frame = this.anim(spr, state, o.t || 0);
    let sx = o.sx || 1, sy = o.sy || 1, rot = o.rot || 0, oy = 0;
    if (spr.frames <= 1 || !spr.anims[state]) {
      const t = o.t || 0;
      if (state === "idle") { sy *= 1 + Math.sin(t * 4) * 0.035; sx *= 1 - Math.sin(t * 4) * 0.02; }
      else if (state === "run" || state === "walk" || state === "move") { oy = -Math.abs(Math.sin(t * 12)) * 2; rot += Math.sin(t * 12) * 0.06; }
      else if (state === "jump") { sy *= 1.06; sx *= 0.95; }
      else if (state === "fall") { sy *= 0.97; sx *= 1.03; }
      else if (state === "fly") { oy = Math.sin(t * 6) * 2; }
      else if (state === "hurt") { rot += Math.sin(t * 40) * 0.15; }
    }
    g.sprite(spr, frame, x, y + oy, { flip: o.flip, sx, sy, rot, scale: o.scale, alpha: o.alpha, flash: o.flash, flashColor: o.flashColor, anchorY: o.anchorY });
  }

  drawHearts(x, y, hp, max) {
    const g = this.gfx, T = this.theme;
    for (let i = 0; i < max; i++) {
      const full = i < hp;
      const px = x + i * 9;
      for (let r = 0; r < HEART.length; r++) for (let c = 0; c < 7; c++) {
        if (HEART[r][c] !== "1") continue;
        g.rect(px + c, y + r, 1, 1, full ? (r === 1 && c === 1 ? "#ffffff" : T.danger) : CG.rgba(T.shadow, 0.6));
      }
    }
  }

  drawParallax(key, camX, camY, worldH) {
    const g = this.gfx, ctx = g.ctx;
    const layers = this.backgrounds[key] || this.backgrounds.main;
    if (!layers || !layers.length) { ctx.drawImage(g.gradient(this.theme.sky, this.W, this.H), 0, 0); return; }
    for (const L of layers) {
      const img = L.img, f = L.parallax != null ? L.parallax : 0.5;
      const scroll = (L.scroll || 0) * this.time;
      let ox = -((camX * f + scroll) % img.width);
      if (ox > 0) ox -= img.width;
      // vertical parallax: layers stay anchored to the bottom of the screen with a little drift
      const range = Math.max(0, (worldH || this.H) - this.H);
      const vy = range > 0 ? (camY / range - 0.5) * 20 * f : 0;
      const y = Math.round(L.fill ? 0 : this.H - img.height - vy + (L.y || 0));
      if (L.fill) { ctx.drawImage(img, 0, 0, this.W, this.H); continue; }
      for (let x = ox; x < this.W; x += img.width) ctx.drawImage(img, Math.round(x), y);
    }
  }

  // Shared HUD strip: hearts, counters, score.
  drawHud(o) {
    const g = this.gfx, T = this.theme;
    g.ctx.fillStyle = CG.rgba(T.shadow, 0.35);
    g.ctx.fillRect(0, 0, this.W, 15);
    let x = 5;
    if (o.hp != null) { this.drawHearts(x, 4, o.hp, o.maxHp); x += o.maxHp * 9 + 8; }
    if (o.lives != null) { g.text(`x${o.lives}`, x, 4, { color: T.text }); x += 26; }
    for (const c of o.counters || []) {
      if (c.icon && this.sprites[c.icon]) g.sprite(this.sprites[c.icon], 0, x + 4, 13, { scale: c.iconScale || 0.75 });
      else g.rect(x + 1, 5, 6, 6, c.color || T.gold);
      g.text(String(c.value), x + 11, 4, { color: c.color || T.text });
      x += 20 + g.textWidth(String(c.value));
    }
    g.text(CG.pad(this.score, 7), this.W - 5, 4, { color: T.text, align: "right" });
    if (o.center) g.text(o.center, this.W / 2, 4, { color: o.centerColor || T.text, align: "center" });
  }
};

// Fill in everything a genre relies on so partial / AI-written specs still run.
CG.normalizeSpec = (spec) => {
  const s = Object.assign({}, spec);
  s.style = Object.assign({ resolution: [480, 270], palette: [] }, s.style || {});
  s.rules = Object.assign({ lives: 3, difficulty: 1 }, s.rules || {});
  s.audio = Object.assign({ sfx: {}, music: {}, jingles: {} }, s.audio || {});
  s.audio.music = s.audio.music || {};
  s.text = s.text || {};
  s.player = Object.assign({ hp: 3 }, s.player || {});
  s.enemies = s.enemies && s.enemies.length ? s.enemies : [{ id: "e0", behavior: "walker" }];
  s.levels = s.levels && s.levels.length ? s.levels : [{ name: "Level 1" }];
  s.assets = s.assets || {};
  return s;
};

CG.makeTheme = (spec) => {
  const pal = (spec.style.palette || []).filter(Boolean);
  const sorted = pal.slice().sort((a, b) => CG.luma(a) - CG.luma(b));
  const dark = sorted[0] || "#14101c", light = sorted[sorted.length - 1] || "#f4f0e6";
  const sat = pal.slice().sort((a, b) => {
    const s = (h) => { const [r, g, b2] = CG.hexToRgb(h); return Math.max(r, g, b2) - Math.min(r, g, b2); };
    return s(b) - s(a);
  });
  const st = spec.style || {};
  const accent = st.accent || sat[0] || "#ffcc33";
  const accent2 = st.accent2 || sat[1] || "#ff5577";
  return {
    palette: pal,
    bg: st.bg || CG.mix(dark, "#000000", 0.2),
    shadow: CG.mix(dark, "#000000", 0.45),
    panel: CG.mix(dark, accent, 0.12),
    panelEdge: CG.mix(light, accent, 0.25),
    panelLight: CG.rgba(light, 0.3),
    text: CG.luma(light) > 0.6 ? light : "#f4f0e6",
    textDim: CG.mix(CG.luma(light) > 0.6 ? light : "#f4f0e6", dark, 0.42),
    accent, accent2,
    titleColor: st.titleColor || CG.mix(accent, "#ffffff", 0.25),
    gold: st.gold || "#ffd23f",
    danger: st.danger || "#ff4d5e",
    good: st.good || "#5dff8a",
    sky: st.sky || [CG.mix(dark, accent2, 0.35), CG.mix(dark, accent, 0.25), dark],
    fx: [accent, accent2, "#ffd23f", light],
  };
};

// The small, stable API handed to user / AI scripts (see docs/SCRIPTING.md).
CG.modApi = (game) => ({
  get world() { return game.world; },
  get player() { return game.world && game.world.player; },
  get enemies() { return (game.world && game.world.enemies) || []; },
  get time() { return game.levelTime || 0; },
  get level() { return game.levelIndex; },
  W: game.W, H: game.H,
  addScore: (n, x, y) => game.addScore(n, x, y),
  shake: (a) => game.world && game.world.cam && game.world.cam.shake(a),
  flash: (c, a) => game.gfx.flash(c, a),
  sound: (name, o) => game.audio.play(name, o),
  text: (s, x, y, o) => game.gfx.text(s, x, y, o),
  float: (s, x, y, c) => game.floaters.add(s, x, y, c),
  burst: (x, y, n, o) => game.particles.burst(x, y, n, o),
  spawnEnemy: (type, x, y) => game.world && game.world.spawnEnemy && game.world.spawnEnemy(type, x, y),
  toast: (m) => game.showToast(m),
  after: (sec, fn) => game.timers.after(sec, fn),
  every: (sec, fn) => game.timers.every(sec, fn),
  rand: (a, b) => (b == null ? Math.random() * (a == null ? 1 : a) : a + Math.random() * (b - a)),
  sprite: (key) => game.sprites[key],
  draw: (key, frame, x, y, o) => game.gfx.sprite(game.sprites[key], frame, x, y, o),
  theme: game.theme,
  win: () => game.world && game.world.forceWin && game.world.forceWin(),
  hurtPlayer: (n) => game.world && game.world.hurtPlayer && game.world.hurtPlayer(n || 1),
});

CG.boot = async (spec) => {
  try {
    if (spec.code) new Function("CG", '"use strict";\n' + spec.code)(CG);
    const game = new CG.Game(spec);
    CG.game = game;
    await game.load();
    game.start();
    const hint = document.getElementById("cg-loading");
    if (hint) hint.remove();
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#f89;background:#200;padding:20px;white-space:pre-wrap;font:14px monospace">ComfyGame failed to start:\n${String(e && e.stack || e)}</pre>`;
  }
};
