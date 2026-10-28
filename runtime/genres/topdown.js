/* Shared top-down systems for the arena and dungeon genres: bodies, enemy AI, weapons, projectiles. */
(() => {
  const TS = 16;
  const TD = (CG.TD = {});

  // Behaviour names from any genre map onto top-down movement styles.
  TD.BEHAVIOR = {
    walker: "chaser", chaser: "chaser", hopper: "runner", runner: "runner", flyer: "orbiter", orbiter: "orbiter", ghost: "orbiter",
    shooter: "shooter", turret: "turret", charger: "charger", spiky: "tank", tank: "tank", splitter: "splitter", exploder: "exploder",
    weaver: "orbiter", kamikaze: "exploder", spinner: "turret", swarm: "runner",
  };

  TD.WEAPONS = {
    blaster: { rate: 3.2, dmg: 1, speed: 260, spread: 0, count: 1, size: 3, pierce: 0, range: 190 },
    spread: { rate: 2.2, dmg: 1, speed: 240, spread: 0.32, count: 3, size: 3, pierce: 0, range: 160 },
    laser: { rate: 5, dmg: 0.7, speed: 420, spread: 0, count: 1, size: 2, pierce: 2, range: 230 },
    magic: { rate: 1.8, dmg: 2, speed: 150, spread: 0, count: 1, size: 4, pierce: 0, homing: 3.5, range: 200 },
    sword: { rate: 2.6, dmg: 2, melee: true, reach: 22, arc: 2.2, range: 34 },
  };

  TD.UPGRADES = [
    { id: "dmg", name: "Power Up", desc: "+25% damage", apply: (s) => (s.dmgMul *= 1.25) },
    { id: "rate", name: "Rapid Fire", desc: "+20% attack speed", apply: (s) => (s.rateMul *= 1.2) },
    { id: "multi", name: "Multishot", desc: "+1 projectile", apply: (s) => (s.extra += 1), ranged: true },
    { id: "pierce", name: "Piercing", desc: "Shots pierce +1", apply: (s) => (s.pierce += 1), ranged: true },
    { id: "speed", name: "Swift Boots", desc: "+12% move speed", apply: (s) => (s.speedMul *= 1.12) },
    { id: "hp", name: "Vitality", desc: "+1 max HP, heal", apply: (s, p) => { p.maxHp += 1; p.hp = p.maxHp; } },
    { id: "magnet", name: "Magnet", desc: "+50% pickup range", apply: (s) => (s.magnet *= 1.5) },
    { id: "orbit", name: "Orbit Blades", desc: "+1 circling blade", apply: (s) => (s.orbit += 1) },
    { id: "nova", name: "Shock Nova", desc: "Periodic blast", apply: (s) => (s.nova += 1) },
    { id: "regen", name: "Regeneration", desc: "Heal 1 HP every 20s", apply: (s) => (s.regen += 1) },
    { id: "crit", name: "Lucky Strike", desc: "+15% critical hits", apply: (s) => (s.crit += 0.15) },
  ];

  TD.newStats = () => ({ dmgMul: 1, rateMul: 1, extra: 0, pierce: 0, speedMul: 1, magnet: 1, orbit: 0, nova: 0, regen: 0, crit: 0.05 });

  // Axis-separated movement against a tile grid where `solid(tx,ty)` blocks.
  TD.move = (b, dt, solid) => {
    b.hit = false;
    b.x += b.vx * dt;
    const t0 = Math.floor(b.y / TS), t1 = Math.floor((b.y + b.h - 0.01) / TS);
    if (b.vx > 0) { const tx = Math.floor((b.x + b.w) / TS); for (let ty = t0; ty <= t1; ty++) if (solid(tx, ty)) { b.x = tx * TS - b.w - 0.01; b.vx = 0; b.hit = true; break; } }
    else if (b.vx < 0) { const tx = Math.floor(b.x / TS); for (let ty = t0; ty <= t1; ty++) if (solid(tx, ty)) { b.x = (tx + 1) * TS + 0.01; b.vx = 0; b.hit = true; break; } }
    b.y += b.vy * dt;
    const l = Math.floor(b.x / TS), r = Math.floor((b.x + b.w - 0.01) / TS);
    if (b.vy > 0) { const ty = Math.floor((b.y + b.h) / TS); for (let tx = l; tx <= r; tx++) if (solid(tx, ty)) { b.y = ty * TS - b.h - 0.01; b.vy = 0; b.hit = true; break; } }
    else if (b.vy < 0) { const ty = Math.floor(b.y / TS); for (let tx = l; tx <= r; tx++) if (solid(tx, ty)) { b.y = (ty + 1) * TS + 0.01; b.vy = 0; b.hit = true; break; } }
  };

  TD.makeEnemy = (world, def, x, y, scale = 1) => {
    const g = world.game;
    if (typeof def === "string" || typeof def === "number") def = g.spec.enemies.find((e) => e.id === def) || g.spec.enemies[def | 0] || g.spec.enemies[0];
    const spr = g.sprites[def.sprite || def.id];
    const beh = TD.BEHAVIOR[(def.behavior || "chaser").toLowerCase()] || "chaser";
    const size = (spr ? Math.min(spr.fw, spr.fh) * 0.7 : 11) * scale;
    const diff = g.spec.rules.difficulty || 1;
    const hpBase = (def.hp || 1) * (beh === "tank" ? 4 : beh === "runner" ? 0.6 : 1.5);
    const e = {
      def, spr, beh, x: x - size / 2, y: y - size / 2, w: size, h: size, vx: 0, vy: 0, scale,
      hp: hpBase * (world.hpScale || 1) * (0.7 + diff * 0.3), face: 1, t: Math.random() * 5, flash: 0, timer: 1 + Math.random() * 2,
      speed: (def.speed || 1) * (beh === "runner" ? 70 : beh === "tank" ? 26 : beh === "exploder" ? 62 : 42) * (0.85 + diff * 0.15) * (world.speedScale || 1),
      dmg: def.damage || 1, state: "move", kx: 0, ky: 0, dead: false, orbitA: Math.random() * TAU,
    };
    e.maxHp = e.hp;
    return e;
  };

  TD.updateEnemy = (world, e, dt) => {
    const g = world.game, p = world.player;
    e.t += dt; e.flash = Math.max(0, e.flash - dt);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    let tvx = 0, tvy = 0;
    const sp = e.speed * (world.slow || 1);
    switch (e.beh) {
      case "runner": {
        const burst = Math.sin(e.t * 3) > -0.2 ? 1.25 : 0.35;
        tvx = ux * sp * burst; tvy = uy * sp * burst; break;
      }
      case "orbiter": {
        e.orbitA += dt * 1.2;
        const want = 50 + Math.sin(e.t) * 20;
        const ox = px + Math.cos(e.orbitA) * want, oy = py + Math.sin(e.orbitA) * want;
        tvx = clamp((ox - cx) * 2, -sp * 1.3, sp * 1.3); tvy = clamp((oy - cy) * 2, -sp * 1.3, sp * 1.3);
        break;
      }
      case "shooter": {
        const keep = d < 90 ? -1 : d > 150 ? 1 : 0;
        tvx = ux * sp * keep + -uy * sp * 0.4 * Math.sin(e.t * 0.7); tvy = uy * sp * keep + ux * sp * 0.4 * Math.sin(e.t * 0.7);
        e.timer -= dt;
        if (e.timer <= 0 && d < 220) {
          e.timer = 2 + Math.random();
          world.enemyShot(cx, cy, Math.atan2(dy, dx), 110);
        }
        break;
      }
      case "turret": {
        e.timer -= dt;
        if (e.timer <= 0 && d < 240) {
          e.timer = 2.4;
          const base = e.t * 0.7;
          for (let i = 0; i < 8; i++) world.enemyShot(cx, cy, base + (i * TAU) / 8, 80);
        }
        tvx = ux * sp * 0.25; tvy = uy * sp * 0.25;
        break;
      }
      case "charger": {
        if (e.state === "move") {
          tvx = ux * sp * 0.6; tvy = uy * sp * 0.6;
          e.timer -= dt;
          if (e.timer <= 0 && d < 150) { e.state = "tell"; e.timer = 0.5; e.cdx = ux; e.cdy = uy; }
        } else if (e.state === "tell") { e.timer -= dt; if (e.timer <= 0) { e.state = "charge"; e.timer = 0.55; g.audio.play("dash", { vol: 0.4 }); } }
        else { tvx = e.cdx * sp * 5; tvy = e.cdy * sp * 5; e.timer -= dt; if (e.timer <= 0) { e.state = "move"; e.timer = 1.5 + Math.random(); } }
        if (e.state === "charge") { e.vx = tvx; e.vy = tvy; }
        break;
      }
      case "exploder": {
        tvx = ux * sp; tvy = uy * sp;
        if (d < 22 && e.state !== "fuse") { e.state = "fuse"; e.timer = 0.55; }
        if (e.state === "fuse") {
          tvx *= 0.2; tvy *= 0.2; e.timer -= dt; e.flash = Math.floor(e.timer * 14) % 2 ? 0.05 : 0;
          if (e.timer <= 0) { world.explode(cx, cy, 30, e.dmg); e.hp = 0; world.killEnemy(e, true); return; }
        }
        break;
      }
      default: tvx = ux * sp; tvy = uy * sp; // chaser, tank, splitter
    }
    if (e.state !== "charge") { e.vx = damp(e.vx, tvx, 6, dt); e.vy = damp(e.vy, tvy, 6, dt); }
    // knockback & separation
    if (Math.abs(e.vx) > 4) e.face = sign(e.vx);
    const bvx = e.vx, bvy = e.vy;
    e.vx += e.kx; e.vy += e.ky;
    if (e.beh === "orbiter") { e.x += e.vx * dt; e.y += e.vy * dt; }
    else TD.move(e, dt, world.solidFn);
    e.hitWall = e.hit;
    e.vx = bvx; e.vy = bvy;
    e.kx *= Math.exp(-10 * dt); e.ky *= Math.exp(-10 * dt);
  };

  // Cheap separation so swarms spread out instead of stacking.
  TD.separate = (list, dt) => {
    const cell = 24, grid = new Map();
    for (const e of list) { const k = ((e.x / cell) | 0) + "," + ((e.y / cell) | 0); (grid.get(k) || grid.set(k, []).get(k)).push(e); }
    for (const e of list) {
      const gx = (e.x / cell) | 0, gy = (e.y / cell) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const arr = grid.get(gx + ox + "," + (gy + oy));
        if (!arr) continue;
        for (const o of arr) {
          if (o === e) continue;
          const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), min = (e.w + o.w) * 0.45;
          if (d > 0 && d < min) { const push = ((min - d) / min) * 60 * dt; e.x += (dx / d) * push; e.y += (dy / d) * push; }
        }
      }
    }
  };

  TD.drawEnemy = (world, gfx, e, vx, vy) => {
    const g = world.game;
    const x = e.x + e.w / 2 - vx, y = e.y + e.h - vy + 2;
    if (x < -40 || y < -40 || x > gfx.W + 40 || y > gfx.H + 40) return;
    gfx.ctx.globalAlpha = 0.3;
    gfx.ctx.fillStyle = "#000";
    gfx.ctx.beginPath(); gfx.ctx.ellipse(x, y - 1, e.w * 0.5, 2.5, 0, 0, TAU); gfx.ctx.fill();
    gfx.ctx.globalAlpha = 1;
    if (e.state === "tell") gfx.text("!", x, e.y - vy - 14, { color: g.theme.danger, outline: "#000", align: "center" });
    const shake = e.state === "tell" || e.state === "fuse" ? Math.sin(e.t * 60) : 0;
    g.drawActor(e.spr, x + shake, y, { state: e.beh === "orbiter" ? "fly" : "walk", t: e.t, flip: e.face > 0, scale: e.scale, flash: e.flash > 0, color: g.theme.accent2 });
    if (e.hp < e.maxHp && e.maxHp > 2 && !e.boss) gfx.bar(x - 8, e.y - vy - 5, 16, 2, e.hp / e.maxHp, g.theme.danger);
  };

  TD.drawShadow = (gfx, x, y, w) => {
    gfx.ctx.globalAlpha = 0.3; gfx.ctx.fillStyle = "#000";
    gfx.ctx.beginPath(); gfx.ctx.ellipse(x, y, w, 2.5, 0, 0, TAU); gfx.ctx.fill();
    gfx.ctx.globalAlpha = 1;
  };

  // Common combat world behaviour mixed into arena + dungeon worlds.
  TD.Combat = {
    initCombat() {
      this.enemies = []; this.shots = []; this.eshots = []; this.pickups = []; this.slashes = [];
      this.kills = 0;
      const P = this.game.spec.player;
      const wname = String(P.weapon || this.defaultWeapon || "blaster").toLowerCase();
      this.weapon = TD.WEAPONS[wname] || TD.WEAPONS.blaster;
      this.weaponName = wname;
      this.stats = (this.game.carry && this.game.carry.stats) || TD.newStats();
      this.orbitA = 0; this.novaT = 3; this.regenT = 20;
    },

    makePlayer(x, y) {
      const P = this.game.spec.player;
      const carry = this.game.carry || {};
      return {
        x: x - 5, y: y - 5, w: 10, h: 10, vx: 0, vy: 0, face: 1, aimX: 1, aimY: 0, hp: carry.hp || P.hp || 5, maxHp: carry.maxHp || P.hp || 5,
        inv: 0, cd: 0, rollT: 0, rollCd: 0, t: 0, state: "idle", dead: false, speed: 95 * (P.speed || 1),
      };
    },

    updatePlayerCore(dt) {
      const g = this.game, inp = g.input, p = this.player, S = this.stats;
      p.t += dt; p.inv = Math.max(0, p.inv - dt); p.cd = Math.max(0, p.cd - dt); p.rollCd = Math.max(0, p.rollCd - dt);
      const ax = inp.axis();
      if (p.rollT > 0) {
        p.rollT -= dt;
        p.vx = p.rdx * 250; p.vy = p.rdy * 250;
        if (Math.random() < 0.7) g.particles.emit({ x: p.x + p.w / 2, y: p.y + p.h, vx: 0, vy: -5, life: 0.3, size: 3, color: g.theme.textDim });
      } else {
        const sp = p.speed * S.speedMul;
        p.vx = damp(p.vx, ax.x * sp, 14, dt); p.vy = damp(p.vy, ax.y * sp, 14, dt);
        if (inp.pressed("a") && p.rollCd <= 0 && (ax.x || ax.y)) {
          p.rollT = 0.2; p.rollCd = 0.75; p.rdx = ax.x; p.rdy = ax.y; p.inv = Math.max(p.inv, 0.25);
          const m = Math.hypot(p.rdx, p.rdy) || 1; p.rdx /= m; p.rdy /= m;
          g.audio.play("dash", { vol: 0.6 });
        }
      }
      if (ax.x || ax.y) { p.aimX = ax.x; p.aimY = ax.y; const m = Math.hypot(p.aimX, p.aimY); p.aimX /= m; p.aimY /= m; }
      if (Math.abs(p.vx) > 5) p.face = sign(p.vx);
      TD.move(p, dt, this.solidFn);
      p.state = Math.hypot(p.vx, p.vy) > 20 ? "run" : "idle";
      // regen
      if (S.regen) { this.regenT -= dt * S.regen; if (this.regenT <= 0) { this.regenT = 20; if (p.hp < p.maxHp) { p.hp++; g.floaters.add("+1", p.x + 5, p.y - 6, g.theme.good); } } }
      this.updateOrbitNova(dt);
    },

    // Attack: auto-aim at the nearest enemy unless the player aims with mouse / right stick.
    attack(dt, auto) {
      const g = this.game, inp = g.input, p = this.player, W = this.weapon, S = this.stats;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const aim = inp.aim(cx - this.cam.vx, cy - this.cam.vy);
      let dir = null;
      let wants = auto;
      if (aim && (aim.firing || inp.mouse.active)) { dir = { x: aim.x, y: aim.y }; if (aim.firing) wants = true; }
      if (inp.down("b") || inp.pressedNow.fire) wants = true;
      if (!dir) {
        let best = null, bd = W.range * 1.15;
        for (const e of this.enemies) { if (e.dead) continue; const d = dist(cx, cy, e.x + e.w / 2, e.y + e.h / 2); if (d < bd) { bd = d; best = e; } }
        if (this.boss && !this.boss.dead && this.boss.active) { const d = dist(cx, cy, this.boss.x + this.boss.w / 2, this.boss.y + this.boss.h / 2); if (d < bd * 1.4) best = this.boss; }
        if (best) { const a = angleTo(cx, cy, best.x + best.w / 2, best.y + best.h / 2); dir = { x: Math.cos(a), y: Math.sin(a) }; }
        else if (!auto) dir = { x: p.aimX, y: p.aimY };
      }
      if (!wants || !dir || p.cd > 0 || p.rollT > 0) return;
      if (auto && !this.enemies.length && !(this.boss && this.boss.active)) return;
      p.cd = 1 / (W.rate * S.rateMul);
      p.face = dir.x ? sign(dir.x) : p.face;
      if (W.melee) {
        const a = Math.atan2(dir.y, dir.x);
        this.slashes.push({ x: cx, y: cy, a, t: 0, life: 0.18, reach: W.reach * (1 + S.extra * 0.15), arc: W.arc });
        g.audio.play("shoot", { pitch: 0.7, vol: 0.7 });
        const hit = (e) => {
          const ex = e.x + e.w / 2, ey = e.y + e.h / 2, d = dist(cx, cy, ex, ey);
          if (d > W.reach * (1 + S.extra * 0.15) + e.w * 0.5) return false;
          let da = Math.atan2(ey - cy, ex - cx) - a; da = Math.atan2(Math.sin(da), Math.cos(da));
          return Math.abs(da) < W.arc / 2 + 0.3;
        };
        for (const e of this.enemies) if (!e.dead && hit(e)) this.damageEnemy(e, W.dmg, Math.cos(a), Math.sin(a));
        if (this.boss && !this.boss.dead && hit(this.boss)) this.damageBoss(W.dmg);
        for (const s of this.eshots) if (dist(cx, cy, s.x, s.y) < W.reach + 4) s.life = 0;
        return;
      }
      const n = W.count + S.extra;
      const spread = W.spread || (n > 1 ? 0.18 : 0);
      const base = Math.atan2(dir.y, dir.x);
      for (let i = 0; i < n; i++) {
        const a = base + (n > 1 ? (i - (n - 1) / 2) * (spread * 2 / Math.max(1, n - 1)) * Math.min(1, n / 3) : 0);
        this.shots.push({ x: cx + Math.cos(a) * 6, y: cy + Math.sin(a) * 6, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, life: W.range / W.speed + 0.1, dmg: W.dmg, size: W.size, pierce: W.pierce + S.pierce, homing: W.homing, hits: new Set() });
      }
      g.audio.play("shoot", { vol: 0.45 });
    },

    updateOrbitNova(dt) {
      const g = this.game, p = this.player, S = this.stats;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (S.orbit) {
        this.orbitA += dt * 3.2;
        for (let i = 0; i < S.orbit; i++) {
          const a = this.orbitA + (i * TAU) / S.orbit, bx = cx + Math.cos(a) * 30, by = cy + Math.sin(a) * 30;
          for (const e of this.enemies) if (!e.dead && dist(bx, by, e.x + e.w / 2, e.y + e.h / 2) < e.w / 2 + 5 && (!e.orbHit || e.orbHit < this.t)) { e.orbHit = this.t + 0.4; this.damageEnemy(e, 1 * S.dmgMul, Math.cos(a), Math.sin(a)); }
          if (this.boss && this.boss.active && !this.boss.dead && dist(bx, by, this.boss.x + this.boss.w / 2, this.boss.y + this.boss.h / 2) < this.boss.w / 2 && (!this.boss.orbHit || this.boss.orbHit < this.t)) { this.boss.orbHit = this.t + 0.4; this.damageBoss(1); }
        }
      }
      if (S.nova) {
        this.novaT -= dt;
        if (this.novaT <= 0) {
          this.novaT = Math.max(1.5, 4.5 - S.nova * 0.6);
          this.novas = this.novas || [];
          this.novas.push({ x: cx, y: cy, t: 0 });
          g.audio.play("explode", { vol: 0.3, pitch: 1.5 });
          const R = 50 + S.nova * 10;
          for (const e of this.enemies) if (!e.dead && dist(cx, cy, e.x + e.w / 2, e.y + e.h / 2) < R) this.damageEnemy(e, 1.5 * S.dmgMul, 0, 0);
        }
      }
      if (this.novas) { for (const n of this.novas) n.t += dt; this.novas = this.novas.filter((n) => n.t < 0.4); }
    },

    updateShots(dt) {
      const g = this.game, p = this.player;
      for (const s of this.shots) {
        if (s.homing) {
          let best = null, bd = 120;
          for (const e of this.enemies) { if (e.dead) continue; const d = dist(s.x, s.y, e.x + e.w / 2, e.y + e.h / 2); if (d < bd) { bd = d; best = e; } }
          if (best) {
            const want = angleTo(s.x, s.y, best.x + best.w / 2, best.y + best.h / 2), cur = Math.atan2(s.vy, s.vx);
            let da = want - cur; da = Math.atan2(Math.sin(da), Math.cos(da));
            const na = cur + clamp(da, -s.homing * dt, s.homing * dt), sp = Math.hypot(s.vx, s.vy);
            s.vx = Math.cos(na) * sp; s.vy = Math.sin(na) * sp;
          }
        }
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (this.solidFn(Math.floor(s.x / TS), Math.floor(s.y / TS))) { s.life = 0; g.particles.burst(s.x, s.y, 3, { color: "#fff", speed: 40, life: 0.2 }); continue; }
        const box = { x: s.x - 3, y: s.y - 3, w: 6, h: 6 };
        for (const e of this.enemies) {
          if (e.dead || s.hits.has(e) || !overlap(box, e)) continue;
          s.hits.add(e);
          const m = Math.hypot(s.vx, s.vy) || 1;
          this.damageEnemy(e, s.dmg, s.vx / m, s.vy / m);
          if (s.pierce-- <= 0) { s.life = 0; break; }
        }
        if (s.life > 0 && this.boss && this.boss.active && !this.boss.dead && overlap(box, this.boss)) { this.damageBoss(s.dmg); s.life = 0; }
      }
      this.shots = this.shots.filter((s) => s.life > 0);
      for (const s of this.eshots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (!s.ghost && this.solidFn(Math.floor(s.x / TS), Math.floor(s.y / TS))) s.life = 0;
        if (!p.dead && dist(s.x, s.y, p.x + p.w / 2, p.y + p.h / 2) < 5 + (s.size || 3) * 0.5) { this.hurtPlayer(s.dmg || 1, s.vx, s.vy); s.life = 0; }
      }
      this.eshots = this.eshots.filter((s) => s.life > 0);
      for (const sl of this.slashes) sl.t += dt;
      this.slashes = this.slashes.filter((sl) => sl.t < sl.life);
    },

    enemyShot(x, y, a, sp, o = {}) {
      this.eshots.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: o.life || 4, size: o.size || 3, dmg: 1, ghost: o.ghost, color: o.color });
    },

    explode(x, y, r, dmg) {
      const g = this.game, p = this.player;
      g.audio.play("explode", { vol: 0.7 });
      this.cam.shake(0.3);
      g.particles.burst(x, y, 30, { colors: [g.theme.danger, g.theme.gold, "#fff"], speed: 150, life: 0.5, glow: true, size: 3 });
      this.booms = this.booms || [];
      this.booms.push({ x, y, r, t: 0 });
      if (!p.dead && dist(x, y, p.x + p.w / 2, p.y + p.h / 2) < r) this.hurtPlayer(dmg || 1, p.x - x, p.y - y);
    },

    damageEnemy(e, dmg, kx, ky) {
      const g = this.game, S = this.stats;
      if (e.dead) return;
      let d = dmg * S.dmgMul;
      const crit = Math.random() < S.crit;
      if (crit) d *= 2;
      e.hp -= d; e.flash = 0.1;
      e.kx += kx * (e.beh === "tank" ? 60 : 160); e.ky += ky * (e.beh === "tank" ? 60 : 160);
      g.floaters.add(crit ? Math.round(d * 10) / 10 + "!" : String(Math.round(d * 10) / 10), e.x + e.w / 2, e.y - 2, crit ? g.theme.gold : "#ffffff", { life: 0.5, vy: -40 });
      if (e.hp <= 0) this.killEnemy(e);
      else g.audio.play("hit", { vol: 0.5 });
    },

    killEnemy(e, silent) {
      const g = this.game;
      if (e.dead) return;
      e.dead = true;
      this.kills++; g.stats.kills++;
      g.addScore(e.def.score || 50);
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      if (!silent) g.audio.play("hit", { pitch: 1.3, vol: 0.7 });
      g.particles.burst(cx, cy, 12, { colors: [g.theme.accent2, "#fff", g.theme.accent], speed: 110, life: 0.4, size: 2 });
      g.hitstop = Math.max(g.hitstop, 0.015);
      if (e.beh === "splitter" && e.scale > 0.6) {
        for (let i = 0; i < 2; i++) {
          const c = TD.makeEnemy(this, e.def, cx + (i ? 6 : -6), cy, e.scale * 0.6);
          c.beh = "runner"; c.hp = c.maxHp = Math.max(1, e.maxHp * 0.3);
          c.kx = (i ? 1 : -1) * 120;
          this.enemies.push(c);
        }
      }
      this.onEnemyKilled && this.onEnemyKilled(e, cx, cy);
      g.emit("onEnemyKilled", e, this);
    },

    hurtPlayer(n = 1, kx = 0, ky = 0) {
      const g = this.game, p = this.player;
      if (p.inv > 0 || p.dead || this.done) return;
      p.hp -= n;
      g.emit("onPlayerHit", n, this);
      const m = Math.hypot(kx, ky) || 1;
      p.vx += (kx / m) * 160; p.vy += (ky / m) * 160;
      p.inv = 1.0;
      g.audio.play("hurt");
      g.hitstop = 0.06;
      this.cam.shake(0.4);
      g.gfx.flash(g.theme.danger, 0.25);
      g.particles.burst(p.x + p.w / 2, p.y + p.h / 2, 12, { colors: [g.theme.danger, "#fff"], speed: 110, life: 0.4 });
      if (p.hp <= 0) {
        p.dead = true; p.deadT = 0;
        g.audio.play("die");
        this.cam.shake(0.7);
        g.particles.burst(p.x + p.w / 2, p.y + p.h / 2, 40, { colors: [g.theme.danger, g.theme.accent, "#fff"], speed: 180, life: 0.8 });
      }
    },

    // After death animation: lose a life and restart the level, or game over.
    updateDeath(dt) {
      const p = this.player, g = this.game;
      p.deadT += dt;
      if (p.deadT > 1.4 && !p.reported) {
        p.reported = true;
        if (g.playerDied()) { g.carry.hp = 0; g.carry.maxHp = p.maxHp; g.go(() => g.beginLevel(g.levelIndex)); }
      }
    },

    drawCombatFx(gfx, vx, vy) {
      const g = this.game, T = g.theme, ctx = gfx.ctx, p = this.player, S = this.stats;
      for (const s of this.shots) {
        const x = s.x - vx, y = s.y - vy;
        ctx.globalCompositeOperation = "lighter";
        gfx.circle(x, y, s.size + 1.5, CG.rgba(T.accent, 0.35));
        ctx.globalCompositeOperation = "source-over";
        gfx.circle(x, y, s.size * 0.6, "#ffffff");
      }
      for (const s of this.eshots) {
        const x = s.x - vx, y = s.y - vy;
        gfx.circle(x, y, s.size + 1, s.color || T.danger);
        gfx.circle(x, y, s.size * 0.45, "#fff");
      }
      for (const sl of this.slashes) {
        const k = sl.t / sl.life;
        ctx.save();
        ctx.translate(sl.x - vx, sl.y - vy);
        ctx.rotate(sl.a);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, sl.reach * (0.7 + k * 0.3), -sl.arc / 2 + k * 0.4, sl.arc / 2 * (0.4 + k)); ctx.stroke();
        ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, sl.reach * (0.55 + k * 0.3), -sl.arc / 2 + k * 0.4, sl.arc / 2 * (0.4 + k)); ctx.stroke();
        ctx.restore();
      }
      if (S.orbit) {
        const cx = p.x + p.w / 2 - vx, cy = p.y + p.h / 2 - vy;
        for (let i = 0; i < S.orbit; i++) {
          const a = this.orbitA + (i * TAU) / S.orbit;
          const bx = cx + Math.cos(a) * 30, by = cy + Math.sin(a) * 30;
          ctx.save(); ctx.translate(bx, by); ctx.rotate(a * 3);
          gfx.rect(-5, -1, 10, 2, "#fff"); gfx.rect(-1, -5, 2, 10, T.accent);
          ctx.restore();
        }
      }
      for (const n of this.novas || []) { ctx.globalAlpha = 1 - n.t / 0.4; gfx.ring(n.x - vx, n.y - vy, 10 + (n.t / 0.4) * (50 + S.nova * 10), T.accent, 3); ctx.globalAlpha = 1; }
      for (const b of this.booms || []) { b.t += 1 / 60; ctx.globalAlpha = Math.max(0, 1 - b.t / 0.35); gfx.circle(b.x - vx, b.y - vy, b.r * (0.4 + b.t * 2), T.gold); ctx.globalAlpha = 1; }
      if (this.booms) this.booms = this.booms.filter((b) => b.t < 0.35);
    },

    drawPlayerTD(gfx, vx, vy) {
      const g = this.game, p = this.player;
      const spr = g.sprites[g.spec.player.sprite || "player"];
      const x = p.x + p.w / 2 - vx, y = p.y + p.h - vy + 2;
      TD.drawShadow(gfx, x, y - 1, 6);
      if (p.dead) { g.drawActor(spr, x, y, { state: "hurt", t: p.t, rot: p.deadT * 6, alpha: Math.max(0, 1 - p.deadT) }); return; }
      if (p.inv > 0 && p.rollT <= 0 && Math.floor(p.inv * 20) % 2 === 0) return;
      g.drawActor(spr, x, y, { state: p.rollT > 0 ? "jump" : p.state, t: p.t, flip: p.face < 0, rot: p.rollT > 0 ? (0.2 - p.rollT) * 30 * p.face : 0 });
    },
  };
})();
