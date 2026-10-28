/* Dungeon crawler: torch-lit floors, keys and chests, traps, a minimap, and a boss on the last floor. */
(() => {
  const TS = 16, TD = CG.TD;

  class Dungeon {
    constructor(game, index, opts) {
      this.game = game;
      this.demo = !!opts.demo;
      this.defaultWeapon = "sword";
      this.L = game.spec.levels[index] || game.spec.levels[0];
      this.diff = game.spec.rules.difficulty || 1;
      const rows = this.L.tiles && this.L.tiles.length ? this.L.tiles : DEFAULT;
      this.grid = rows.map((r) => r.split(""));
      this.h = this.grid.length; this.w = Math.max(...this.grid.map((r) => r.length));
      for (const r of this.grid) while (r.length < this.w) r.push(" ");
      this.pw = this.w * TS; this.ph = this.h * TS;
      this.solidFn = (tx, ty) => { if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true; const c = this.grid[ty][tx]; return c === "#" || c === " " || c === "t"; };
      this.cam = new CG.Camera(game.W, game.H);
      this.cam.setBounds(0, 0, this.pw, this.ph);
      this.t = 0;
      this.initCombat();
      this.hpScale = 1 + index * 0.3;
      this.chests = []; this.traps = []; this.torches = [];
      this.hasKey = false; this.gold = 0;
      this.seen = new Uint8Array(this.w * this.h);
      this.boss = null;
      this.done = false;
      let sx = 40, sy = 40;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const c = this.grid[y][x], px = x * TS + 8, py = y * TS + 8;
        let floor = true;
        if (c === "<") { sx = px; sy = py; }
        else if (c === ">") { this.stairs = { x: x * TS, y: y * TS, w: TS, h: TS }; floor = false; }
        else if (c === "c") this.chests.push({ x: x * TS, y: y * TS, w: TS, h: TS, open: false, key: false });
        else if (c === "k") this.chests.push({ x: x * TS, y: y * TS, w: TS, h: TS, open: false, key: true });
        else if (c === "H") this.pickups.push({ kind: "potion", x: px, y: py });
        else if (c === "o") this.pickups.push({ kind: "gold", x: px, y: py, v: 10 });
        else if (c === "^") this.traps.push({ x: x * TS, y: y * TS, t: Math.random() * 3 });
        else if (c === "t") { this.torches.push({ x: px, y: y * TS + 6 }); floor = false; }
        else if (c >= "a" && c <= "h") { const e = TD.makeEnemy(this, (c.charCodeAt(0) - 97) % game.spec.enemies.length, px, py); e.home = { x: px, y: py }; e.asleep = true; this.enemies.push(e); }
        else if (c === "B") this.bossSpawn = { x: px, y: py };
        else floor = false;
        if (floor) this.grid[y][x] = ".";
      }
      if (!this.chests.some((c) => c.key) && !this.bossSpawn) this.hasKey = true;
      if (this.bossSpawn && !this.demo) this.spawnBoss();
      this.player = this.makePlayer(sx, sy);
      this.cam.snap(sx, sy);
      this.layer = this.prerender();
      this.dark = !!(this.L.dark !== false);
    }

    prerender() {
      const g = this.game, T = g.theme, tiles = g.tiles;
      const c = g.gfx.makeCanvas(this.pw, this.ph), ctx = c.getContext("2d");
      const h = (x, y) => { let v = Math.imul(x, 73856093) ^ Math.imul(y, 19349663); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
      const wall = (x, y) => x < 0 || y < 0 || x >= this.w || y >= this.h || this.grid[y][x] === "#" || this.grid[y][x] === "t";
      const open = (x, y) => x >= 0 && y >= 0 && x < this.w && y < this.h && this.grid[y][x] !== " " && !wall(x, y);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (!open(x, y)) continue;
        if (tiles) { this.tileAt(ctx, 48 + Math.floor(h(x, y) * 4), x * TS, y * TS); if (h(y, x) < 0.08) this.tileAt(ctx, 52 + Math.floor(h(x + 1, y) * 4), x * TS, y * TS); }
        else { ctx.fillStyle = (x + y) % 2 ? T.panel : CG.mix(T.panel, T.bg, 0.4); ctx.fillRect(x * TS, y * TS, TS, TS); }
        if (this.grid[y][x] === "^" ) {}
      }
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (!wall(x, y)) continue;
        // only draw walls that border a walkable tile (keeps the void black)
        let near = false;
        for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (open(x + ox, y + oy)) { near = true; break; }
        if (!near) continue;
        const m = (wall(x, y - 1) ? 0 : 1) | (wall(x + 1, y) ? 0 : 2) | (wall(x, y + 1) ? 0 : 4) | (wall(x - 1, y) ? 0 : 8);
        if (m & 4 && open(x, y + 1)) { ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(x * TS, (y + 1) * TS, TS, 7); }
        if (tiles) this.tileAt(ctx, 32 + m, x * TS, y * TS);
        else { ctx.fillStyle = T.panelEdge; ctx.fillRect(x * TS, y * TS, TS, TS); ctx.fillStyle = T.shadow; ctx.fillRect(x * TS, y * TS + 10, TS, 6); }
      }
      return c;
    }
    tileAt(ctx, idx, x, y) { const t = this.game.tiles, cols = t.cols || 8, s = t.size || TS; ctx.drawImage(t.img, (idx % cols) * s, Math.floor(idx / cols) * s, s, s, x, y, TS, TS); }

    spawnEnemy(def, x, y) { const e = TD.makeEnemy(this, def, x, y); this.enemies.push(e); return e; }

    spawnBoss() {
      const g = this.game, def = g.spec.boss || { name: "Dungeon Lord", hp: 30 };
      const spr = g.sprites[def.sprite || "boss"];
      const size = spr ? Math.min(spr.fw, spr.fh) * 0.75 : 28;
      const hp = (def.hp || 30) * 2.2 * (0.7 + this.diff * 0.3);
      this.boss = { def, spr, x: this.bossSpawn.x - size / 2, y: this.bossSpawn.y - size / 2, w: size, h: size, vx: 0, vy: 0, hp, maxHp: hp, t: 0, timer: 1.5, state: "sleep", flash: 0, face: 1, active: false, boss: true };
    }

    update(dt) {
      const g = this.game, p = this.player;
      this.t += dt;
      if (this.demo) return this.demoUpdate(dt);
      if (p.dead) this.updateDeath(dt);
      else if (!this.done) {
        this.updatePlayerCore(dt);
        this.attack(dt, false);
        this.interact();
      }
      const ptx = Math.floor((p.x + p.w / 2) / TS), pty = Math.floor((p.y + p.h / 2) / TS);
      const R = 7;
      for (let y = pty - R; y <= pty + R; y++) for (let x = ptx - R; x <= ptx + R; x++) if (x >= 0 && y >= 0 && x < this.w && y < this.h && (x - ptx) ** 2 + (y - pty) ** 2 <= R * R) this.seen[y * this.w + x] = 1;
      for (const e of this.enemies) {
        if (e.asleep) {
          if (dist(e.x, e.y, p.x, p.y) < 110 && this.lineOfSight(e.x + e.w / 2, e.y + e.h / 2, p.x + p.w / 2, p.y + p.h / 2)) { e.asleep = false; g.floaters.add("!", e.x + e.w / 2, e.y - 6, g.theme.danger); }
          e.t += dt;
          continue;
        }
        if (e.hp <= 0 && !e.dead) { this.killEnemy(e); continue; }
        TD.updateEnemy(this, e, dt);
        if (!p.dead && !e.dead && overlap(p, e)) this.hurtPlayer(e.dmg, p.x - e.x, p.y - e.y);
      }
      TD.separate(this.enemies.filter((e) => !e.asleep), dt);
      this.enemies = this.enemies.filter((e) => !e.dead);
      if (this.boss) this.updateBoss(dt);
      this.updateShots(dt);
      for (const tr of this.traps) {
        tr.t += dt;
        const up = tr.t % 3 > 2.2;
        tr.up = up;
        if (up && !p.dead && overlap(p, { x: tr.x + 2, y: tr.y + 2, w: 12, h: 12 })) this.hurtPlayer(1, 0, 0);
      }
      this.updatePickups(dt);
      this.cam.follow(p.x + p.w / 2, p.y + p.h / 2, dt, 9);
      this.cam.update(dt);
    }

    lineOfSight(x0, y0, x1, y1) {
      const steps = Math.ceil(dist(x0, y0, x1, y1) / 8);
      for (let i = 1; i < steps; i++) { const k = i / steps; if (this.solidFn(Math.floor(lerp(x0, x1, k) / TS), Math.floor(lerp(y0, y1, k) / TS))) return false; }
      return true;
    }

    interact() {
      const g = this.game, p = this.player;
      for (const c of this.chests) {
        if (c.open || dist(p.x + p.w / 2, p.y + p.h / 2, c.x + 8, c.y + 8) > 16) continue;
        c.open = true;
        g.audio.play("powerup", { pitch: 0.9 });
        g.particles.burst(c.x + 8, c.y + 4, 20, { colors: [g.theme.gold, "#fff"], speed: 90, life: 0.6, g: 160, angle: -Math.PI / 2, spread: 1.8 });
        if (c.key) { this.hasKey = true; g.floaters.add("GOT THE KEY!", c.x + 8, c.y - 8, g.theme.gold, { scale: 1, life: 1.6 }); this.cam.shake(0.15); }
        else {
          const r = Math.random();
          if (r < 0.35) this.pickups.push({ kind: "potion", x: c.x + 8, y: c.y + 18 });
          else if (r < 0.55) { const u = TD.UPGRADES[Math.floor(Math.random() * TD.UPGRADES.length)]; if (!(u.ranged && this.weapon.melee)) { u.apply(this.stats, p); g.floaters.add(u.name.toUpperCase(), c.x + 8, c.y - 8, g.theme.accent, { life: 1.6 }); } else this.gainGold(60, c.x + 8, c.y); }
          else for (let i = 0; i < 6; i++) this.pickups.push({ kind: "gold", x: c.x + 8 + (Math.random() - 0.5) * 14, y: c.y + 16 + Math.random() * 6, v: 10 });
        }
      }
      if (this.stairs && overlap(p, this.stairs)) {
        if (this.hasKey && (!this.boss || this.boss.dead)) this.finish();
        else if (!this.lockedMsg || this.t - this.lockedMsg > 2) { this.lockedMsg = this.t; g.floaters.add(this.boss && !this.boss.dead ? "DEFEAT THE BOSS" : "LOCKED - FIND THE KEY", p.x + 5, p.y - 10, g.theme.danger, { life: 1.4 }); g.audio.play("hit", { vol: 0.4 }); }
      }
    }

    gainGold(v, x, y) { this.gold += v; this.game.stats.coins += v; this.game.addScore(v); }

    updatePickups(dt) {
      const g = this.game, p = this.player;
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      for (const it of this.pickups) {
        const d = dist(px, py, it.x, it.y);
        if (d < 28 * this.stats.magnet && it.kind !== "potion") { const a = angleTo(it.x, it.y, px, py); it.x += Math.cos(a) * 160 * dt; it.y += Math.sin(a) * 160 * dt; }
        if (d < 9 && !p.dead) {
          if (it.kind === "potion") { if (p.hp >= p.maxHp) continue; p.hp = Math.min(p.maxHp, p.hp + 2); g.audio.play("powerup", { pitch: 1.3 }); g.floaters.add("+2 HP", px, py - 10, g.theme.danger); }
          else { this.gainGold(it.v || 10, it.x, it.y); g.audio.play("coin", { vol: 0.6 }); }
          it.taken = true;
        }
      }
      this.pickups = this.pickups.filter((it) => !it.taken);
    }

    onEnemyKilled(e, x, y) {
      if (Math.random() < 0.6) this.pickups.push({ kind: "gold", x, y, v: 5 });
      if (Math.random() < 0.08) this.pickups.push({ kind: "potion", x: x + 4, y });
    }

    updateBoss(dt) {
      const b = this.boss, g = this.game, p = this.player;
      b.t += dt; b.flash = Math.max(0, b.flash - dt);
      if (b.dead) {
        b.deadT += dt;
        if (Math.random() < 0.5) g.particles.burst(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 6, { colors: g.theme.fx, speed: 120, life: 0.5, glow: true });
        if (b.deadT > 1.5 && !b.exploded) { b.exploded = true; g.gfx.flash("#fff", 0.8); this.cam.shake(0.8); g.audio.play("explode"); g.addScore(5000); this.hasKey = true; g.floaters.add("THE STAIRS ARE OPEN", p.x + 5, p.y - 14, g.theme.gold, { life: 2 }); }
        return;
      }
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, px = p.x + p.w / 2, py = p.y + p.h / 2;
      if (!b.active) {
        if (dist(cx, cy, px, py) < 130) { b.active = true; b.state = "intro"; b.timer = 1.4; this.bossWarn = 2.5; g.audio.playMusic(g.spec.audio.music.boss ? "boss" : "main", 0.5); this.cam.shake(0.4); }
        return;
      }
      if (this.bossWarn) this.bossWarn = Math.max(0, this.bossWarn - dt);
      const a = angleTo(cx, cy, px, py), enraged = b.hp < b.maxHp * 0.5;
      b.timer -= dt * (enraged ? 1.35 : 1);
      if (b.state === "intro") { if (b.timer <= 0) { b.state = "chase"; b.timer = 1.5; } }
      else if (b.state === "chase") {
        b.vx = damp(b.vx, Math.cos(a) * 45, 3, dt); b.vy = damp(b.vy, Math.sin(a) * 45, 3, dt);
        if (b.timer <= 0) { const r = Math.random(); b.state = r < 0.4 ? "fan" : r < 0.75 ? "tell" : "ring"; b.timer = 0.6; b.k = 0; }
      } else if (b.state === "fan") {
        b.vx *= 0.9; b.vy *= 0.9;
        if (b.timer <= 0) {
          const n = enraged ? 7 : 5;
          for (let i = 0; i < n; i++) this.enemyShot(cx, cy, a + (i - (n - 1) / 2) * 0.25, 110, { size: 4 });
          g.audio.play("shoot", { pitch: 0.6 });
          b.k++; b.timer = 0.4;
          if (b.k >= 3) { b.state = "chase"; b.timer = 1.4; }
        }
      } else if (b.state === "ring") {
        b.vx *= 0.9; b.vy *= 0.9;
        if (b.timer <= 0) { for (let i = 0; i < 16; i++) this.enemyShot(cx, cy, (i / 16) * TAU + b.k * 0.2, 80, { size: 4 }); b.k++; b.timer = 0.5; g.audio.play("shoot", { pitch: 0.5 }); if (b.k >= (enraged ? 4 : 2)) { b.state = "chase"; b.timer = 1.4; } }
      } else if (b.state === "tell") {
        b.vx = 0; b.vy = 0;
        if (b.timer <= 0) { b.state = "charge"; b.timer = 0.6; b.cx = Math.cos(a); b.cy = Math.sin(a); g.audio.play("dash"); }
      } else if (b.state === "charge") {
        b.vx = b.cx * 240; b.vy = b.cy * 240;
        if (b.timer <= 0 || b.hit) { b.state = "chase"; b.timer = 1.4; if (b.hit) this.cam.shake(0.4); }
      }
      if (Math.abs(b.vx) > 3) b.face = sign(b.vx);
      TD.move(b, dt, this.solidFn);
      if (!p.dead && overlap(p, b)) this.hurtPlayer(1, px - cx, py - cy);
    }

    damageBoss(dmg) {
      const b = this.boss, g = this.game;
      if (!b || b.dead || !b.active || b.state === "intro") return;
      b.hp -= dmg * this.stats.dmgMul; b.flash = 0.08;
      g.audio.play("hit", { vol: 0.6, pitch: 0.7 });
      this.cam.shake(0.08);
      if (b.hp <= 0) { b.dead = true; b.deadT = 0; this.eshots.length = 0; g.audio.stopMusic(1); g.stats.kills++; }
    }

    finish() {
      const g = this.game;
      if (this.done) return;
      this.done = true;
      g.carry.stats = this.stats; g.carry.hp = this.player.hp; g.carry.maxHp = this.player.maxHp;
      g.audio.play("powerup", { pitch: 0.7 });
      g.levelComplete({ kills: this.kills, coins: this.gold, timeBonus: Math.max(0, 120 - g.levelTime) * 5 });
    }
    forceWin() { this.finish(); }

    // ---------- drawing ----------
    draw(gfx) {
      const g = this.game, ctx = gfx.ctx, T = g.theme;
      const vx = this.cam.vx, vy = this.cam.vy;
      ctx.fillStyle = "#050308"; ctx.fillRect(0, 0, gfx.W, gfx.H);
      ctx.drawImage(this.layer, vx, vy, gfx.W, gfx.H, 0, 0, gfx.W, gfx.H);
      for (const tr of this.traps) {
        const x = tr.x - vx, y = tr.y - vy;
        if (g.tiles) this.tileAt(ctx, tr.up ? 61 : 60, x, y);
        else { gfx.rect(x + 2, y + 2, 12, 12, T.shadow); if (tr.up) for (let i = 0; i < 3; i++) gfx.rect(x + 3 + i * 4, y + 4, 2, 8, "#ddd"); }
      }
      if (this.stairs) {
        const x = this.stairs.x - vx, y = this.stairs.y - vy;
        if (g.tiles) this.tileAt(ctx, 57, x, y); else { gfx.rect(x, y, TS, TS, T.shadow); for (let i = 0; i < 4; i++) gfx.rect(x + 2, y + 2 + i * 3, 12 - i * 2, 2, T.textDim); }
        if (!this.hasKey || (this.boss && !this.boss.dead)) { gfx.rect(x + 5, y + 6, 6, 5, T.gold); gfx.rect(x + 6, y + 3, 4, 3, "rgba(0,0,0,0)"); gfx.ring(x + 8, y + 5, 2, T.gold, 1); }
        else { ctx.globalAlpha = 0.4 + Math.sin(this.t * 4) * 0.2; gfx.circle(x + 8, y + 8, 10, T.gold); ctx.globalAlpha = 1; }
      }
      for (const c of this.chests) {
        const x = c.x - vx, y = c.y - vy;
        if (g.tiles) this.tileAt(ctx, c.open ? 59 : 58, x, y);
        else { gfx.rect(x + 2, y + 5, 12, 9, c.open ? T.shadow : T.gold); gfx.rect(x + 2, y + 5, 12, 2, T.panelEdge); }
        if (c.key && !c.open) { ctx.globalAlpha = 0.35 + Math.sin(this.t * 3) * 0.15; gfx.circle(x + 8, y + 8, 11, T.gold); ctx.globalAlpha = 1; }
      }
      for (const it of this.pickups) {
        const x = it.x - vx, y = it.y - vy + Math.sin(this.t * 5 + it.x) * 1;
        if (it.kind === "gold") { gfx.rect(x - 2, y - 2, 4, 4, T.gold); gfx.rect(x - 1, y - 2, 1, 1, "#fff"); }
        else { const spr = g.sprites.potion; if (spr) gfx.sprite(spr, 0, x, y + 6); else { gfx.rect(x - 3, y - 2, 6, 6, T.danger); gfx.rect(x - 1, y - 5, 2, 3, T.textDim); } }
      }
      const actors = this.enemies.slice().sort((a, b) => a.y - b.y);
      for (const e of actors) TD.drawEnemy(this, gfx, e, vx, vy);
      if (this.boss && !this.boss.exploded) {
        const b = this.boss;
        TD.drawShadow(gfx, b.x + b.w / 2 - vx, b.y + b.h - vy, b.w * 0.5);
        if (b.state === "tell") gfx.text("!", b.x + b.w / 2 - vx, b.y - vy - 16, { color: T.danger, outline: "#000", align: "center", scale: 2 });
        g.drawActor(b.spr, b.x + b.w / 2 - vx + (b.dead ? (Math.random() - 0.5) * 4 : 0), b.y + b.h - vy + 3, { state: b.active ? "walk" : "idle", t: b.t, flip: b.face > 0, flash: b.flash > 0, color: T.danger });
      }
      this.drawPlayerTD(gfx, vx, vy);
      this.drawCombatFx(gfx, vx, vy);
      for (const tc of this.torches) {
        const x = tc.x - vx, y = tc.y - vy;
        gfx.rect(x - 1, y, 2, 5, "#6b4a2f");
        const f = Math.sin(this.t * 14 + tc.x) * 0.8;
        gfx.circle(x, y - 1 + f * 0.3, 2.5, "#ff9a2e"); gfx.circle(x, y - 1.5, 1.2, "#fff2a8");
        if (Math.random() < 0.08) g.particles.emit({ x: tc.x + (Math.random() - 0.5) * 2, y: tc.y - 3, vx: 0, vy: -20, life: 0.5, size: 1, color: "#ffb347" });
      }
      g.particles.draw(ctx, vx, vy);
      if (this.dark) this.drawLighting(gfx, vx, vy);
      g.floaters.draw(gfx, vx, vy);
    }

    drawLighting(gfx, vx, vy) {
      const p = this.player;
      this.darkC = this.darkC || gfx.makeCanvas(gfx.W, gfx.H);
      const d = this.darkC.getContext("2d");
      d.globalCompositeOperation = "source-over";
      d.fillStyle = "rgba(2,1,8,0.9)"; d.fillRect(0, 0, gfx.W, gfx.H);
      d.globalCompositeOperation = "destination-out";
      const light = (x, y, r, a = 1) => {
        const gr = d.createRadialGradient(x, y, r * 0.15, x, y, r);
        gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, "rgba(0,0,0,0)");
        d.fillStyle = gr; d.beginPath(); d.arc(x, y, r, 0, TAU); d.fill();
      };
      light(p.x + p.w / 2 - vx, p.y + p.h / 2 - vy, 105 + Math.sin(this.t * 2.7) * 4);
      for (const tc of this.torches) if (Math.abs(tc.x - vx - gfx.W / 2) < gfx.W && Math.abs(tc.y - vy - gfx.H / 2) < gfx.H) light(tc.x - vx, tc.y - vy, 62 + Math.sin(this.t * 9 + tc.x) * 3, 0.9);
      for (const s of this.shots) light(s.x - vx, s.y - vy, 26, 0.7);
      for (const s of this.eshots) light(s.x - vx, s.y - vy, 18, 0.6);
      for (const c of this.chests) if (c.key && !c.open) light(c.x + 8 - vx, c.y + 8 - vy, 30, 0.6);
      if (this.stairs && this.hasKey) light(this.stairs.x + 8 - vx, this.stairs.y + 8 - vy, 34, 0.7);
      gfx.ctx.drawImage(this.darkC, 0, 0);
      // warm torch tint
      gfx.ctx.globalCompositeOperation = "soft-light";
      gfx.ctx.fillStyle = "rgba(255,170,90,0.12)"; gfx.ctx.fillRect(0, 0, gfx.W, gfx.H);
      gfx.ctx.globalCompositeOperation = "source-over";
    }

    hud(gfx) {
      const g = this.game, T = g.theme;
      g.drawHud({ hp: this.player.hp, maxHp: this.player.maxHp, lives: g.lives, counters: [{ value: this.gold + "G", color: T.gold }], center: this.hasKey ? "KEY: YES" : "KEY: --", centerColor: this.hasKey ? T.gold : T.textDim });
      // minimap
      const s = 2, mw = Math.min(this.w * s, 90), mh = Math.min(this.h * s, 60);
      const ox = gfx.W - mw - 6, oy = gfx.H - mh - 6;
      const ptx = Math.floor((this.player.x + 5) / TS), pty = Math.floor((this.player.y + 5) / TS);
      const sx0 = clamp(ptx - Math.floor(mw / s / 2), 0, Math.max(0, this.w - mw / s)), sy0 = clamp(pty - Math.floor(mh / s / 2), 0, Math.max(0, this.h - mh / s));
      gfx.ctx.globalAlpha = 0.75;
      gfx.rect(ox - 1, oy - 1, mw + 2, mh + 2, "#000");
      for (let y = 0; y < mh / s; y++) for (let x = 0; x < mw / s; x++) {
        const tx = sx0 + x, ty = sy0 + y;
        if (tx >= this.w || ty >= this.h || !this.seen[ty * this.w + tx]) continue;
        const c = this.grid[ty][tx];
        if (c === "#" || c === " " || c === "t") continue;
        gfx.rect(ox + x * s, oy + y * s, s, s, CG.mix(T.panel, T.text, 0.25));
      }
      if (this.stairs) { const tx = this.stairs.x / TS - sx0, ty = this.stairs.y / TS - sy0; if (tx >= 0 && ty >= 0 && tx < mw / s && ty < mh / s && this.seen[(this.stairs.y / TS) * this.w + this.stairs.x / TS]) gfx.rect(ox + tx * s, oy + ty * s, s, s, T.gold); }
      gfx.rect(ox + (ptx - sx0) * s, oy + (pty - sy0) * s, s, s, Math.floor(this.t * 4) % 2 ? "#fff" : T.accent);
      gfx.ctx.globalAlpha = 1;
      if (this.boss && this.boss.active && !this.boss.dead) {
        gfx.text((this.boss.def.name || "BOSS").toUpperCase(), gfx.W / 2, 20, { align: "center", color: T.text, outline: T.shadow });
        gfx.bar(gfx.W / 2 - 90, 30, 180, 5, this.boss.hp / this.boss.maxHp, T.danger);
      }
      if (this.bossWarn) { gfx.ctx.globalAlpha = Math.min(1, this.bossWarn); gfx.text("WARNING", gfx.W / 2, gfx.H * 0.3, { align: "center", scale: 3, color: T.danger, outline: T.shadow }); gfx.ctx.globalAlpha = 1; }
    }

    demoUpdate(dt) {
      this.t += dt;
      const p = this.player;
      p.t += dt; p.state = "run";
      this.demoA = (this.demoA || 0) + dt * 0.3;
      p.x += Math.cos(this.demoA) * 20 * dt; p.y += Math.sin(this.demoA * 1.3) * 14 * dt;
      p.face = Math.cos(this.demoA) > 0 ? 1 : -1;
      for (const e of this.enemies) e.t += dt;
      this.cam.follow(p.x, p.y, dt, 2);
      this.cam.update(dt);
    }
    drawDemo(gfx) { this.draw(gfx); }
  }
  Object.assign(Dungeon.prototype, TD.Combat);

  const DEFAULT = [
    "##################",
    "#<...#.....t.....#",
    "#....#...........#",
    "#....+.....a.....#",
    "#....#...........#",
    "######.####.######",
    "#.........#......#",
    "#..b...o..#..k...#",
    "#.........#....>.#",
    "##################",
  ];

  CG.defineGenre("dungeon", {
    create: (game, i, opts) => new Dungeon(game, i, opts),
    controls: [["Move", "Arrows / WASD"], ["Attack", "X / J / Click"], ["Aim", "Move direction or mouse"], ["Dodge roll", "Space / Z"], ["Open chests", "Walk into them"]],
  });
})();
