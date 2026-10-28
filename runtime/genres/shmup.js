/* Side-scrolling shmup: formations, bullet patterns, weapon power levels, bombs, chains and multi-phase bosses. */
(() => {
  const BEH = { shooter: "turret", turret: "turret", flyer: "sine", weaver: "sine", charger: "dive", kamikaze: "dive", hopper: "sine", tank: "tank", spiky: "tank", splitter: "line", walker: "line", chaser: "dive", spinner: "spinner", exploder: "dive", orbiter: "circle" };

  class Shmup {
    constructor(game, index, opts) {
      this.game = game;
      this.demo = !!opts.demo;
      this.L = game.spec.levels[index] || game.spec.levels[0];
      this.diff = game.spec.rules.difficulty || 1;
      this.W = game.W; this.H = game.H;
      this.cam = new CG.Camera(game.W, game.H);
      this.t = 0;
      this.length = this.L.length || 70;
      this.waves = (this.L.waves || defaultWaves(game.spec.enemies.length, this.length)).slice().sort((a, b) => a.t - b.t);
      this.waveIdx = 0;
      this.enemies = []; this.shots = []; this.eshots = []; this.drops = [];
      this.kills = 0; this.chain = 0; this.chainT = 0; this.bestChain = 0;
      this.boss = null; this.bossDone = !this.L.boss; this.done = false;
      this.scroll = this.L.scroll || 70;
      const carry = game.carry || {};
      this.player = { x: 60, y: this.H / 2, vx: 0, vy: 0, w: 4, h: 4, power: carry.power || 1, bombs: 3, shield: 0, inv: 2, cd: 0, dead: false, deadT: 0, t: 0, tilt: 0, missileCd: 0 };
      this.stars = Array.from({ length: 70 }, () => ({ x: Math.random() * this.W, y: Math.random() * this.H, z: 0.2 + Math.random() * 0.8 }));
      this.hpScale = 1 + index * 0.35;
      if (this.demo) for (let i = 0; i < 5; i++) this.enemies.push(this.makeEnemy(i % game.spec.enemies.length, this.W * 0.6 + i * 30, 60 + i * 30, "sine", { speed: 0 }));
    }

    makeEnemy(defIdx, x, y, pattern, o = {}) {
      const g = this.game;
      const def = typeof defIdx === "object" ? defIdx : g.spec.enemies[defIdx % g.spec.enemies.length];
      const spr = g.sprites[def.sprite || def.id];
      const beh = o.beh || BEH[(def.behavior || "").toLowerCase()] || pattern || "line";
      const size = spr ? Math.min(spr.fw, spr.fh) * 0.75 : 12;
      const hp = (def.hp || 1) * (beh === "tank" ? 8 : beh === "turret" ? 3 : 1.5) * this.hpScale * (0.7 + this.diff * 0.3);
      return {
        def, spr, beh, pattern: pattern || beh, x, y, y0: y, w: size, h: size, hp, maxHp: hp, t: Math.random(), flash: 0,
        speed: (o.speed != null ? o.speed : 60 + (def.speed || 1) * 30) * (beh === "tank" ? 0.5 : 1), fireT: 1 + Math.random() * 2, phase: o.phase || 0, dead: false,
        carrier: !!o.carrier,
      };
    }

    spawnWave(w) {
      const n = Math.max(1, Math.round((w.count || 5) * (0.8 + this.diff * 0.2)));
      const yc = (w.y != null ? w.y : 0.5) * this.H;
      const e0 = w.enemy || 0;
      const pat = w.pattern || "line";
      const carrierIdx = Math.random() < 0.6 ? Math.floor(Math.random() * n) : -1;
      for (let i = 0; i < n; i++) {
        let x = this.W + 20, y = yc, delay = 0;
        if (pat === "line") { delay = i * 0.35; }
        else if (pat === "v") { x += Math.abs(i - (n - 1) / 2) * 18; y = yc + (i - (n - 1) / 2) * 16; }
        else if (pat === "column") { y = yc + (i - (n - 1) / 2) * 20; }
        else if (pat === "sine") { delay = i * 0.3; }
        else if (pat === "swarm") { x += Math.random() * 80; y = 20 + Math.random() * (this.H - 40); }
        else if (pat === "dive") { delay = i * 0.5; y = 20 + Math.random() * (this.H - 40); }
        else if (pat === "circle") { delay = i * 0.25; }
        else if (pat === "turret") { y = 30 + ((i + 0.5) / n) * (this.H - 60); delay = i * 0.6; }
        y = clamp(y, 14, this.H - 14);
        const e = this.makeEnemy(e0, x, y, pat, { phase: i, carrier: i === carrierIdx, speed: w.speed ? w.speed * 60 : null });
        e.delay = delay;
        this.enemies.push(e);
      }
    }

    spawnEnemy(def, x, y) { const e = this.makeEnemy(def, x, y, "line"); this.enemies.push(e); return e; }

    update(dt) {
      const g = this.game, p = this.player;
      this.t += dt;
      if (this.demo) { for (const e of this.enemies) { e.t += dt; e.y = e.y0 + Math.sin(e.t * 2 + e.phase) * 14; } p.t += dt; p.y = this.H / 2 + Math.sin(this.t) * 30; this.updateStars(dt); return; }
      this.updateStars(dt);
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
      if (!this.done) {
        while (this.waveIdx < this.waves.length && this.waves[this.waveIdx].t <= this.t) this.spawnWave(this.waves[this.waveIdx++]);
        if (this.t > this.length && !this.boss && !this.bossDone) this.spawnBoss();
        if (this.t > this.length && this.bossDone && this.enemies.length === 0) this.finish();
      }
      this.updatePlayer(dt);
      for (const e of this.enemies) this.updateEnemy(e, dt);
      this.enemies = this.enemies.filter((e) => !e.gone && !e.dead);
      if (this.boss) this.updateBoss(dt);
      this.updateShots(dt);
      this.updateDrops(dt);
      this.cam.update(dt);
    }

    updateStars(dt) { for (const s of this.stars) { s.x -= s.z * (this.scroll * 1.8) * dt; if (s.x < -2) { s.x = this.W + 2; s.y = Math.random() * this.H; } } }

    updatePlayer(dt) {
      const g = this.game, inp = g.input, p = this.player;
      p.t += dt;
      if (p.dead) {
        p.deadT += dt;
        if (p.deadT > 1.2 && !p.reported) {
          p.reported = true;
          if (g.playerDied()) { p.dead = false; p.reported = false; p.x = 50; p.y = this.H / 2; p.inv = 2.5; p.bombs = Math.max(p.bombs, 2); p.power = Math.max(1, p.power - 1); }
        }
        return;
      }
      if (this.done) { p.x += 200 * dt; return; }
      p.inv = Math.max(0, p.inv - dt);
      const ax = inp.axis();
      const focus = inp.down("c");
      const sp = (focus ? 75 : 160) * (g.spec.player.speed || 1);
      p.vx = damp(p.vx, ax.x * sp, 18, dt); p.vy = damp(p.vy, ax.y * sp, 18, dt);
      p.x = clamp(p.x + p.vx * dt, 10, this.W - 14); p.y = clamp(p.y + p.vy * dt, 12, this.H - 10);
      p.tilt = damp(p.tilt, ax.y * 0.25, 10, dt);
      p.focus = focus;
      // autofire
      p.cd -= dt; p.missileCd -= dt;
      if (p.cd <= 0) {
        p.cd = focus ? 0.07 : 0.09;
        const P = p.power;
        const sx = p.x + 8, sy = p.y;
        const add = (dy, a = 0) => this.shots.push({ x: sx, y: sy + dy, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, dmg: 1, life: 1.2 });
        if (P === 1) add(Math.floor(p.t * 11) % 2 ? -2 : 2);
        else if (P === 2) { add(-3); add(3); }
        else { add(-3); add(3); const sa = focus ? 0.06 : 0.2; add(0, -sa); add(0, sa); }
        if (P >= 4 && p.missileCd <= 0) { p.missileCd = 0.5; for (const s of [-1, 1]) this.shots.push({ x: sx - 6, y: sy + s * 6, vx: 120, vy: s * 60, dmg: 2, life: 2, homing: true, missile: true }); }
        if (Math.floor(p.t * 11) % 3 === 0) g.audio.play("shoot", { vol: 0.18, gap: 0.08 });
      }
      if (inp.pressed("b") && p.bombs > 0) this.bomb();
    }

    bomb() {
      const g = this.game, p = this.player;
      p.bombs--; p.inv = Math.max(p.inv, 1.6);
      g.audio.play("explode");
      g.gfx.flash("#ffffff", 0.9);
      this.cam.shake(0.8);
      this.bombFx = { x: p.x, y: p.y, t: 0 };
      for (const s of this.eshots) g.particles.emit({ x: s.x, y: s.y, vx: 0, vy: 0, life: 0.3, size: 3, color: g.theme.gold });
      this.eshots.length = 0;
      for (const e of this.enemies) if (e.x < this.W + 10 && !e.delay) this.damage(e, 12);
      if (this.boss && this.boss.active) this.damageBoss(15);
    }

    fire(x, y, a, sp, o = {}) { this.eshots.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: o.r || 3, life: 6, color: o.color }); }

    updateEnemy(e, dt) {
      const g = this.game, p = this.player;
      if (e.delay > 0) { e.delay -= dt; return; }
      if (e.hp <= 0 && !e.dead) { e.hp = 0.0001; this.damage(e, 1); return; }
      e.t += dt; e.flash = Math.max(0, e.flash - dt);
      const sp = e.speed;
      switch (e.pattern) {
        case "sine": e.x -= sp * dt; e.y = e.y0 + Math.sin(e.t * 3 + e.phase * 0.6) * 34; break;
        case "dive":
          if (e.t < 0.8) e.x -= sp * 1.2 * dt;
          else { const a = angleTo(e.x, e.y, p.x, p.y); e.va = e.va == null ? a : e.va + clamp(Math.atan2(Math.sin(a - e.va), Math.cos(a - e.va)), -1.8 * dt, 1.8 * dt); e.x += Math.cos(e.va) * sp * 1.7 * dt; e.y += Math.sin(e.va) * sp * 1.7 * dt; }
          break;
        case "circle": {
          if (e.t < 1) e.x -= sp * 1.5 * dt;
          else if (e.t < 3.5) { const a = (e.t - 1) * 2.5; e.x += -Math.sin(a) * 90 * dt * -1 - 20 * dt; e.y += Math.cos(a) * 90 * dt; }
          else e.x -= sp * 1.6 * dt;
          break;
        }
        case "turret": e.x -= (e.x > this.W * 0.72 ? sp : sp * 0.15) * dt; e.y = e.y0 + Math.sin(e.t * 1.2) * 8; break;
        case "spinner": e.x -= sp * 0.6 * dt; e.y = e.y0 + Math.sin(e.t) * 20; break;
        default: e.x -= sp * dt;
      }
      // shooting
      e.fireT -= dt * (0.7 + this.diff * 0.3) * (1 + this.game.levelIndex * 0.15);
      if (e.fireT <= 0 && e.x < this.W - 10 && e.x > 30 && !p.dead) {
        const a = angleTo(e.x, e.y, p.x, p.y);
        if (e.beh === "turret" || e.pattern === "turret") { e.fireT = 1.6; for (let i = -1; i <= 1; i++) this.fire(e.x, e.y, a + i * 0.2, 95); }
        else if (e.beh === "spinner" || e.pattern === "spinner") { e.fireT = 1.4; for (let i = 0; i < 10; i++) this.fire(e.x, e.y, e.t + (i / 10) * TAU, 70); }
        else if (e.beh === "tank") { e.fireT = 1.8; for (let i = -2; i <= 2; i++) this.fire(e.x, e.y, a + i * 0.15, 90); }
        else { e.fireT = 2.5 + Math.random() * 2; if (Math.random() < 0.55) this.fire(e.x, e.y, a, 100); }
      }
      if (e.x < -30 || e.y < -40 || e.y > this.H + 40) e.gone = true;
      if (!p.dead && p.inv <= 0 && Math.abs(e.x - p.x) < e.w / 2 + 2 && Math.abs(e.y - p.y) < e.h / 2 + 2) this.hitPlayer();
    }

    damage(e, n) {
      const g = this.game;
      if (e.dead) return;
      e.hp -= n; e.flash = 0.06;
      if (e.hp > 0) return;
      e.dead = true;
      this.kills++; g.stats.kills++;
      this.chain++; this.chainT = 1.2; this.bestChain = Math.max(this.bestChain, this.chain);
      const mult = Math.min(4, 1 + this.chain * 0.1);
      const pts = Math.round((e.def.score || 100) * mult);
      g.addScore(pts);
      if (this.chain >= 5 && this.chain % 5 === 0) g.floaters.add(`CHAIN x${this.chain}`, e.x, e.y - 10, g.theme.gold);
      g.audio.play("explode", { vol: 0.35, pitch: 1.4, gap: 0.04 });
      g.particles.burst(e.x, e.y, 14, { colors: [g.theme.gold, g.theme.danger, "#fff"], speed: 120, life: 0.45, glow: true, size: 2 });
      this.cam.shake(0.06);
      if (e.carrier || Math.random() < 0.04) {
        const r = Math.random(), p = this.player;
        const kind = p.power < 4 && r < 0.6 ? "P" : r < 0.8 ? "S" : "B";
        this.drops.push({ kind, x: e.x, y: e.y, vx: -30, t: 0 });
      } else if (Math.random() < 0.2) this.drops.push({ kind: "medal", x: e.x, y: e.y, vx: -50, t: 0 });
      g.emit("onEnemyKilled", e, this);
    }

    hitPlayer() {
      const g = this.game, p = this.player;
      if (p.inv > 0 || p.dead || this.done) return;
      g.emit("onPlayerHit", 1, this);
      if (p.shield > 0) { p.shield--; p.inv = 1.2; g.audio.play("hurt", { pitch: 1.4 }); this.cam.shake(0.3); g.particles.burst(p.x, p.y, 20, { colors: [g.theme.accent, "#fff"], speed: 120, life: 0.5 }); return; }
      p.dead = true; p.deadT = 0;
      g.audio.play("die");
      g.gfx.flash(g.theme.danger, 0.4);
      this.cam.shake(0.7);
      g.particles.burst(p.x, p.y, 40, { colors: [g.theme.gold, g.theme.danger, "#fff"], speed: 180, life: 0.8, glow: true });
      this.eshots.length = 0;
    }
    hurtPlayer() { this.hitPlayer(); }

    updateShots(dt) {
      const g = this.game, p = this.player;
      for (const s of this.shots) {
        if (s.homing) {
          let best = null, bd = 1e9;
          for (const e of this.enemies) if (!e.dead && !e.delay && e.x > s.x) { const d = dist(s.x, s.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
          if (!best && this.boss && this.boss.active) best = this.boss;
          const sp = Math.min(380, Math.hypot(s.vx, s.vy) + 500 * dt);
          let a = Math.atan2(s.vy, s.vx);
          if (best) { const want = angleTo(s.x, s.y, best.x, best.y); a += clamp(Math.atan2(Math.sin(want - a), Math.cos(want - a)), -5 * dt, 5 * dt); }
          s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
          if (Math.random() < 0.5) g.particles.emit({ x: s.x, y: s.y, vx: -s.vx * 0.1, vy: 0, life: 0.2, size: 1.5, color: g.theme.textDim });
        }
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.x > this.W + 10) s.life = 0;
        for (const e of this.enemies) {
          if (e.dead || e.delay > 0 || Math.abs(s.x - e.x) > e.w / 2 + 3 || Math.abs(s.y - e.y) > e.h / 2 + 3) continue;
          this.damage(e, s.dmg); s.life = 0;
          g.particles.emit({ x: s.x, y: s.y, vx: -40, vy: (Math.random() - 0.5) * 60, life: 0.15, size: 2, color: "#fff" });
          break;
        }
        const b = this.boss;
        if (s.life > 0 && b && b.active && !b.dead && Math.abs(s.x - b.x) < b.w / 2 && Math.abs(s.y - b.y) < b.h / 2) { this.damageBoss(s.dmg); s.life = 0; }
      }
      this.shots = this.shots.filter((s) => s.life > 0);
      for (const s of this.eshots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.x < -10 || s.x > this.W + 10 || s.y < -10 || s.y > this.H + 10) s.life = 0;
        if (!p.dead && p.inv <= 0 && Math.abs(s.x - p.x) < s.r + 1.5 && Math.abs(s.y - p.y) < s.r + 1.5) { this.hitPlayer(); s.life = 0; }
        else if (!p.dead && !s.grazed && dist(s.x, s.y, p.x, p.y) < 12) { s.grazed = true; g.score += 5; g.particles.emit({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.2, size: 1, color: "#fff" }); }
      }
      this.eshots = this.eshots.filter((s) => s.life > 0);
    }

    updateDrops(dt) {
      const g = this.game, p = this.player;
      for (const d of this.drops) {
        d.t += dt; d.x += d.vx * dt; d.y += Math.sin(d.t * 3) * 20 * dt;
        if (!p.dead && dist(d.x, d.y, p.x, p.y) < 40) { const a = angleTo(d.x, d.y, p.x, p.y); d.x += Math.cos(a) * 140 * dt; d.y += Math.sin(a) * 140 * dt; }
        if (!p.dead && dist(d.x, d.y, p.x, p.y) < 9) {
          d.taken = true;
          if (d.kind === "P") { p.power = Math.min(4, p.power + 1); g.floaters.add(p.power >= 4 ? "MAX POWER" : "POWER UP", p.x, p.y - 12, g.theme.accent); g.audio.play("powerup"); }
          else if (d.kind === "S") { p.shield = 1; g.floaters.add("SHIELD", p.x, p.y - 12, g.theme.good); g.audio.play("powerup", { pitch: 1.2 }); }
          else if (d.kind === "B") { p.bombs = Math.min(5, p.bombs + 1); g.floaters.add("+BOMB", p.x, p.y - 12, g.theme.gold); g.audio.play("powerup", { pitch: 0.9 }); }
          else { g.addScore(500); g.audio.play("coin"); }
        }
      }
      this.drops = this.drops.filter((d) => !d.taken && d.x > -20);
    }

    spawnBoss() {
      const g = this.game, def = g.spec.boss || { name: "Dreadnought", hp: 40 };
      const spr = g.sprites[def.sprite || "boss"];
      const size = spr ? Math.min(spr.fw, spr.fh) * 0.8 : 40;
      const hp = (def.hp || 40) * 5 * (0.7 + this.diff * 0.3) * (1 + g.levelIndex * 0.4);
      this.boss = { def, spr, x: this.W + 60, y: this.H / 2, w: size, h: size, hp, maxHp: hp, t: 0, phase: 0, timer: 2, pat: 0, active: false, flash: 0, k: 0 };
      this.bossWarn = 2.5;
      g.audio.playMusic(g.spec.audio.music.boss ? "boss" : "main", 0.5);
    }

    updateBoss(dt) {
      const b = this.boss, g = this.game, p = this.player;
      if (this.bossWarn) this.bossWarn = Math.max(0, this.bossWarn - dt);
      b.t += dt; b.flash = Math.max(0, b.flash - dt);
      if (b.dead) {
        b.deadT += dt; b.x += 10 * dt; b.y += 15 * dt;
        if (Math.random() < 0.6) g.particles.burst(b.x + (Math.random() - 0.5) * b.w, b.y + (Math.random() - 0.5) * b.h, 8, { colors: g.theme.fx, speed: 140, life: 0.5, glow: true });
        if (Math.random() < 0.2) g.audio.play("explode", { vol: 0.4, gap: 0.1 });
        if (b.deadT > 2) { g.gfx.flash("#fff", 1); this.cam.shake(1); g.addScore(10000); this.boss = null; this.bossDone = true; }
        return;
      }
      const tx = this.W - 70;
      if (!b.active) { b.x = damp(b.x, tx, 1.5, dt); if (Math.abs(b.x - tx) < 4) b.active = true; return; }
      b.y = this.H / 2 + Math.sin(b.t * 0.7) * (this.H * 0.28);
      b.x = tx + Math.sin(b.t * 0.45) * 18;
      const phase = b.hp < b.maxHp * 0.33 ? 2 : b.hp < b.maxHp * 0.66 ? 1 : 0;
      if (phase !== b.phase) { b.phase = phase; this.cam.shake(0.5); g.audio.play("explode"); g.floaters.add(phase === 2 ? "CRITICAL!" : "ARMOR BREAK", b.x, b.y - b.h / 2 - 6, g.theme.danger); this.eshots.length = 0; }
      b.timer -= dt;
      const a = angleTo(b.x, b.y, p.x, p.y);
      const pats = [["fan", "ring"], ["fan", "spiral", "ring"], ["spiral", "fan", "ring", "rain"]][phase];
      const cur = pats[b.pat % pats.length];
      if (cur === "fan" && b.timer <= 0) { const n = 5 + phase * 2; for (let i = 0; i < n; i++) this.fire(b.x - b.w / 2, b.y, a + (i - (n - 1) / 2) * 0.13, 120 + phase * 15); b.k++; b.timer = 0.35; g.audio.play("shoot", { pitch: 0.6, vol: 0.4 }); }
      else if (cur === "ring" && b.timer <= 0) { const n = 18 + phase * 4; for (let i = 0; i < n; i++) this.fire(b.x, b.y, (i / n) * TAU + b.k * 0.15, 80 + phase * 10, { r: 4 }); b.k++; b.timer = 0.6; g.audio.play("shoot", { pitch: 0.5, vol: 0.4 }); }
      else if (cur === "spiral") { b.timer -= dt * 4; if (b.timer <= 0) { for (let i = 0; i < 2 + phase; i++) this.fire(b.x, b.y, b.t * 3.3 + (i * TAU) / (2 + phase), 95); b.timer = 0.07; b.k += 0.07; } }
      else if (cur === "rain" && b.timer <= 0) { for (let i = 0; i < 6; i++) this.fire(b.x - b.w / 2, b.y, Math.PI + (Math.random() - 0.5) * 1.6, 70 + Math.random() * 70, { r: 2.5 }); b.k += 0.5; b.timer = 0.15; }
      if (b.k >= (cur === "spiral" ? 3 : cur === "rain" ? 6 : 4)) { b.k = 0; b.pat++; b.timer = 1; }
      if (!p.dead && p.inv <= 0 && Math.abs(b.x - p.x) < b.w / 2 && Math.abs(b.y - p.y) < b.h / 2) this.hitPlayer();
    }

    damageBoss(n) {
      const b = this.boss, g = this.game;
      if (!b || b.dead || !b.active) return;
      b.hp -= n; b.flash = 0.05;
      if (Math.random() < 0.3) g.audio.play("hit", { vol: 0.3, pitch: 0.6, gap: 0.06 });
      if (b.hp <= 0) { b.dead = true; b.deadT = 0; this.eshots.length = 0; g.audio.stopMusic(1.5); g.stats.kills++; }
    }

    finish() {
      if (this.done) return;
      this.done = true;
      const g = this.game;
      g.carry.power = this.player.power;
      g.levelComplete({ kills: this.kills, timeBonus: this.bestChain * 100 + this.player.bombs * 500 });
    }
    forceWin() { this.bossDone = true; this.boss = null; this.enemies.length = 0; this.finish(); }

    // ---------- drawing ----------
    draw(gfx) {
      const g = this.game, ctx = gfx.ctx, T = g.theme;
      const camX = this.t * this.scroll;
      g.drawParallax(this.L.bg || "main", camX, 0, gfx.H);
      for (const s of this.stars) { ctx.globalAlpha = s.z * 0.8; gfx.rect(s.x, s.y, s.z > 0.75 ? 2 : 1, 1, "#ffffff"); }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(-Math.round(this.cam.ox), -Math.round(this.cam.oy));
      for (const d of this.drops) {
        const x = d.x, y = d.y;
        if (d.kind === "medal") { gfx.circle(x, y, 3.5, T.gold); gfx.rect(x - 1, y - 2, 1, 2, "#fff"); continue; }
        const col = d.kind === "P" ? T.accent : d.kind === "S" ? T.good : T.gold;
        ctx.globalAlpha = 0.4; gfx.circle(x, y, 8 + Math.sin(d.t * 8), col); ctx.globalAlpha = 1;
        gfx.circle(x, y, 6, col); gfx.text(d.kind, x - 2, y - 3, { color: T.shadow });
      }
      for (const e of this.enemies) {
        if (e.delay > 0) continue;
        g.drawActor(e.spr, e.x, e.y + e.h / 2, { state: "fly", t: e.t, flip: true, flash: e.flash > 0, color: T.accent2 });
        if (e.carrier) { ctx.globalAlpha = 0.5 + Math.sin(e.t * 10) * 0.3; gfx.ring(e.x, e.y, e.w * 0.7, T.gold, 1); ctx.globalAlpha = 1; }
      }
      if (this.boss) {
        const b = this.boss;
        g.drawActor(b.spr, b.x + (b.dead ? (Math.random() - 0.5) * 6 : 0), b.y + b.h / 2, { state: "fly", t: b.t, flip: true, flash: b.flash > 0, color: T.danger });
      }
      this.drawPlayer(gfx);
      for (const s of this.shots) {
        if (s.missile) { gfx.rect(s.x - 3, s.y - 1, 6, 2, T.text); gfx.rect(s.x + 2, s.y - 1, 2, 2, T.danger); continue; }
        ctx.globalCompositeOperation = "lighter"; gfx.rect(s.x - 5, s.y - 1.5, 9, 3, CG.rgba(T.accent, 0.6)); ctx.globalCompositeOperation = "source-over";
        gfx.rect(s.x - 3, s.y - 0.5, 7, 1, "#fff");
      }
      for (const s of this.eshots) { gfx.circle(s.x, s.y, s.r + 1, s.color || T.danger); gfx.circle(s.x, s.y, s.r * 0.5, "#fff"); }
      if (this.bombFx) {
        this.bombFx.t += 1 / 60;
        const k = this.bombFx.t / 0.6;
        ctx.globalAlpha = Math.max(0, 1 - k); gfx.ring(this.bombFx.x, this.bombFx.y, k * this.W, T.gold, 6); ctx.globalAlpha = 1;
        if (k > 1) this.bombFx = null;
      }
      g.particles.draw(ctx, 0, 0);
      g.floaters.draw(gfx, 0, 0);
      ctx.restore();
    }

    drawPlayer(gfx) {
      const g = this.game, p = this.player, T = g.theme;
      if (p.dead) return;
      if (p.inv > 0 && Math.floor(p.inv * 16) % 2 === 0) return;
      const spr = g.sprites[g.spec.player.sprite || "player"];
      // engine flame
      const fl = 3 + Math.random() * 3;
      gfx.rect(p.x - 10 - fl, p.y - 1, fl, 2, T.gold);
      gfx.rect(p.x - 8 - fl * 0.5, p.y - 0.5, fl * 0.5, 1, "#fff");
      if (spr) g.gfx.sprite(spr, g.anim(spr, "idle", p.t), p.x, p.y + spr.fh / 2, { rot: p.tilt });
      else {
        const ctx = gfx.ctx;
        ctx.fillStyle = T.accent; ctx.beginPath(); ctx.moveTo(p.x + 9, p.y); ctx.lineTo(p.x - 7, p.y - 6); ctx.lineTo(p.x - 4, p.y); ctx.lineTo(p.x - 7, p.y + 6); ctx.fill();
      }
      if (p.shield) { gfx.ctx.globalAlpha = 0.45 + Math.sin(p.t * 8) * 0.15; gfx.ring(p.x, p.y, 13, T.good, 1.5); gfx.ctx.globalAlpha = 1; }
      if (p.focus) { gfx.circle(p.x, p.y, 2.5, "#fff"); gfx.ring(p.x, p.y, 3.5, T.danger, 1); }
    }

    hud(gfx) {
      const g = this.game, T = g.theme, p = this.player;
      g.drawHud({ lives: g.lives, counters: [{ value: "PWR " + p.power, color: T.accent }, { value: "BOMB " + p.bombs, color: T.gold }], center: this.chain > 1 ? `CHAIN x${this.chain}` : null, centerColor: T.gold });
      if (!this.boss && !this.bossDone) gfx.bar(gfx.W / 2 - 60, gfx.H - 6, 120, 2, this.t / this.length, T.textDim, CG.rgba(T.shadow, 0.5));
      if (this.boss && !this.boss.dead) {
        gfx.text((this.boss.def.name || "BOSS").toUpperCase(), gfx.W / 2, 20, { align: "center", color: T.text, outline: T.shadow });
        gfx.bar(gfx.W / 2 - 90, 30, 180, 5, this.boss.hp / this.boss.maxHp, T.danger);
      }
      if (this.bossWarn) { gfx.ctx.globalAlpha = Math.min(1, this.bossWarn); gfx.text("WARNING", gfx.W / 2, gfx.H * 0.35, { align: "center", scale: 3, color: T.danger, outline: T.shadow }); gfx.ctx.globalAlpha = 1; }
    }

    demoUpdate(dt) { this.update(dt); }
    drawDemo(gfx) { this.draw(gfx); }
  }

  function defaultWaves(n, length) {
    const pats = ["line", "sine", "v", "dive", "column", "turret", "swarm", "circle"];
    const out = [];
    for (let t = 1.5, i = 0; t < length; t += 4.2, i++) out.push({ t, pattern: pats[i % pats.length], enemy: i % n, count: 4 + (i % 3), y: 0.2 + ((i * 0.37) % 0.6) });
    return out;
  }

  CG.defineGenre("shmup", {
    create: (game, i, opts) => new Shmup(game, i, opts),
    controls: [["Move", "Arrows / WASD"], ["Fire", "Automatic"], ["Focus (slow, precise)", "Shift / C"], ["Bomb", "X / J"]],
  });
})();
