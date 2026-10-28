/* Platformer: tight controls (coyote time, jump buffer, variable jump), stomps, hazards, checkpoints, bosses. */
(() => {
  const TS = 16;
  const SOLID = new Set(["#", "?", "U", "X"]);
  const PHYS = {
    gravity: 1500, maxFall: 430, accel: 1700, airAccel: 1100, friction: 2000, maxRun: 125,
    jump: 395, cut: 0.45, coyote: 0.1, buffer: 0.13, apexG: 0.55, double: 335, spring: 600, stomp: 310,
  };

  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };

  class World {
    constructor(game, index, opts) {
      this.game = game;
      this.demo = !!opts.demo;
      const spec = game.spec;
      this.L = spec.levels[index] || spec.levels[0];
      const rows = (this.L.tiles && this.L.tiles.length ? this.L.tiles : DEFAULT_LEVEL).map((r) => r.split(""));
      this.h = rows.length;
      this.w = Math.max(...rows.map((r) => r.length));
      this.grid = rows.map((r) => { while (r.length < this.w) r.push("."); return r; });
      this.pw = this.w * TS; this.ph = this.h * TS;
      this.cam = new CG.Camera(game.W, game.H);
      this.cam.setBounds(0, 0, this.pw, this.ph);
      this.enemies = []; this.items = []; this.shots = []; this.platforms = []; this.springs = []; this.checkpoints = [];
      this.crumbles = new Map();
      this.t = 0;
      this.coins = 0; this.coinsTotal = 0; this.gems = 0; this.kills = 0;
      this.boss = null;
      this.goal = null;
      this.done = false;
      this.diff = (spec.rules.difficulty || 1);
      this.abil = new Set((spec.player.abilities || []).map((a) => String(a).toLowerCase()));
      this.pmul = { speed: spec.player.speed || 1, jump: spec.player.jump || 1 };
      this._parse();
      this._spawnPlayer();
      this.cam.snap(this.player.x, this.player.y);
      this.staticLayer = this._prerender();
    }

    _parse() {
      const spec = this.game.spec;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const c = this.grid[y][x];
        const px = x * TS, py = y * TS;
        let clear = true;
        if (c === "P") this.start = { x: px + TS / 2, y: py + TS };
        else if (c === "G") this.goal = { x: px, y: py - TS * 2, w: TS, h: TS * 3 };
        else if (c === "C") this.checkpoints.push({ x: px, y: py, on: false });
        else if (c === "o") { this.items.push({ kind: "coin", x: px + 4, y: py + 4, w: 8, h: 8, by: py + 4 }); this.coinsTotal++; }
        else if (c === "*") this.items.push({ kind: "gem", x: px + 2, y: py + 2, w: 12, h: 12, by: py + 2 });
        else if (c === "H") this.items.push({ kind: "heart", x: px + 3, y: py + 3, w: 10, h: 10, by: py + 3 });
        else if (c === "S") this.springs.push({ x: px, y: py + 6, w: TS, h: 10, squash: 0 });
        else if (c === "M" || c === "V") this.platforms.push({ x: px - TS, y: py, w: TS * 3, h: 6, ox: px - TS, oy: py, axis: c === "M" ? "x" : "y", range: TS * 3, t: hash(x, y) * TAU, dx: 0, dy: 0 });
        else if (c === "B") this.bossSpawn = { x: px + TS / 2, y: py + TS };
        else if (c >= "a" && c <= "h") {
          const def = spec.enemies[(c.charCodeAt(0) - 97) % spec.enemies.length];
          this.spawnEnemy(def, px + TS / 2, py + TS);
        } else clear = false;
        if (clear) this.grid[y][x] = ".";
      }
      if (!this.start) this.start = { x: TS * 2, y: (this.h - 3) * TS };
      if (!this.goal && !this.bossSpawn) this.goal = { x: this.pw - TS * 3, y: this.ph - TS * 6, w: TS, h: TS * 3 };
      if (this.bossSpawn && !this.demo) this._spawnBoss();
    }

    _spawnPlayer() {
      const P = this.game.spec.player;
      const cp = this.game.carry && this.game.carry.checkpoint;
      const s = cp && cp.level === this.game.levelIndex ? cp : this.start;
      const spr = this.game.sprites[P.sprite || "player"];
      const pw = spr ? clamp(Math.round(spr.fw * 0.6), 10, 16) : 10, ph = spr ? clamp(Math.round(spr.fh * 0.85), 14, 30) : 14;
      this.player = {
        x: s.x - pw / 2, y: s.y - ph, w: pw, h: ph, vx: 0, vy: 0, face: 1, ground: false, coyote: 0, buffer: 0, jumps: 0,
        hp: P.hp || 3, maxHp: P.hp || 3, inv: 0, dashT: 0, dashCd: 0, canDash: true, wall: 0, wallLock: 0,
        sx: 1, sy: 1, t: 0, state: "idle", dead: false, deadT: 0, shotCd: 0, trail: [], stepT: 0,
      };
      if (this.game.carry && this.game.carry.hp && !this.demo) this.player.hp = Math.min(this.player.maxHp, this.game.carry.hp);
    }

    spawnEnemy(def, x, y) {
      if (typeof def === "string" || typeof def === "number") def = this.game.spec.enemies.find((e) => e.id === def) || this.game.spec.enemies[def | 0] || this.game.spec.enemies[0];
      const spr = this.game.sprites[def.sprite || def.id];
      const w = spr ? Math.max(8, Math.min(spr.fw - 4, 26)) : 12, h = spr ? Math.max(8, Math.min(spr.fh - 2, 28)) : 12;
      const e = {
        def, spr, x: x - w / 2, y: y - h, w, h, vx: 0, vy: 0, hp: def.hp || 1, face: -1, t: Math.random() * 3, ground: false,
        state: "walk", timer: 1 + Math.random(), flash: 0, ox: x, oy: y - h, behavior: (def.behavior || "walker").toLowerCase(),
        speed: (def.speed || 1) * 38 * (0.85 + this.diff * 0.15), dead: false,
      };
      if (e.behavior === "flyer") e.fly = true;
      this.enemies.push(e);
      return e;
    }

    _spawnBoss() {
      const spec = this.game.spec;
      const def = spec.boss || { name: "Boss", hp: 12 };
      const spr = this.game.sprites[def.sprite || "boss"];
      const w = spr ? Math.min(spr.fw - 6, 44) : 30, h = spr ? Math.min(spr.fh - 4, 44) : 30;
      this.boss = {
        def, spr, x: this.bossSpawn.x - w / 2, y: this.bossSpawn.y - h, w, h, vx: 0, vy: 0, hp: (def.hp || 12) * (0.7 + this.diff * 0.3),
        maxHp: (def.hp || 12) * (0.7 + this.diff * 0.3), face: -1, state: "intro", timer: 1.5, flash: 0, inv: 0, t: 0, ground: false, phase: 1, active: false,
      };
      this.arenaX = this.bossSpawn.x - this.game.W * 0.75;
    }

    // ---------- tiles ----------
    tile(tx, ty) {
      if (tx < 0 || tx >= this.w) return "#";
      if (ty < 0 || ty >= this.h) return ".";
      return this.grid[ty][tx];
    }
    solid(tx, ty) {
      const c = this.tile(tx, ty);
      if (c === "X") { const cr = this.crumbles.get(tx + "," + ty); return !(cr && cr.gone); }
      return SOLID.has(c);
    }

    _prerender() {
      const g = this.game.gfx;
      const c = g.makeCanvas(this.pw, this.ph), ctx = c.getContext("2d");
      const T = this.game.theme, tiles = this.game.tiles;
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const ch = this.grid[y][x];
        if (ch === "#") {
          const m = (this.isWall(x, y - 1) ? 0 : 1) | (this.isWall(x + 1, y) ? 0 : 2) | (this.isWall(x, y + 1) ? 0 : 4) | (this.isWall(x - 1, y) ? 0 : 8);
          if (tiles) this._tile(ctx, tiles, m, x * TS, y * TS);
          else {
            ctx.fillStyle = T.panel; ctx.fillRect(x * TS, y * TS, TS, TS);
            if (m & 1) { ctx.fillStyle = T.accent; ctx.fillRect(x * TS, y * TS, TS, 3); }
          }
          if (m & 1 && tiles && hash(x, y) < 0.32 && this.tile(x, y - 1) === ".") this._tile(ctx, tiles, 25 + Math.floor(hash(y, x) * 3), x * TS, (y - 1) * TS);
        } else if (ch === "=") {
          const l = this.tile(x - 1, y) === "=", r = this.tile(x + 1, y) === "=";
          if (tiles) this._tile(ctx, tiles, !l ? 16 : !r ? 18 : 17, x * TS, y * TS);
          else { ctx.fillStyle = T.accent2; ctx.fillRect(x * TS, y * TS, TS, 4); }
        } else if (ch === "^") {
          if (tiles) this._tile(ctx, tiles, 19, x * TS, y * TS);
          else { ctx.fillStyle = "#ddd"; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x * TS + i * 4, y * TS + TS); ctx.lineTo(x * TS + i * 4 + 2, y * TS + 8); ctx.lineTo(x * TS + i * 4 + 4, y * TS + TS); ctx.fill(); } }
        }
      }
      return c;
    }
    isWall(x, y) { const c = this.tile(x, y); return c === "#" || (y >= this.h && this.tile(x, this.h - 1) === "#"); }
    _tile(ctx, tiles, idx, x, y) {
      const cols = tiles.cols || 8, s = tiles.size || TS;
      ctx.drawImage(tiles.img, (idx % cols) * s, Math.floor(idx / cols) * s, s, s, x, y, TS, TS);
    }

    // ---------- physics ----------
    moveBody(b, dt, opts = {}) {
      b.hitWall = 0; b.hitCeil = false;
      const wasGround = b.ground;
      b.x += b.vx * dt;
      const top = Math.floor(b.y / TS), bot = Math.floor((b.y + b.h - 0.01) / TS);
      if (b.vx > 0) {
        const tx = Math.floor((b.x + b.w) / TS);
        for (let ty = top; ty <= bot; ty++) if (this.solid(tx, ty)) { b.x = tx * TS - b.w; b.vx = 0; b.hitWall = 1; break; }
      } else if (b.vx < 0) {
        const tx = Math.floor(b.x / TS);
        for (let ty = top; ty <= bot; ty++) if (this.solid(tx, ty)) { b.x = (tx + 1) * TS; b.vx = 0; b.hitWall = -1; break; }
      }
      const prevBottom = b.y + b.h;
      b.y += b.vy * dt;
      b.ground = false;
      const l = Math.floor(b.x / TS), r = Math.floor((b.x + b.w - 0.01) / TS);
      if (b.vy >= 0) {
        const ty = Math.floor((b.y + b.h) / TS);
        for (let tx = l; tx <= r; tx++) {
          const c = this.tile(tx, ty);
          const oneWay = c === "=" && prevBottom <= ty * TS + 1 && !opts.dropping;
          if (this.solid(tx, ty) || oneWay) {
            b.y = ty * TS - b.h; b.vy = 0; b.ground = true;
            if (c === "X") this._touchCrumble(tx, ty);
            break;
          }
        }
        if (!b.ground && opts.platforms) {
          for (const p of this.platforms) {
            if (b.x + b.w > p.x && b.x < p.x + p.w && prevBottom <= p.y + 2 + Math.max(0, p.dy) && b.y + b.h >= p.y) {
              b.y = p.y - b.h; b.vy = 0; b.ground = true; b.on = p; break;
            }
          }
        }
      } else {
        const ty = Math.floor(b.y / TS);
        for (let tx = l; tx <= r; tx++) if (this.solid(tx, ty)) {
          b.y = (ty + 1) * TS; b.vy = 0; b.hitCeil = true;
          if (opts.bump) opts.bump(tx, ty);
          break;
        }
      }
      if (!b.ground) b.on = null;
      b.landed = !wasGround && b.ground;
    }

    _touchCrumble(tx, ty) {
      const k = tx + "," + ty;
      if (!this.crumbles.has(k)) this.crumbles.set(k, { t: 0.5, gone: false, tx, ty });
    }

    bump(tx, ty) {
      const c = this.tile(tx, ty);
      const g = this.game;
      if (c === "?") {
        this.grid[ty][tx] = "U";
        this.coins++; g.stats.coins++;
        g.addScore(100, tx * TS + 8, ty * TS - 8);
        g.audio.play("coin");
        g.particles.burst(tx * TS + 8, ty * TS, 10, { colors: [g.theme.gold, "#fff"], speed: 90, life: 0.4, g: 300, angle: -Math.PI / 2, spread: 1.6 });
        this.popups = this.popups || [];
        this.popups.push({ x: tx * TS + 8, y: ty * TS - 4, t: 0 });
        this.bumped = { tx, ty, t: 0.15 };
      } else {
        g.audio.play("land", { vol: 0.5 });
        this.bumped = { tx, ty, t: 0.12 };
      }
      for (const e of this.enemies) if (!e.dead && Math.abs(e.x + e.w / 2 - (tx * TS + 8)) < 14 && Math.abs(e.y + e.h - ty * TS) < 4) this.killEnemy(e, 0);
    }

    // ---------- update ----------
    update(dt) {
      this.t += dt;
      const g = this.game;
      for (const p of this.platforms) {
        const ox = p.x, oy = p.y;
        p.t += dt * 1.2;
        if (p.axis === "x") p.x = p.ox + Math.sin(p.t) * p.range; else p.y = p.oy + Math.sin(p.t) * p.range;
        p.dx = p.x - ox; p.dy = p.y - oy;
      }
      for (const [k, cr] of this.crumbles) {
        cr.t -= dt;
        if (!cr.gone && cr.t <= 0) {
          cr.gone = true; cr.t = 3;
          g.particles.burst(cr.tx * TS + 8, cr.ty * TS + 8, 12, { colors: [g.theme.panelEdge, g.theme.panel], speed: 70, g: 400, life: 0.6, size: 3 });
          g.audio.play("hit", { vol: 0.4 });
        } else if (cr.gone && cr.t <= 0) {
          const p = this.player;
          if (!overlap(p, { x: cr.tx * TS, y: cr.ty * TS, w: TS, h: TS })) this.crumbles.delete(k);
        }
      }
      if (this.bumped) { this.bumped.t -= dt; if (this.bumped.t <= 0) this.bumped = null; }
      if (this.popups) { for (const p of this.popups) { p.t += dt; } this.popups = this.popups.filter((p) => p.t < 0.5); }
      for (const s of this.springs) s.squash = Math.max(0, s.squash - dt * 4);
      if (!this.done) this.updatePlayer(dt);
      for (const e of this.enemies) this.updateEnemy(e, dt);
      this.enemies = this.enemies.filter((e) => !e.gone);
      if (this.boss) this.updateBoss(dt);
      this.updateShots(dt);
      this.updateItems(dt);
      const p = this.player;
      const look = p.face * 28 + p.vx * 0.15;
      this.lookX = damp(this.lookX || 0, look, 3, dt);
      if (!p.dead) this.cam.follow(p.x + p.w / 2, p.y + p.h / 2 - 10, dt, 7, this.lookX, 0);
      if (this.boss && this.boss.active && this.arenaX != null) this.cam.x = Math.max(this.cam.x, Math.min(this.arenaX, this.pw - this.cam.w));
      this.cam.clamp();
      this.cam.update(dt);
    }

    celebrate(dt) {
      this.t += dt;
      this.player.t += dt;
      this.player.state = "idle";
      if (Math.random() < 0.3) {
        const g = this.game;
        g.particles.emit({ x: this.cam.x + Math.random() * g.W, y: this.cam.y - 4, vx: (Math.random() - 0.5) * 40, vy: 40 + Math.random() * 40, life: 2, size: 2, color: g.theme.fx[(Math.random() * 4) | 0], drag: 0.5, g: 30, vr: 6 });
      }
      this.cam.update(dt);
    }

    updatePlayer(dt) {
      const g = this.game, inp = g.input, p = this.player;
      p.t += dt;
      if (p.dead) {
        p.deadT += dt;
        p.vy += PHYS.gravity * 0.8 * dt; p.y += p.vy * dt;
        if (p.deadT > 1.3) {
          if (g.playerDied()) {
            g.carry.hp = 0;
            this._spawnPlayer();
            this.cam.snap(this.player.x, this.player.y);
            g.transition.in(0.35);
          }
        }
        return;
      }
      if (this.demo) return;
      p.inv = Math.max(0, p.inv - dt);
      p.shotCd = Math.max(0, p.shotCd - dt);
      p.wallLock = Math.max(0, p.wallLock - dt);
      const ax = inp.axis();
      const jumpPressed = inp.pressed("a") || inp.pressed("up");
      const jumpHeld = inp.down("a") || inp.down("up");
      if (jumpPressed) p.buffer = PHYS.buffer; else p.buffer = Math.max(0, p.buffer - dt);
      // dash
      if (this.abil.has("dash") && inp.pressed("c") && p.canDash && p.dashT <= 0) {
        let dx = ax.x, dy = ax.y;
        if (!dx && !dy) dx = p.face;
        const m = Math.hypot(dx, dy); dx /= m; dy /= m;
        p.dashT = 0.16; p.dashDir = { x: dx, y: dy }; p.canDash = false;
        g.audio.play("dash"); this.cam.shake(0.15); g.hitstop = 0.03;
        g.particles.burst(p.x + p.w / 2, p.y + p.h / 2, 10, { colors: [g.theme.accent, "#fff"], speed: 80, life: 0.3 });
      }
      if (p.dashT > 0) {
        p.dashT -= dt;
        p.vx = p.dashDir.x * 330; p.vy = p.dashDir.y * 330;
        p.trail.push({ x: p.x + p.w / 2, y: p.y + p.h, t: 0.25, flip: p.face < 0 });
        if (p.dashT <= 0) { p.vx *= 0.5; p.vy *= 0.4; }
      } else {
        const max = PHYS.maxRun * this.pmul.speed;
        const acc = p.ground ? PHYS.accel : PHYS.airAccel;
        if (p.wallLock <= 0) {
          if (ax.x) { p.vx = approach(p.vx, ax.x * max, acc * dt * (sign(ax.x) !== sign(p.vx) && p.vx ? 1.6 : 1)); p.face = sign(ax.x); }
          else p.vx = approach(p.vx, 0, (p.ground ? PHYS.friction : PHYS.airAccel * 0.6) * dt);
        }
        // wall slide
        p.wall = 0;
        if (this.abil.has("wall_jump") && !p.ground && p.vy > 0) {
          const left = this.solid(Math.floor((p.x - 1) / TS), Math.floor((p.y + p.h / 2) / TS));
          const right = this.solid(Math.floor((p.x + p.w + 1) / TS), Math.floor((p.y + p.h / 2) / TS));
          if (left && ax.x < 0) p.wall = -1; else if (right && ax.x > 0) p.wall = 1;
        }
        const apex = Math.abs(p.vy) < 60 && jumpHeld ? PHYS.apexG : 1;
        p.vy = Math.min(p.wall ? 70 : PHYS.maxFall, p.vy + PHYS.gravity * apex * dt);
        if (p.wall && Math.random() < 0.3) g.particles.emit({ x: p.wall > 0 ? p.x + p.w : p.x, y: p.y + p.h - 2, vx: -p.wall * 10, vy: -10, life: 0.3, size: 2, color: g.theme.textDim });
        // jumping
        if (p.ground) { p.coyote = PHYS.coyote; p.jumps = 0; p.canDash = true; } else p.coyote = Math.max(0, p.coyote - dt);
        if (p.buffer > 0) {
          if (p.coyote > 0) this._jump(PHYS.jump * this.pmul.jump, "jump");
          else if (p.wall) {
            p.vy = -PHYS.jump * 0.92 * this.pmul.jump; p.vx = -p.wall * 175; p.face = -p.wall; p.wallLock = 0.14; p.buffer = 0;
            g.audio.play("jump", { pitch: 1.15 }); p.sx = 0.7; p.sy = 1.3;
          } else if (this.abil.has("double_jump") && p.jumps < 1) {
            p.jumps++; this._jump(PHYS.double * this.pmul.jump, "jump", 1.25);
            g.particles.burst(p.x + p.w / 2, p.y + p.h, 8, { colors: ["#fff", g.theme.accent], speed: 60, life: 0.35, angle: Math.PI / 2, spread: 2 });
          }
        }
        if (!jumpHeld && p.vy < -120 && !p.springing) p.vy *= PHYS.cut;
        if (p.vy >= 0) p.springing = false;
      }
      // shooting
      if (this.abil.has("shoot") && (inp.pressed("b") || (inp.down("b") && p.shotCd <= 0)) && p.shotCd <= 0) {
        p.shotCd = 0.28;
        this.shots.push({ x: p.x + p.w / 2 + p.face * 6, y: p.y + 6, vx: p.face * 260, vy: 0, w: 6, h: 4, friendly: true, life: 0.8 });
        g.audio.play("shoot");
      }
      const dropping = inp.down("down") && jumpPressed && this.tile(Math.floor((p.x + p.w / 2) / TS), Math.floor((p.y + p.h + 1) / TS)) === "=";
      if (p.on && p.ground) { p.x += p.on.dx; p.y += p.on.dy; }
      this.moveBody(p, dt, { platforms: true, bump: (tx, ty) => this.bump(tx, ty), dropping });
      if (p.landed) {
        p.sx = 1.25; p.sy = 0.78;
        g.audio.play("land", { vol: 0.6 });
        g.particles.burst(p.x + p.w / 2, p.y + p.h, 6, { colors: [g.theme.textDim], speed: 40, life: 0.3, angle: -Math.PI / 2, spread: 2.6, g: -20 });
      }
      p.sx = damp(p.sx, 1, 12, dt); p.sy = damp(p.sy, 1, 12, dt);
      // footsteps dust
      if (p.ground && Math.abs(p.vx) > 60) {
        p.stepT -= dt;
        if (p.stepT <= 0) { p.stepT = 0.18; g.particles.emit({ x: p.x + p.w / 2 - p.face * 4, y: p.y + p.h, vx: -p.face * 15, vy: -12, life: 0.3, size: 2, endSize: 0, color: g.theme.textDim }); }
      }
      for (const tr of p.trail) tr.t -= dt;
      p.trail = p.trail.filter((tr) => tr.t > 0);
      // state for animation
      p.state = p.dashT > 0 ? "jump" : !p.ground ? (p.vy < 0 ? "jump" : "fall") : Math.abs(p.vx) > 20 ? "run" : "idle";
      // hazards
      const cx = Math.floor((p.x + p.w / 2) / TS), fy = Math.floor((p.y + p.h - 2) / TS);
      if (this.tile(cx, fy) === "^" || this.tile(Math.floor((p.x + 1) / TS), fy) === "^" && this.tile(Math.floor((p.x + p.w - 1) / TS), fy) === "^") this.hurtPlayer(1, true);
      if (this.tile(cx, Math.floor((p.y + p.h / 2) / TS)) === "L") this.killPlayer();
      if (p.y > this.ph + 24) this.killPlayer();
      // springs
      for (const s of this.springs) {
        if (p.vy > 0 && overlap(p, s) && p.y + p.h < s.y + 8) {
          p.vy = -PHYS.spring; p.springing = true; s.squash = 1; p.sy = 1.4; p.sx = 0.7; p.canDash = true; p.jumps = 0;
          g.audio.play("jump", { pitch: 1.5 });
          this.cam.shake(0.1);
        }
      }
      // checkpoints
      for (const c of this.checkpoints) {
        if (!c.on && Math.abs(p.x + p.w / 2 - (c.x + 8)) < 10 && Math.abs(p.y + p.h - (c.y + TS)) < 20) {
          for (const o of this.checkpoints) o.on = false;
          c.on = true;
          g.carry.checkpoint = { level: g.levelIndex, x: c.x + 8, y: c.y + TS };
          g.audio.play("powerup", { vol: 0.6 });
          g.floaters.add("CHECKPOINT", c.x + 8, c.y - 12, g.theme.good);
          g.particles.burst(c.x + 8, c.y, 18, { colors: [g.theme.good, "#fff"], speed: 90, life: 0.6, g: 120 });
        }
      }
      // goal
      if (this.goal && overlap(p, this.goal) && !this.done && (!this.boss || this.boss.dead)) this.win();
    }

    _jump(v, sfx, pitch = 1) {
      const p = this.player, g = this.game;
      p.vy = -v; p.coyote = 0; p.buffer = 0; p.ground = false;
      p.sx = 0.72; p.sy = 1.32;
      g.audio.play(sfx, { pitch });
      g.particles.burst(p.x + p.w / 2, p.y + p.h, 5, { colors: [g.theme.textDim], speed: 35, life: 0.25, angle: Math.PI / 2, spread: 2 });
    }

    win() {
      const g = this.game;
      this.done = true;
      g.carry.checkpoint = null;
      g.carry.hp = this.player.hp;
      g.particles.burst(this.goal.x + 8, this.goal.y + 8, 40, { colors: g.theme.fx, speed: 160, life: 1, g: 200, size: 2 });
      this.cam.shake(0.2);
      const par = this.L.par || Math.max(30, this.w * 0.45);
      g.levelComplete({ coins: this.coins, coinsTotal: this.coinsTotal, gems: this.gems, gemsTotal: this.L.gems || 3, timeBonus: Math.max(0, par - g.levelTime) * 20, kills: this.kills });
    }
    forceWin() { if (!this.done) { if (!this.goal) this.goal = { x: this.player.x, y: this.player.y, w: 10, h: 10 }; this.win(); } }

    hurtPlayer(n = 1, fromSpikes) {
      const p = this.player, g = this.game;
      if (p.inv > 0 || p.dead || this.done || p.dashT > 0 && !fromSpikes) return;
      p.hp -= n;
      g.emit("onPlayerHit", n, this);
      if (p.hp <= 0) return this.killPlayer();
      p.inv = 1.3;
      p.vy = -230; p.vx = -p.face * 140;
      g.audio.play("hurt");
      g.hitstop = 0.07;
      this.cam.shake(0.35);
      g.gfx.flash(g.theme.danger, 0.25);
      g.particles.burst(p.x + p.w / 2, p.y + p.h / 2, 12, { colors: [g.theme.danger, "#fff"], speed: 110, life: 0.4 });
    }

    killPlayer() {
      const p = this.player, g = this.game;
      if (p.dead || this.done) return;
      p.dead = true; p.deadT = 0; p.vy = -330; p.hp = 0;
      g.audio.play("die");
      this.cam.shake(0.5);
      g.hitstop = 0.12;
      g.particles.burst(p.x + p.w / 2, p.y + p.h / 2, 26, { colors: [g.theme.danger, g.theme.accent, "#fff"], speed: 160, life: 0.7, g: 200 });
    }

    // ---------- enemies ----------
    updateEnemy(e, dt) {
      const g = this.game, p = this.player;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      if (e.dead) {
        e.vy += PHYS.gravity * dt; e.y += e.vy * dt; e.x += e.vx * dt; e.rot = (e.rot || 0) + dt * 10;
        if (e.y > this.cam.y + this.cam.h + 40) e.gone = true;
        return;
      }
      if (e.hp <= 0) { this.killEnemy(e, 0); return; }
      if (!this.cam.visible(e.x, e.y, e.w, e.h, 140) && !this.demo) return;
      const dx = p.x + p.w / 2 - (e.x + e.w / 2), dy = p.y + p.h / 2 - (e.y + e.h / 2);
      const near = Math.abs(dx) < 170 && Math.abs(dy) < 90;
      switch (e.behavior) {
        case "hopper":
          e.timer -= dt;
          if (e.ground) { e.vx = approach(e.vx, 0, 600 * dt); if (e.timer <= 0) { e.timer = 1.1 + Math.random() * 0.6; e.face = near ? sign(dx) || e.face : -e.face; e.vy = -300; e.vx = e.face * e.speed * 1.6; e.sy = 1.3; } }
          break;
        case "flyer": {
          const tx = near ? p.x + p.w / 2 - e.w / 2 : e.ox + Math.sin(e.t * 0.8) * 40;
          const ty = near ? p.y - 10 : e.oy + Math.sin(e.t * 2.1) * 14;
          e.vx = damp(e.vx, clamp((tx - e.x) * 2, -e.speed * 1.4, e.speed * 1.4), 2.5, dt);
          e.vy = damp(e.vy, clamp((ty - e.y) * 2, -e.speed, e.speed), 2.5, dt) + Math.sin(e.t * 5) * 6;
          e.face = sign(e.vx) || e.face;
          break;
        }
        case "shooter":
          e.vx = 0; e.face = sign(dx) || e.face;
          e.timer -= dt;
          if (near && e.timer <= 0) {
            e.timer = 2.2 / (0.7 + this.diff * 0.3);
            const a = Math.atan2(dy, dx), sp = 120;
            this.shots.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 6, h: 6, life: 3 });
            e.sy = 0.8; e.sx = 1.2;
            g.audio.play("shoot", { vol: 0.5, pitch: 0.8 });
          }
          break;
        case "charger":
          if (e.state === "walk") {
            e.vx = e.face * e.speed * 0.7;
            if (near && Math.abs(dy) < 24 && sign(dx) === e.face) { e.state = "tell"; e.timer = 0.45; e.vx = 0; }
          } else if (e.state === "tell") {
            e.timer -= dt; e.vx = 0;
            if (e.timer <= 0) { e.state = "charge"; e.timer = 1.4; g.audio.play("dash", { vol: 0.5 }); }
          } else if (e.state === "charge") {
            e.vx = e.face * e.speed * 4.2; e.timer -= dt;
            if (Math.random() < 0.5) g.particles.emit({ x: e.x + e.w / 2, y: e.y + e.h, vx: -e.face * 20, vy: -10, life: 0.3, color: g.theme.textDim });
            if (e.timer <= 0 || e.hitWall) { e.state = "walk"; if (e.hitWall) { this.cam.shake(0.15); e.face = -e.face; } }
          }
          break;
        default: // walker / spiky
          e.vx = e.face * e.speed;
      }
      if (!e.fly) {
        e.vy = Math.min(PHYS.maxFall, e.vy + PHYS.gravity * dt);
        // turn at ledges for walkers
        if (e.ground && (e.behavior === "walker" || e.behavior === "spiky" || e.state === "walk")) {
          const ahead = Math.floor((e.face > 0 ? e.x + e.w + 2 : e.x - 2) / TS), below = Math.floor((e.y + e.h + 2) / TS);
          if (!this.solid(ahead, below) && this.tile(ahead, below) !== "=") e.face = -e.face, e.vx = e.face * Math.abs(e.vx);
        }
        this.moveBody(e, dt, {});
        if (e.hitWall && e.state !== "charge") e.face = -e.face;
      } else {
        e.x += e.vx * dt; e.y += e.vy * dt;
      }
      e.sx = damp(e.sx || 1, 1, 10, dt); e.sy = damp(e.sy || 1, 1, 10, dt);
      if (e.y > this.ph + 40) { e.gone = true; return; }
      // player contact
      if (p.dead || this.done) return;
      if (overlap(p, e)) {
        const stomp = p.vy > 40 && p.y + p.h - e.y < Math.max(8, p.vy * dt * 2 + 6) && e.behavior !== "spiky";
        if (p.dashT > 0 && e.behavior !== "spiky") { this.killEnemy(e, p.face); p.canDash = true; }
        else if (stomp) {
          this.damageEnemy(e, 1, 0);
          p.vy = -(g.input.down("a") ? PHYS.stomp * 1.35 : PHYS.stomp); p.jumps = 0; p.canDash = true;
          p.sx = 0.75; p.sy = 1.3;
        } else this.hurtPlayer(e.def.damage || 1);
      }
    }

    damageEnemy(e, n, dir) {
      const g = this.game;
      e.hp -= n; e.flash = 0.12;
      if (e.hp <= 0) return this.killEnemy(e, dir);
      g.audio.play("hit");
      e.sy = 0.6; e.sx = 1.4;
      g.hitstop = 0.03;
    }

    killEnemy(e, dir) {
      const g = this.game;
      if (e.dead) return;
      e.dead = true; e.vy = -220; e.vx = (dir || (Math.random() - 0.5)) * 80;
      this.kills++; g.stats.kills++;
      g.addScore(e.def.score || 100, e.x + e.w / 2, e.y - 4);
      g.audio.play("hit", { pitch: 1.2 });
      g.hitstop = 0.05;
      this.cam.shake(0.12);
      g.particles.burst(e.x + e.w / 2, e.y + e.h / 2, 14, { colors: [g.theme.accent2, "#fff", g.theme.accent], speed: 120, life: 0.45, g: 150 });
      g.emit("onEnemyKilled", e, this);
    }

    // ---------- boss ----------
    updateBoss(dt) {
      const b = this.boss, g = this.game, p = this.player;
      b.t += dt; b.flash = Math.max(0, b.flash - dt); b.inv = Math.max(0, b.inv - dt);
      if (b.dead) {
        b.deadT += dt;
        if (Math.random() < 0.4) g.particles.burst(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 6, { colors: g.theme.fx, speed: 120, life: 0.6, glow: true });
        if (b.deadT > 1.6 && !b.exploded) {
          b.exploded = true;
          this.cam.shake(0.8); g.gfx.flash("#fff", 0.8); g.audio.play("explode");
          g.particles.burst(b.x + b.w / 2, b.y + b.h / 2, 60, { colors: g.theme.fx, speed: 220, life: 1.2, g: 100, size: 3 });
          g.addScore(5000, b.x + b.w / 2, b.y);
          this.goal = { x: b.x + b.w / 2 - 8, y: this.ph - TS * 8, w: TS, h: TS * 8 };
          this.goalAppear = 0;
        }
        return;
      }
      const dx = p.x + p.w / 2 - (b.x + b.w / 2);
      if (!b.active) {
        if (Math.abs(dx) < g.W * 0.55) { b.active = true; g.audio.playMusic(g.spec.audio.music.boss ? "boss" : "main", 0.5); this.bossBanner = 2.5; }
        else return;
      }
      if (this.bossBanner) this.bossBanner = Math.max(0, this.bossBanner - dt);
      if (b.hp < b.maxHp * 0.5 && b.phase === 1) { b.phase = 2; g.floaters.add("ENRAGED!", b.x + b.w / 2, b.y - 10, g.theme.danger, { scale: 2 }); this.cam.shake(0.4); }
      const speedK = b.phase === 2 ? 1.35 : 1;
      b.timer -= dt * speedK;
      switch (b.state) {
        case "intro": b.vx = 0; if (b.timer <= 0) { b.state = "idle"; b.timer = 0.8; } break;
        case "idle":
          b.vx = approach(b.vx, 0, 500 * dt); b.face = sign(dx) || b.face;
          if (b.timer <= 0 && b.ground) {
            const r = Math.random();
            if (r < 0.4) { b.state = "leap"; b.vy = -480; b.vx = clamp(dx * 1.2, -200, 200); b.ground = false; g.audio.play("jump", { pitch: 0.6 }); }
            else if (r < 0.75) { b.state = "shoot"; b.timer = 0.5; b.shots = b.phase === 2 ? 3 : 2; }
            else { b.state = "tell"; b.timer = 0.6; }
          }
          break;
        case "leap":
          if (b.ground) {
            b.state = "idle"; b.timer = 1.0;
            this.cam.shake(0.45); g.audio.play("explode", { vol: 0.6 });
            for (const s of [-1, 1]) this.shots.push({ x: b.x + b.w / 2, y: b.y + b.h - 6, vx: s * 140, vy: 0, w: 10, h: 8, life: 2.5, wave: true });
            g.particles.burst(b.x + b.w / 2, b.y + b.h, 24, { colors: [g.theme.textDim, g.theme.panelEdge], speed: 120, life: 0.5, angle: -Math.PI / 2, spread: 3 });
          }
          break;
        case "shoot":
          b.vx = 0;
          if (b.timer <= 0) {
            const n = b.phase === 2 ? 7 : 5;
            for (let i = 0; i < n; i++) {
              const a = Math.atan2(p.y - b.y, dx) + (i - (n - 1) / 2) * 0.22;
              this.shots.push({ x: b.x + b.w / 2, y: b.y + b.h * 0.35, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, w: 6, h: 6, life: 3 });
            }
            g.audio.play("shoot", { pitch: 0.7 });
            b.sx = 1.2; b.sy = 0.85;
            b.shots--; b.timer = 0.55;
            if (b.shots <= 0) { b.state = "idle"; b.timer = 1.1; }
          }
          break;
        case "tell":
          b.vx = 0; b.face = sign(dx) || b.face;
          if (b.timer <= 0) { b.state = "charge"; b.timer = 1.2; g.audio.play("dash"); }
          break;
        case "charge":
          b.vx = b.face * 240;
          if (b.hitWall || b.timer <= 0) { b.state = "idle"; b.timer = 1; if (b.hitWall) { this.cam.shake(0.5); b.vx = -b.face * 60; } }
          break;
      }
      b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);
      this.moveBody(b, dt, {});
      b.sx = damp(b.sx || 1, 1, 8, dt); b.sy = damp(b.sy || 1, 1, 8, dt);
      if (!p.dead && overlap(p, b)) {
        if (p.vy > 40 && p.y + p.h - b.y < 14 && b.inv <= 0) {
          this.damageBoss(2);
          p.vy = -PHYS.stomp * 1.4; p.canDash = true; p.jumps = 0;
        } else if (p.dashT > 0 && b.inv <= 0) { this.damageBoss(2); p.vx = -p.face * 200; p.dashT = 0; }
        else this.hurtPlayer(1);
      }
    }

    damageBoss(n) {
      const b = this.boss, g = this.game;
      if (b.inv > 0 || b.dead) return;
      b.hp -= n; b.flash = 0.15; b.inv = 0.45; b.sy = 0.75; b.sx = 1.25;
      g.audio.play("hit", { pitch: 0.7 });
      g.hitstop = 0.08; this.cam.shake(0.3);
      g.particles.burst(b.x + b.w / 2, b.y + b.h / 3, 16, { colors: [g.theme.accent2, "#fff"], speed: 130, life: 0.5 });
      if (b.hp <= 0) { b.dead = true; b.deadT = 0; b.vx = 0; this.shots = this.shots.filter((s) => s.friendly); g.audio.stopMusic(1); g.stats.kills++; }
    }

    // ---------- shots & items ----------
    updateShots(dt) {
      const p = this.player, g = this.game;
      for (const s of this.shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.wave) s.y += Math.sin(s.life * 30) * 0.5;
        const tx = Math.floor(s.x / TS), ty = Math.floor(s.y / TS);
        if (this.solid(tx, ty) && !s.wave) { s.life = 0; g.particles.burst(s.x, s.y, 4, { color: "#fff", speed: 50, life: 0.2 }); }
        if (s.friendly) {
          for (const e of this.enemies) if (!e.dead && overlap({ x: s.x - 3, y: s.y - 2, w: 6, h: 4 }, e)) { this.damageEnemy(e, 1, sign(s.vx)); s.life = 0; break; }
          if (this.boss && !this.boss.dead && overlap({ x: s.x - 3, y: s.y - 2, w: 6, h: 4 }, this.boss)) { this.damageBoss(1); s.life = 0; }
        } else if (!p.dead && overlap({ x: s.x - s.w / 2, y: s.y - s.h / 2, w: s.w, h: s.h }, p)) { this.hurtPlayer(1); s.life = 0; }
      }
      this.shots = this.shots.filter((s) => s.life > 0);
    }

    updateItems(dt) {
      const p = this.player, g = this.game;
      if (this.goalAppear != null) this.goalAppear = Math.min(1, this.goalAppear + dt);
      for (const it of this.items) {
        if (it.taken) { it.t = (it.t || 0) + dt; continue; }
        it.y = it.by + Math.sin(this.t * 3 + it.x * 0.1) * 2;
        if (p.dead || this.done) continue;
        const magnet = it.kind === "coin" && Math.abs(p.x - it.x) < 18 && Math.abs(p.y - it.y) < 18;
        if (magnet || overlap(p, it)) {
          it.taken = true;
          const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          if (it.kind === "coin") {
            this.coins++; g.stats.coins++; g.addScore(10);
            g.audio.play("coin");
            g.particles.burst(cx, cy, 6, { colors: [g.theme.gold, "#fff"], speed: 50, life: 0.3 });
            if (g.stats.coins % 100 === 0) { g.lives++; g.floaters.add("1UP!", cx, cy - 8, g.theme.good, { scale: 2 }); g.audio.play("powerup"); }
          } else if (it.kind === "gem") {
            this.gems++; g.stats.gems++; g.addScore(1000, cx, cy - 6);
            g.audio.play("powerup"); this.cam.shake(0.1);
            g.particles.burst(cx, cy, 20, { colors: [g.theme.accent, "#fff", g.theme.accent2], speed: 100, life: 0.6, glow: true });
          } else if (it.kind === "heart") {
            p.hp = Math.min(p.maxHp, p.hp + 1);
            g.audio.play("powerup", { pitch: 1.3 });
            g.floaters.add("+1 HP", cx, cy - 6, g.theme.danger);
          }
        }
      }
      this.items = this.items.filter((it) => !it.taken || it.t < 0.01);
    }

    // ---------- drawing ----------
    draw(gfx) {
      const g = this.game, ctx = gfx.ctx, cam = this.cam, T = g.theme;
      const vx = cam.vx, vy = cam.vy;
      g.drawParallax(this.L.bg || "main", vx, vy, this.ph);
      // lava/water glow rows
      // static tiles
      ctx.drawImage(this.staticLayer, vx, vy, gfx.W, gfx.H, 0, 0, gfx.W, gfx.H);
      this.drawDynamicTiles(gfx, vx, vy);
      // checkpoints
      for (const c of this.checkpoints) this.drawFlag(gfx, c.x + 8 - vx, c.y + TS - vy, c.on ? T.good : T.textDim, 18, c.on);
      if (this.goal && (!this.boss || this.boss.exploded)) {
        const k = this.goalAppear != null ? CG.ease.outBack(this.goalAppear) : 1;
        this.drawGoal(gfx, this.goal.x + 8 - vx, this.goal.y + this.goal.h - vy, k);
      }
      for (const s of this.springs) {
        const sy = s.y - vy, sx = s.x - vx;
        if (g.tiles) this._tile(ctx, g.tiles, s.squash > 0.3 ? 24 : 23, sx, s.y - 6 - vy);
        else { gfx.rect(sx + 2, sy + 4 + s.squash * 4, 12, 4, T.accent); gfx.rect(sx + 5, sy + 8, 6, 2, T.textDim); }
      }
      for (const pl of this.platforms) {
        const px = Math.round(pl.x - vx), py = Math.round(pl.y - vy);
        if (g.tiles) { this._tile(ctx, g.tiles, 16, px, py); this._tile(ctx, g.tiles, 17, px + TS, py); this._tile(ctx, g.tiles, 18, px + TS * 2, py); }
        else gfx.rect(px, py, pl.w, 6, T.accent2);
      }
      this.drawItems(gfx, vx, vy);
      for (const e of this.enemies) this.drawEnemy(gfx, e, vx, vy);
      if (this.boss) this.drawBoss(gfx, vx, vy);
      g.particles.draw(ctx, vx, vy, 0);
      this.drawPlayer(gfx, vx, vy);
      for (const s of this.shots) {
        const sx = s.x - vx, sy = s.y - vy;
        if (s.friendly) { gfx.rect(sx - 3, sy - 2, 6, 4, T.gold); gfx.rect(sx - 2, sy - 1, 4, 2, "#fff"); }
        else if (s.wave) { gfx.circle(sx, sy, 5, T.accent2); gfx.circle(sx, sy, 3, "#fff"); }
        else { gfx.circle(sx, sy, 3.5, T.danger); gfx.circle(sx - 1, sy - 1, 1.5, "#fff"); }
      }
      g.particles.draw(ctx, vx, vy, 1);
      g.floaters.draw(gfx, vx, vy);
      if (this.L.dark) this.drawDarkness(gfx, vx, vy);
    }

    drawDynamicTiles(gfx, vx, vy) {
      const g = this.game, ctx = gfx.ctx, T = g.theme;
      const x0 = Math.max(0, Math.floor(vx / TS)), x1 = Math.min(this.w - 1, Math.floor((vx + gfx.W) / TS));
      const y0 = Math.max(0, Math.floor(vy / TS)), y1 = Math.min(this.h - 1, Math.floor((vy + gfx.H) / TS));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = this.grid[y][x];
        if (c !== "?" && c !== "U" && c !== "X" && c !== "L") continue;
        let px = x * TS - vx, py = y * TS - vy;
        if (this.bumped && this.bumped.tx === x && this.bumped.ty === y) py -= Math.sin((this.bumped.t / 0.15) * Math.PI) * 4;
        if (c === "X") {
          const cr = this.crumbles.get(x + "," + y);
          if (cr && cr.gone) continue;
          if (cr) px += Math.round(Math.sin(this.t * 60) * 1);
        }
        if (c === "L") {
          const surface = this.tile(x, y - 1) !== "L";
          if (g.tiles) this._tile(ctx, g.tiles, surface ? 28 : 29, px, py + (surface ? Math.round(Math.sin(this.t * 3 + x) * 1) : 0));
          else gfx.rect(px, py, TS, TS, T.danger);
          continue;
        }
        const idx = c === "?" ? 20 : c === "U" ? 21 : 22;
        if (g.tiles) this._tile(ctx, g.tiles, idx, px, py);
        else { gfx.rect(px, py, TS, TS, c === "?" ? T.gold : T.panelEdge); if (c === "?") gfx.text("?", px + 5, py + 4, { color: T.shadow }); }
      }
      if (this.popups) for (const p of this.popups) {
        const k = p.t / 0.5;
        this.drawCoin(gfx, p.x - vx, p.y - vy - CG.ease.outQuad(k) * 26, this.t * 3, 1 - k);
      }
    }

    drawCoin(gfx, x, y, t, alpha = 1) {
      const g = this.game, spr = g.sprites.coin;
      if (spr) { g.gfx.sprite(spr, g.anim(spr, "spin", t), x, y + spr.fh / 2, { alpha }); return; }
      const w = Math.max(1, Math.round(Math.abs(Math.cos(t * 4)) * 7));
      gfx.ctx.globalAlpha = alpha;
      gfx.rect(x - w / 2, y - 4, w, 8, g.theme.gold);
      gfx.rect(x - w / 2 + (w > 3 ? 1 : 0), y - 3, Math.max(1, w - 2), 1, "#fff");
      gfx.ctx.globalAlpha = 1;
    }

    drawItems(gfx, vx, vy) {
      const g = this.game, T = g.theme;
      for (const it of this.items) {
        const x = it.x + it.w / 2 - vx, y = it.y + it.h / 2 - vy;
        if (x < -16 || x > gfx.W + 16 || y < -16 || y > gfx.H + 16) continue;
        if (it.kind === "coin") this.drawCoin(gfx, x, y, this.t + it.x * 0.01);
        else if (it.kind === "gem") {
          const spr = g.sprites.gem;
          gfx.ctx.globalAlpha = 0.35; gfx.circle(x, y, 8 + Math.sin(this.t * 4) * 1.5, T.accent); gfx.ctx.globalAlpha = 1;
          if (spr) gfx.sprite(spr, g.anim(spr, "idle", this.t), x, y + spr.fh / 2);
          else { gfx.ctx.fillStyle = T.accent; gfx.ctx.beginPath(); gfx.ctx.moveTo(x, y - 6); gfx.ctx.lineTo(x + 5, y); gfx.ctx.lineTo(x, y + 6); gfx.ctx.lineTo(x - 5, y); gfx.ctx.fill(); }
        } else if (it.kind === "heart") {
          const spr = g.sprites.heart;
          if (spr) gfx.sprite(spr, 0, x, y + spr.fh / 2); else g.drawHearts(x - 3, y - 3, 1, 1);
        }
      }
    }

    drawFlag(gfx, x, y, color, h, waving) {
      const g = this.game;
      gfx.rect(x - 1, y - h, 2, h, g.theme.panelEdge);
      const wave = waving ? Math.sin(this.t * 8) * 1.5 : 0;
      gfx.ctx.fillStyle = color;
      gfx.ctx.beginPath(); gfx.ctx.moveTo(x + 1, y - h); gfx.ctx.lineTo(x + 10, y - h + 3 + wave); gfx.ctx.lineTo(x + 1, y - h + 7); gfx.ctx.fill();
    }

    drawGoal(gfx, x, y, k = 1) {
      const g = this.game, T = g.theme, spr = g.sprites.flag;
      if (spr) { gfx.sprite(spr, g.anim(spr, "idle", this.t), x, y, { scale: k }); return; }
      const h = 46 * k;
      gfx.rect(x - 1, y - h, 3, h, "#e8e8e8");
      gfx.circle(x + 0.5, y - h, 2.5, T.gold);
      const wave = Math.sin(this.t * 6);
      gfx.ctx.fillStyle = T.accent;
      gfx.ctx.beginPath(); gfx.ctx.moveTo(x + 2, y - h + 3); gfx.ctx.lineTo(x + 20, y - h + 9 + wave * 2); gfx.ctx.lineTo(x + 2, y - h + 16); gfx.ctx.fill();
      gfx.ctx.globalAlpha = 0.25 + Math.sin(this.t * 4) * 0.1; gfx.circle(x, y - h / 2, 14, T.accent); gfx.ctx.globalAlpha = 1;
    }

    drawPlayer(gfx, vx, vy) {
      const g = this.game, p = this.player;
      const spr = g.sprites[g.spec.player.sprite || "player"];
      for (const tr of p.trail) g.drawActor(spr, tr.x - vx, tr.y - vy, { flip: tr.flip, alpha: tr.t * 2, flash: true, flashColor: g.theme.accent });
      if (p.inv > 0 && Math.floor(p.inv * 20) % 2 === 0 && !p.dead) return;
      const rot = p.dead ? p.deadT * 8 : p.wall ? 0 : 0;
      g.drawActor(spr, p.x + p.w / 2 - vx, p.y + p.h - vy + 1, { state: p.dead ? "hurt" : p.state, t: p.t, flip: p.face < 0, sx: p.sx, sy: p.sy, rot });
    }

    drawEnemy(gfx, e, vx, vy) {
      const g = this.game;
      const x = e.x + e.w / 2 - vx, y = e.y + e.h - vy + 1;
      if (x < -40 || x > gfx.W + 40) return;
      const state = e.fly ? "fly" : e.state === "tell" ? "attack" : "walk";
      if (e.state === "tell") g.gfx.text("!", x, e.y - vy - 12 + Math.sin(this.t * 30), { color: g.theme.danger, outline: "#000", align: "center" });
      g.drawActor(e.spr, x + (e.state === "tell" ? Math.sin(this.t * 50) : 0), y, { state, t: e.t, flip: e.face > 0, sx: e.sx, sy: e.sy, rot: e.dead ? e.rot : 0, flash: e.flash > 0, color: g.theme.accent2 });
    }

    drawBoss(gfx, vx, vy) {
      const g = this.game, b = this.boss, T = g.theme;
      if (b.exploded) return;
      const shake = b.dead ? (Math.random() - 0.5) * 4 : 0;
      g.drawActor(b.spr, b.x + b.w / 2 - vx + shake, b.y + b.h - vy + 1, { state: b.state === "leap" ? "jump" : "walk", t: b.t, flip: b.face > 0, sx: b.sx, sy: b.sy, flash: b.flash > 0 || (b.dead && Math.random() < 0.5), color: T.danger });
      if (b.active && !b.dead) {
        const w = 180;
        gfx.text((b.def.name || "BOSS").toUpperCase(), gfx.W / 2, gfx.H - 26, { align: "center", color: T.text, outline: T.shadow });
        gfx.bar(gfx.W / 2 - w / 2, gfx.H - 15, w, 6, b.hp / b.maxHp, T.danger);
      }
      if (this.bossBanner) {
        const a = Math.min(1, this.bossBanner);
        gfx.ctx.globalAlpha = a;
        gfx.text("WARNING", gfx.W / 2, gfx.H * 0.25, { align: "center", scale: 3, color: T.danger, outline: T.shadow });
        gfx.ctx.globalAlpha = 1;
      }
    }

    drawDarkness(gfx, vx, vy) {
      const g = this.game, p = this.player;
      this.dark = this.dark || gfx.makeCanvas(gfx.W, gfx.H);
      const d = this.dark.getContext("2d");
      d.globalCompositeOperation = "source-over";
      d.fillStyle = "rgba(4,4,12,0.86)"; d.fillRect(0, 0, gfx.W, gfx.H);
      d.globalCompositeOperation = "destination-out";
      const light = (x, y, r) => {
        const gr = d.createRadialGradient(x, y, r * 0.2, x, y, r);
        gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        d.fillStyle = gr; d.beginPath(); d.arc(x, y, r, 0, TAU); d.fill();
      };
      light(p.x + p.w / 2 - vx, p.y + p.h / 2 - vy, 90 + Math.sin(this.t * 3) * 3);
      for (const it of this.items) if (it.kind === "gem") light(it.x - vx + 6, it.y - vy + 6, 30);
      for (const c of this.checkpoints) light(c.x + 8 - vx, c.y - vy, 40);
      gfx.ctx.drawImage(this.dark, 0, 0);
    }

    hud(gfx) {
      const g = this.game, T = g.theme;
      g.drawHud({ hp: this.player.hp, maxHp: this.player.maxHp, lives: g.lives, counters: [{ icon: "coin", value: g.stats.coins, color: T.gold }] });
      for (let i = 0; i < (this.L.gems || 3); i++) {
        const x = gfx.W / 2 - 18 + i * 12, y = 7;
        gfx.ctx.fillStyle = i < this.gems ? T.accent : CG.rgba(T.shadow, 0.7);
        gfx.ctx.beginPath(); gfx.ctx.moveTo(x, y - 4); gfx.ctx.lineTo(x + 4, y); gfx.ctx.lineTo(x, y + 4); gfx.ctx.lineTo(x - 4, y); gfx.ctx.fill();
      }
      gfx.text(CG.formatTime(g.levelTime).slice(0, -3), gfx.W - 60, 4, { color: T.textDim, align: "right" });
    }

    // ---------- title screen demo ----------
    demoUpdate(dt) {
      this.t += dt;
      this.demoX = (this.demoX || 0) + dt * 40;
      for (const e of this.enemies) e.t += dt;
      this.player.t += dt;
    }

    drawDemo(gfx, time) {
      const g = this.game, T = g.theme;
      const camX = this.demoX || 0;
      g.drawParallax(this.L.bg || "main", camX, 0, gfx.H);
      const groundY = gfx.H - 32;
      const tiles = g.tiles;
      for (let x = -((camX) % TS) - TS; x < gfx.W + TS; x += TS) {
        for (let r = 0; r < 2; r++) {
          if (tiles) this._tile(gfx.ctx, tiles, r === 0 ? 1 | 0 : 0, x, groundY + r * TS);
          else gfx.rect(x, groundY + r * TS, TS, TS, r === 0 ? T.accent : T.panel);
        }
      }
      const spr = g.sprites[g.spec.player.sprite || "player"];
      g.drawActor(spr, gfx.W * 0.3, groundY + 1, { state: "run", t: this.t, flip: false });
      const espr = g.sprites[g.spec.enemies[0].sprite || g.spec.enemies[0].id];
      g.drawActor(espr, gfx.W * 0.72 + Math.sin(this.t * 0.7) * 20, groundY + 1, { state: "walk", t: this.t, flip: false });
      if (g.spec.enemies[1]) {
        const s2 = g.sprites[g.spec.enemies[1].sprite || g.spec.enemies[1].id];
        g.drawActor(s2, gfx.W * 0.55, groundY - 40 + Math.sin(this.t * 2) * 6, { state: "fly", t: this.t, flip: true });
      }
    }
  }

  const DEFAULT_LEVEL = [
    "..............................................",
    "..............................................",
    "..............................................",
    "..............................................",
    "..............................................",
    "..............................................",
    "..................o.o.o.......................",
    ".................=====.........*..............",
    "..........................=====...............",
    "..........?.?.........................o.o.....",
    "......................................=====..G.",
    "..P.................a.......b..............####",
    "################..##########..#####^^##########",
    "################..##########..#################",
  ];

  CG.defineGenre("platformer", {
    create: (game, i, opts) => new World(game, i, opts),
    controls: [["Move", "Arrows / A D"], ["Jump", "Space / Z / Up"], ["Attack (if unlocked)", "X / J"], ["Dash (if unlocked)", "Shift / C"], ["Drop through", "Down + Jump"]],
  });
})();
