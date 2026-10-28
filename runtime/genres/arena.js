/* Arena survivor: hold out against escalating waves, collect XP, pick upgrades, beat the boss. */
(() => {
  const TS = 16, TD = CG.TD;

  class Arena {
    constructor(game, index, opts) {
      this.game = game;
      this.demo = !!opts.demo;
      this.defaultWeapon = "blaster";
      this.L = game.spec.levels[index] || game.spec.levels[0];
      this.diff = game.spec.rules.difficulty || 1;
      const rows = this.L.tiles && this.L.tiles.length ? this.L.tiles : makeArena(48, 36);
      this.grid = rows.map((r) => r.split(""));
      this.h = this.grid.length; this.w = Math.max(...this.grid.map((r) => r.length));
      for (const r of this.grid) while (r.length < this.w) r.push(".");
      this.pw = this.w * TS; this.ph = this.h * TS;
      this.solidFn = (tx, ty) => tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || this.grid[ty][tx] === "#";
      this.cam = new CG.Camera(game.W, game.H);
      this.cam.setBounds(0, 0, this.pw, this.ph);
      this.t = 0;
      this.initCombat();
      this.hpScale = 1 + index * 0.25;
      this.speedScale = 1 + index * 0.05;
      let sx = this.pw / 2, sy = this.ph / 2;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.grid[y][x] === "P") { sx = x * TS + 8; sy = y * TS + 8; this.grid[y][x] = "."; }
      this.player = this.makePlayer(sx, sy);
      this.cam.snap(sx, sy);
      this.duration = this.L.duration || 75;
      this.timeLeft = this.duration;
      this.waves = (this.L.waves || defaultWaves(game.spec.enemies.length, this.duration)).slice().sort((a, b) => a.t - b.t);
      this.waveIdx = 0;
      this.pending = [];
      this.carry = game.carry || {};
      this.xp = this.carry.xp || 0; this.lvl = this.carry.lvl || 1; this.xpNext = this.carry.xpNext || 5;
      this.choice = null;
      this.boss = null;
      this.done = false;
      this.trickle = 0;
      this.floorLayer = this.prerender();
      if (this.demo) for (let i = 0; i < 10; i++) this.enemies.push(TD.makeEnemy(this, i % game.spec.enemies.length, sx + Math.cos(i) * 120, sy + Math.sin(i) * 80));
    }

    prerender() {
      const g = this.game, T = g.theme, tiles = g.tiles;
      const c = g.gfx.makeCanvas(this.pw, this.ph), ctx = c.getContext("2d");
      const h = (x, y) => { let v = (x * 73856093) ^ (y * 19349663); v = (v ^ (v >>> 13)) * 1274126177; return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
      const wall = (x, y) => this.solidFn(x, y);
      const seed = (this.game.spec.seed || 0) + this.game.levelIndex * 7;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (!wall(x, y)) {
          if (tiles) {
            const n = CG.vnoise(x / 6, y / 6, seed);
            this.tileAt(ctx, 48 + (n > 0.62 ? 3 : n < 0.3 ? 2 : Math.floor(h(y, x) * 2)), x * TS, y * TS);
            if (h(x, y) < 0.05 + (n > 0.55 ? 0.08 : 0)) this.tileAt(ctx, 52 + Math.floor(h(x + 3, y) * 4), x * TS, y * TS);
          } else { ctx.fillStyle = (x + y) % 2 ? T.panel : CG.mix(T.panel, T.bg, 0.4); ctx.fillRect(x * TS, y * TS, TS, TS); }
        }
      }
      // organic light / shade patches at 4px granularity
      for (let y = 0; y < this.ph; y += 4) for (let x = 0; x < this.pw; x += 4) {
        const n = CG.vnoise(x / 70, y / 70, seed + 11) * 0.7 + CG.vnoise(x / 23, y / 23, seed + 5) * 0.3;
        if (n < 0.36) { ctx.fillStyle = "rgba(0,0,0,0.13)"; ctx.fillRect(x, y, 4, 4); }
        else if (n > 0.66) { ctx.fillStyle = "rgba(255,255,220,0.07)"; ctx.fillRect(x, y, 4, 4); }
      }
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (!wall(x, y)) continue;
        const m = (wall(x, y - 1) ? 0 : 1) | (wall(x + 1, y) ? 0 : 2) | (wall(x, y + 1) ? 0 : 4) | (wall(x - 1, y) ? 0 : 8);
        if (m & 4 && y + 1 < this.h) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x * TS, (y + 1) * TS, TS, 6); }
        if (tiles) this.tileAt(ctx, 32 + m, x * TS, y * TS);
        else { ctx.fillStyle = T.panelEdge; ctx.fillRect(x * TS, y * TS, TS, TS); ctx.fillStyle = T.shadow; ctx.fillRect(x * TS, y * TS + 11, TS, 5); }
      }
      return c;
    }
    tileAt(ctx, idx, x, y) { const t = this.game.tiles, cols = t.cols || 8, s = t.size || TS; ctx.drawImage(t.img, (idx % cols) * s, Math.floor(idx / cols) * s, s, s, x, y, TS, TS); }

    spawnEnemy(def, x, y) { const e = TD.makeEnemy(this, def, x, y); this.enemies.push(e); return e; }

    spawnAround(defIdx, count, pattern) {
      const p = this.player, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const R = Math.hypot(this.game.W, this.game.H) * 0.55;
      const base = Math.random() * TAU;
      for (let i = 0; i < count; i++) {
        let a, r = R + Math.random() * 30;
        if (pattern === "edge") a = base + (Math.random() - 0.5) * 0.9;
        else if (pattern === "cluster") { a = base; r += Math.random() * 40; }
        else a = (i / count) * TAU + base;
        let x = clamp(cx + Math.cos(a) * r, TS * 1.5, this.pw - TS * 1.5), y = clamp(cy + Math.sin(a) * r, TS * 1.5, this.ph - TS * 1.5);
        if (pattern === "cluster") { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; }
        if (this.solidFn(Math.floor(x / TS), Math.floor(y / TS))) continue;
        this.pending.push({ def: defIdx, x, y, t: 0.6 });
      }
    }

    update(dt) {
      const g = this.game;
      this.t += dt;
      if (this.choice) return this.updateChoice(dt);
      const p = this.player;
      if (p.dead) { this.updateDeath(dt); }
      else if (!this.done) {
        this.updatePlayerCore(dt);
        this.attack(dt, true);
      }
      if (!this.done && !p.dead) {
        if (this.timeLeft > 0) {
          this.timeLeft -= dt;
          const el = this.duration - this.timeLeft;
          while (this.waveIdx < this.waves.length && this.waves[this.waveIdx].t <= el) {
            const w = this.waves[this.waveIdx++];
            this.spawnAround(w.enemy % g.spec.enemies.length, Math.round((w.count || 5) * (0.75 + this.diff * 0.25)), w.pattern || "ring");
          }
          // background trickle grows with time
          this.trickle -= dt;
          const live = this.enemies.length;
          if (this.trickle <= 0 && live < 90) {
            this.trickle = Math.max(0.35, 2.2 - el / this.duration * 1.6) / (0.7 + this.diff * 0.3);
            this.spawnAround(Math.floor(Math.random() * Math.min(g.spec.enemies.length, 1 + Math.floor(el / 20))), 1 + Math.floor(el / 30), "edge");
          }
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            if (this.L.boss) this.spawnBoss();
            else this.finish();
          }
        }
      }
      for (const s of this.pending) s.t -= dt;
      for (const s of this.pending.filter((s) => s.t <= 0)) this.spawnEnemy(s.def, s.x, s.y);
      this.pending = this.pending.filter((s) => s.t > 0);
      for (const e of this.enemies) {
        if (this.demo) { e.t += dt; continue; }
        if (e.hp <= 0 && !e.dead) { this.killEnemy(e); continue; }
        TD.updateEnemy(this, e, dt);
        if (!p.dead && !e.dead && overlap(p, e)) this.hurtPlayer(e.dmg, p.x - e.x, p.y - e.y);
      }
      TD.separate(this.enemies, dt);
      this.enemies = this.enemies.filter((e) => !e.dead);
      if (this.boss) this.updateBoss(dt);
      this.updateShots(dt);
      this.updatePickups(dt);
      this.cam.follow(p.x + p.w / 2, p.y + p.h / 2, dt, 8);
      this.cam.update(dt);
    }

    finish() {
      const g = this.game;
      if (this.done) return;
      this.done = true;
      for (const e of this.enemies) { g.particles.burst(e.x + e.w / 2, e.y + e.h / 2, 8, { colors: g.theme.fx, speed: 80, life: 0.5 }); g.addScore(10); }
      this.enemies.length = 0; this.eshots.length = 0;
      g.carry.xp = this.xp; g.carry.lvl = this.lvl; g.carry.xpNext = this.xpNext; g.carry.stats = this.stats;
      g.carry.hp = this.player.hp; g.carry.maxHp = this.player.maxHp;
      g.levelComplete({ kills: this.kills, timeBonus: this.player.hp * 250 });
    }
    forceWin() { this.finish(); }

    onEnemyKilled(e, x, y) {
      const big = e.beh === "tank" || e.maxHp > 4;
      this.pickups.push({ kind: "xp", x, y, v: big ? 3 : 1, t: 0 });
      if (Math.random() < 0.015 + (big ? 0.05 : 0)) this.pickups.push({ kind: "heart", x: x + 4, y, t: 0 });
      if (Math.random() < 0.01) this.pickups.push({ kind: "magnet", x: x - 4, y, t: 0 });
    }

    updatePickups(dt) {
      const g = this.game, p = this.player, S = this.stats;
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      const R = 34 * S.magnet;
      for (const it of this.pickups) {
        it.t += dt;
        const d = dist(px, py, it.x, it.y);
        if (it.pull || d < R) {
          const a = angleTo(it.x, it.y, px, py), sp = it.pull ? 320 : 200 + (R - d) * 4;
          it.x += Math.cos(a) * sp * dt; it.y += Math.sin(a) * sp * dt;
        }
        if (d < 8 && !p.dead) {
          it.taken = true;
          if (it.kind === "xp") { this.gainXp(it.v); g.audio.play("coin", { vol: 0.35, pitch: 1.2 + Math.random() * 0.3, gap: 0.02 }); }
          else if (it.kind === "heart") { p.hp = Math.min(p.maxHp, p.hp + 1); g.audio.play("powerup"); g.floaters.add("+1 HP", px, py - 10, g.theme.danger); }
          else if (it.kind === "magnet") { for (const q of this.pickups) q.pull = true; g.audio.play("powerup", { pitch: 0.8 }); }
        }
      }
      this.pickups = this.pickups.filter((it) => !it.taken);
    }

    gainXp(v) {
      this.xp += v;
      g_score(this.game, v);
      if (this.xp >= this.xpNext) {
        this.xp -= this.xpNext;
        this.lvl++;
        this.xpNext = Math.round(this.xpNext * 1.32 + 2);
        this.openChoice();
      }
    }

    openChoice() {
      const g = this.game;
      const pool = TD.UPGRADES.filter((u) => !(u.ranged && this.weapon.melee));
      const picks = [];
      while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      this.choice = { picks, idx: 0, t: 0 };
      g.audio.play("powerup");
      g.gfx.flash(g.theme.accent, 0.3);
    }

    updateChoice(dt) {
      const g = this.game, inp = g.input, c = this.choice;
      c.t += dt;
      if (inp.pressed("left") || inp.pressed("up")) { c.idx = (c.idx + 2) % 3; g.audio.play("select", { vol: 0.5 }); }
      if (inp.pressed("right") || inp.pressed("down")) { c.idx = (c.idx + 1) % 3; g.audio.play("select", { vol: 0.5 }); }
      if (inp.mouse.active) {
        const i = this.cardAt(inp.mouse.x, inp.mouse.y);
        if (i >= 0) c.idx = i;
      }
      if (c.t > 0.35 && (inp.pressed("a") || inp.pressed("start") || inp.pressedNow.fire || inp.pressed("b"))) {
        const u = c.picks[c.idx];
        if (!u) { this.choice = null; return; }
        u.apply(this.stats, this.player);
        g.floaters.add(u.name.toUpperCase(), this.player.x + 5, this.player.y - 12, g.theme.accent, { scale: 1 });
        g.audio.play("powerup", { pitch: 1.2 });
        this.choice = null;
        this.player.inv = Math.max(this.player.inv, 0.8);
      }
    }

    cardLayout() {
      const W = this.game.W, H = this.game.H, cw = 120, ch = 82, gap = 12;
      const x0 = W / 2 - (cw * 3 + gap * 2) / 2;
      return [0, 1, 2].map((i) => ({ x: x0 + i * (cw + gap), y: H / 2 - ch / 2 + 6, w: cw, h: ch }));
    }
    cardAt(mx, my) { return this.cardLayout().findIndex((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h); }

    spawnBoss() {
      const g = this.game;
      const def = g.spec.boss || { name: "Overlord", hp: 30 };
      const spr = g.sprites[def.sprite || "boss"];
      const p = this.player;
      const a = Math.random() * TAU;
      const size = spr ? Math.min(spr.fw, spr.fh) * 0.75 : 28;
      const hp = (def.hp || 30) * 4 * (0.7 + this.diff * 0.3) * (1 + this.game.levelIndex * 0.3);
      this.boss = { def, spr, x: clamp(p.x + Math.cos(a) * 150, 40, this.pw - 60), y: clamp(p.y + Math.sin(a) * 110, 40, this.ph - 60), w: size, h: size, vx: 0, vy: 0, hp, maxHp: hp, t: 0, timer: 2, state: "intro", flash: 0, face: 1, active: true, boss: true };
      this.bossWarn = 2.5;
      g.audio.playMusic(g.spec.audio.music.boss ? "boss" : "main", 0.5);
      this.cam.shake(0.5);
    }

    updateBoss(dt) {
      const b = this.boss, g = this.game, p = this.player;
      if (this.bossWarn) this.bossWarn = Math.max(0, this.bossWarn - dt);
      b.t += dt; b.flash = Math.max(0, b.flash - dt);
      if (b.dead) {
        b.deadT += dt;
        if (Math.random() < 0.5) g.particles.burst(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 6, { colors: g.theme.fx, speed: 120, life: 0.5, glow: true });
        if (b.deadT > 1.5) { g.gfx.flash("#fff", 0.8); this.cam.shake(0.8); g.audio.play("explode"); g.addScore(5000); this.boss = null; this.finish(); }
        return;
      }
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, px = p.x + p.w / 2, py = p.y + p.h / 2;
      const a = angleTo(cx, cy, px, py);
      const enraged = b.hp < b.maxHp * 0.5;
      b.timer -= dt * (enraged ? 1.4 : 1);
      if (b.state === "intro") { if (b.timer <= 0) { b.state = "chase"; b.timer = 2; } }
      else if (b.state === "chase") {
        b.vx = damp(b.vx, Math.cos(a) * 40, 3, dt); b.vy = damp(b.vy, Math.sin(a) * 40, 3, dt);
        if (b.timer <= 0) { const r = Math.random(); b.state = r < 0.35 ? "burst" : r < 0.65 ? "spiral" : r < 0.85 ? "tell" : "summon"; b.timer = b.state === "spiral" ? 2.2 : 0.6; b.k = 0; }
      } else if (b.state === "burst") {
        b.vx *= 0.9; b.vy *= 0.9;
        if (b.timer <= 0) {
          const n = enraged ? 20 : 14;
          for (let i = 0; i < n; i++) this.enemyShot(cx, cy, (i / n) * TAU + b.t, 90, { size: 4 });
          g.audio.play("shoot", { pitch: 0.6 });
          b.k++; b.timer = 0.45;
          if (b.k >= (enraged ? 3 : 2)) { b.state = "chase"; b.timer = 1.6; }
        }
      } else if (b.state === "spiral") {
        b.vx *= 0.9; b.vy *= 0.9;
        b.k += dt;
        if (b.k > 0.08) { b.k = 0; for (let i = 0; i < (enraged ? 3 : 2); i++) this.enemyShot(cx, cy, b.t * 4 + (i * TAU) / (enraged ? 3 : 2), 100, { size: 3 }); }
        if (b.timer <= 0) { b.state = "chase"; b.timer = 1.6; }
      } else if (b.state === "tell") {
        b.vx = 0; b.vy = 0;
        if (b.timer <= 0) { b.state = "charge"; b.timer = 0.7; b.cx = Math.cos(a); b.cy = Math.sin(a); g.audio.play("dash"); }
      } else if (b.state === "charge") {
        b.vx = b.cx * 260; b.vy = b.cy * 260;
        if (b.timer <= 0) { b.state = "chase"; b.timer = 1.5; this.cam.shake(0.3); }
      } else if (b.state === "summon") {
        b.vx *= 0.9; b.vy *= 0.9;
        if (b.timer <= 0) {
          for (let i = 0; i < 5; i++) this.pending.push({ def: i % g.spec.enemies.length, x: cx + Math.cos((i / 5) * TAU) * 30, y: cy + Math.sin((i / 5) * TAU) * 30, t: 0.4 });
          g.audio.play("powerup", { pitch: 0.5 });
          b.state = "chase"; b.timer = 2;
        }
      }
      if (Math.abs(b.vx) > 3) b.face = sign(b.vx);
      TD.move(b, dt, this.solidFn);
      if (!p.dead && overlap(p, b)) this.hurtPlayer(1, px - cx, py - cy);
    }

    damageBoss(dmg) {
      const b = this.boss, g = this.game;
      if (!b || b.dead || b.state === "intro") return;
      const d = dmg * this.stats.dmgMul;
      b.hp -= d; b.flash = 0.08;
      g.audio.play("hit", { vol: 0.5, pitch: 0.7 });
      if (b.hp <= 0) { b.dead = true; b.deadT = 0; this.eshots.length = 0; g.audio.stopMusic(1); g.stats.kills++; }
    }

    // ---------- drawing ----------
    draw(gfx) {
      const g = this.game, ctx = gfx.ctx, T = g.theme, cam = this.cam;
      const vx = cam.vx, vy = cam.vy;
      ctx.fillStyle = T.shadow; ctx.fillRect(0, 0, gfx.W, gfx.H);
      ctx.drawImage(this.floorLayer, vx, vy, gfx.W, gfx.H, 0, 0, gfx.W, gfx.H);
      for (const s of this.pending) {
        const k = 1 - s.t / 0.6;
        ctx.globalAlpha = 0.6; gfx.ring(s.x - vx, s.y - vy, 10 - k * 6, T.danger, 1); ctx.globalAlpha = 1;
      }
      for (const it of this.pickups) {
        const x = it.x - vx, y = it.y - vy + Math.sin(this.t * 6 + it.x) * 1;
        if (it.kind === "xp") {
          const c = it.v > 1 ? T.accent2 : T.accent;
          ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 2.5, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 2.5, y); ctx.fill();
          gfx.rect(x - 0.5, y - 1.5, 1, 1, "#fff");
        } else if (it.kind === "heart") g.drawHearts(x - 3, y - 3, 1, 1);
        else { gfx.circle(x, y, 4, T.gold); gfx.text("M", x - 2, y - 3, { color: T.shadow }); }
      }
      const actors = this.enemies.slice().sort((a, b) => a.y + a.h - (b.y + b.h));
      for (const e of actors) TD.drawEnemy(this, gfx, e, vx, vy);
      if (this.boss) {
        const b = this.boss;
        TD.drawShadow(gfx, b.x + b.w / 2 - vx, b.y + b.h - vy, b.w * 0.5);
        if (b.state === "tell") gfx.text("!", b.x + b.w / 2 - vx, b.y - vy - 16, { color: T.danger, outline: "#000", align: "center", scale: 2 });
        g.drawActor(b.spr, b.x + b.w / 2 - vx + (b.dead ? (Math.random() - 0.5) * 4 : 0), b.y + b.h - vy + 3, { state: "walk", t: b.t, flip: b.face > 0, flash: b.flash > 0, color: T.danger });
      }
      this.drawPlayerTD(gfx, vx, vy);
      this.drawCombatFx(gfx, vx, vy);
      g.particles.draw(ctx, vx, vy);
      g.floaters.draw(gfx, vx, vy);
      // vignette
      if (!this._vig) {
        this._vig = gfx.makeCanvas(gfx.W, gfx.H);
        const v = this._vig.getContext("2d"), gr = v.createRadialGradient(gfx.W / 2, gfx.H / 2, gfx.H * 0.35, gfx.W / 2, gfx.H / 2, gfx.W * 0.65);
        gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.5)");
        v.fillStyle = gr; v.fillRect(0, 0, gfx.W, gfx.H);
      }
      ctx.drawImage(this._vig, 0, 0);
      if (this.choice) this.drawChoice(gfx);
    }

    drawChoice(gfx) {
      const g = this.game, T = g.theme, c = this.choice;
      gfx.ctx.fillStyle = CG.rgba(T.shadow, 0.65); gfx.ctx.fillRect(0, 0, gfx.W, gfx.H);
      gfx.text(`LEVEL ${this.lvl}!`, gfx.W / 2, gfx.H / 2 - 64, { align: "center", scale: 2, color: T.gold, outline: T.shadow });
      gfx.text("CHOOSE AN UPGRADE", gfx.W / 2, gfx.H / 2 - 44, { align: "center", color: T.text });
      this.cardLayout().forEach((r, i) => {
        const u = c.picks[i];
        if (!u) return;
        const sel = i === c.idx;
        const k = CG.ease.outBack(clamp(c.t * 3 - i * 0.2, 0, 1));
        const y = r.y + (1 - k) * 40 - (sel ? 4 : 0);
        g.gfx.panel(r.x, y, r.w, r.h, T, sel ? 1 : 0.8);
        if (sel) { gfx.ctx.strokeStyle = T.accent; gfx.ctx.lineWidth = 1; gfx.ctx.strokeRect(r.x + 0.5, y + 0.5, r.w - 1, r.h - 1); }
        gfx.text(u.name.toUpperCase(), r.x + r.w / 2, y + 12, { align: "center", color: sel ? T.accent : T.text });
        g.gfx.wrap(u.desc, r.w - 14).forEach((l, j) => gfx.text(l, r.x + r.w / 2, y + 34 + j * 10, { align: "center", color: T.textDim }));
      });
    }

    hud(gfx) {
      const g = this.game, T = g.theme;
      const tl = this.boss ? "BOSS" : CG.formatTime(this.timeLeft).slice(0, -3);
      g.drawHud({ hp: this.player.hp, maxHp: this.player.maxHp, lives: g.lives, counters: [{ value: this.kills + " KO", color: T.textDim }], center: tl, centerColor: this.timeLeft < 10 && !this.boss ? T.danger : T.text });
      gfx.bar(4, gfx.H - 6, gfx.W - 8, 3, this.xp / this.xpNext, T.accent, CG.rgba(T.shadow, 0.6));
      gfx.text(`LV ${this.lvl}`, 5, gfx.H - 16, { color: T.accent, outline: T.shadow });
      if (this.boss && !this.boss.dead) {
        gfx.text((this.boss.def.name || "BOSS").toUpperCase(), gfx.W / 2, 20, { align: "center", color: T.text, outline: T.shadow });
        gfx.bar(gfx.W / 2 - 90, 30, 180, 5, this.boss.hp / this.boss.maxHp, T.danger);
      }
      if (this.bossWarn) {
        gfx.ctx.globalAlpha = Math.min(1, this.bossWarn);
        gfx.text("WARNING", gfx.W / 2, gfx.H * 0.3, { align: "center", scale: 3, color: T.danger, outline: T.shadow });
        gfx.ctx.globalAlpha = 1;
      }
    }

    demoUpdate(dt) {
      this.t += dt;
      const p = this.player;
      for (const e of this.enemies) {
        e.t += dt;
        const a = this.t * 0.4 + e.orbitA;
        e.x = p.x + Math.cos(a) * (70 + Math.sin(e.t) * 20); e.y = p.y + Math.sin(a) * (50 + Math.cos(e.t) * 10); e.face = Math.cos(a) > 0 ? -1 : 1;
      }
      p.t += dt; p.state = "run"; p.face = Math.sin(this.t * 0.5) > 0 ? 1 : -1;
      this.cam.snap(p.x, p.y);
    }
    drawDemo(gfx) { this.draw(gfx); }
  }
  Object.assign(Arena.prototype, TD.Combat);
  const g_score = (game, v) => { game.score += v; };

  function makeArena(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      let r = "";
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const pillar = (x % 12 === 6 && y % 9 === 4) || (x % 12 === 7 && y % 9 === 4);
        r += edge || pillar ? "#" : ".";
      }
      rows.push(r);
    }
    return rows;
  }

  function defaultWaves(nEnemies, duration) {
    const out = [];
    for (let t = 2; t < duration; t += 9) out.push({ t, enemy: Math.floor(t / 15) % nEnemies, count: 4 + Math.floor(t / 10), pattern: ["ring", "edge", "cluster"][Math.floor(t / 9) % 3] });
    return out;
  }

  CG.defineGenre("arena", {
    create: (game, i, opts) => new Arena(game, i, opts),
    controls: [["Move", "Arrows / WASD"], ["Dodge roll", "Space / Z"], ["Aim (optional)", "Mouse / right stick"], ["Fire", "Automatic"], ["Pick upgrade", "Left/Right + Space"]],
  });
})();
