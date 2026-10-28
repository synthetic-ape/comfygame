// Deterministic gameplay recorder: freezes the game clock, steps it frame by frame and saves every frame as PNG,
// while a genre-specific autopilot plays. Footage is perfectly smooth regardless of capture speed.
//   node tools/record_gameplay.mjs <game-url> <out-dir> [--seconds 12] [--fps 30] [--start title|play|boss] [--level N]
import fs from "node:fs";
import path from "node:path";
import { launch } from "./playtest.mjs";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : d; };
const seconds = Number(opt("--seconds", 12));
const fps = Number(opt("--fps", 30));
const start = opt("--start", "play");
const level = opt("--level", null);
const [url, out] = args;
fs.mkdirSync(out, { recursive: true });

// Virtual clock: requestAnimationFrame / performance.now only advance when we step.
const CLOCK = `(() => {
  let now = 0; const rafs = [];
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
  window.__step = (n) => { for (let i = 0; i < n; i++) { now += 1000 / 60; const cbs = rafs.splice(0); for (const cb of cbs) cb(now); } };
})();`;

// Autopilots drive the real input system (keys held + latched presses), so the game plays exactly as with a person.
const PILOT = `(() => {
  const g = CG.game, inp = g.input, TS = 16;
  const hold = (...codes) => { for (const c of codes) inp.keys[c] = true; };
  const tap = (a) => { inp.latch[a] = true; };
  let t = 0, chooseT = 0;
  const pilots = {
    platformer(w) {
      const p = w.player; if (!p || p.dead || w.done) return;
      const cx = p.x + p.w / 2, foot = p.y + p.h, ty = Math.floor((foot + 1) / TS);
      let target = null;
      if (w.boss && w.boss.active && !w.boss.dead) target = w.boss.x + w.boss.w / 2;
      const dir = target != null ? Math.sign(target - cx) || 1 : 1;
      if (target == null || Math.abs(target - cx) > 26) hold(dir > 0 ? "ArrowRight" : "ArrowLeft");
      let danger = false;
      for (let d = 1; d <= 3; d++) {
        const ax = Math.floor((cx + dir * (d * 11 + Math.abs(p.vx) * 0.12)) / TS);
        if (!(w.solid(ax, ty) || w.tile(ax, ty) === "=" )) danger = true;
        if (w.solid(ax, ty - 1) || w.solid(ax, ty - 2) || w.tile(ax, ty - 1) === "^") danger = true;
      }
      for (const e of w.enemies) if (!e.dead && (e.x - cx) * dir > -4 && (e.x - cx) * dir < 46 && Math.abs(e.y + e.h - foot) < 26) danger = true;
      if (w.boss && w.boss.active && !w.boss.dead && Math.abs(target - cx) < 70) danger = true;
      const standable = (x, y) => (w.solid(x, y) || w.tile(x, y) === "=" || w.platforms.some((pl) => x * TS >= pl.x - 8 && x * TS <= pl.x + pl.w && Math.abs(y * TS - pl.y) < 10)) && !w.solid(x, y - 1) && w.tile(x, y - 1) !== "^";
      const S = (w.__pilot = w.__pilot || { target: null });
      const tileX = Math.floor(cx / TS), footT = Math.floor((foot - 1) / TS) + 1;
      if (p.ground) {
        S.target = null;
        if (danger) {
          // commit to a landing spot ahead before taking off
          let best = null;
          for (let dxT = 1; dxT <= 8; dxT++) for (let dyT = -4; dyT <= 6; dyT++) {
            const bx = tileX + dir * dxT, by = footT + dyT;
            if (!standable(bx, by)) continue;
            if (w.tile(bx, by - 1) === "^") continue;
            const enemyThere = w.enemies.some((e) => !e.dead && Math.abs(e.x + e.w / 2 - (bx * TS + 8)) < 14 && Math.abs(e.y + e.h - by * TS) < 12);
            const score = dxT * 1.0 + Math.max(0, -dyT) * 0.6 + Math.max(0, dyT) * 0.25 + (enemyThere ? 3 : 0) + (dxT < 2 ? 2 : 0);
            if (!best || score < best.s) best = { x: bx * TS + 8, y: by * TS, s: score };
          }
          S.target = best;
          tap("a"); hold("Space");
        }
      } else if (S.target) {
        const tg = S.target;
        inp.keys.ArrowLeft = inp.keys.ArrowRight = false;
        if (tg.x - cx > 4) hold("ArrowRight"); else if (tg.x - cx < -4) hold("ArrowLeft");
        if (p.vy < 60 && (tg.y < foot + 8 || Math.abs(tg.x - cx) > 40)) hold("Space");
        const short = p.vy > 0 && foot > tg.y - 4 && Math.abs(tg.x - cx) > 10;
        if (short && p.jumps < 1 && w.abil.has("double_jump")) { tap("a"); hold("Space"); }
        else if (short && p.canDash && w.abil.has("dash") && Math.abs(tg.x - cx) > 30) tap("c");
      } else {
        hold(dir > 0 ? "ArrowRight" : "ArrowLeft");
        if (p.vy < 40) hold("Space");
      }
    },
    arena(w) {
      const p = w.player; if (!p || p.dead) return;
      if (w.choice) { chooseT += 1 / 60; if (chooseT > 0.7) { tap("a"); chooseT = 0; } return; }
      let fx = 0, fy = 0;
      for (const e of w.enemies) { const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1; if (d < 110) { fx += dx / d * (110 - d); fy += dy / d * (110 - d); } }
      if (w.boss && !w.boss.dead) { const dx = p.x - w.boss.x, dy = p.y - w.boss.y, d = Math.hypot(dx, dy) || 1; if (d < 140) { fx += dx / d * 260; fy += dy / d * 260; } }
      const cx = w.pw / 2 - p.x, cy = w.ph / 2 - p.y; fx += cx * 0.25; fy += cy * 0.25;
      fx += Math.cos(t * 0.6) * 40; fy += Math.sin(t * 0.6) * 40;
      for (const it of w.pickups) { const dx = it.x - p.x, dy = it.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < 90) { fx += dx / d * 30; fy += dy / d * 30; } }
      if (fx > 18) hold("ArrowRight"); if (fx < -18) hold("ArrowLeft"); if (fy > 18) hold("ArrowDown"); if (fy < -18) hold("ArrowUp");
      if (Math.hypot(fx, fy) > 160 && p.rollCd <= 0) tap("a");
    },
    dungeon(w) {
      const p = w.player; if (!p || p.dead || w.done) return;
      const ptx = Math.floor((p.x + p.w / 2) / TS), pty = Math.floor((p.y + p.h / 2) / TS);
      const live = w.enemies.filter((e) => !e.dead && !e.asleep);
      let goal = null;
      const nearE = live.concat(w.boss && w.boss.active && !w.boss.dead ? [w.boss] : []).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (nearE && Math.hypot(nearE.x - p.x, nearE.y - p.y) < 150) {
        goal = [Math.floor((nearE.x + nearE.w / 2) / TS), Math.floor((nearE.y + nearE.h / 2) / TS)];
        if (Math.hypot(nearE.x + nearE.w / 2 - p.x - p.w / 2, nearE.y + nearE.h / 2 - p.y - p.h / 2) < 30) inp.keys.KeyX = (Math.floor(t * 8) % 2) === 0;
      }
      if (!goal) {
        const chest = w.chests.filter((c) => !c.open).sort((a, b) => (b.key - a.key) || (Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)))[0];
        if (chest) goal = [chest.x / TS, chest.y / TS];
        else if (w.stairs) goal = [w.stairs.x / TS, w.stairs.y / TS];
        const sleeper = w.enemies.filter((e) => !e.dead).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (sleeper && Math.hypot(sleeper.x - p.x, sleeper.y - p.y) < 200) goal = [Math.floor(sleeper.x / TS), Math.floor(sleeper.y / TS)];
      }
      if (!goal) return;
      // BFS one step toward the goal
      const key = (x, y) => y * w.w + x, prev = new Map([[key(ptx, pty), -1]]), q = [[ptx, pty]];
      let found = null;
      while (q.length && !found) {
        const [x, y] = q.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = key(nx, ny);
          if (prev.has(k) || w.solidFn(nx, ny)) continue;
          prev.set(k, key(x, y)); q.push([nx, ny]);
          if (nx === Math.round(goal[0]) && ny === Math.round(goal[1])) { found = k; break; }
        }
      }
      let step = found;
      while (step != null && prev.get(step) !== key(ptx, pty) && prev.get(step) !== -1) step = prev.get(step);
      const sx = step != null ? (step % w.w) * TS + 8 : goal[0] * TS + 8, sy = step != null ? Math.floor(step / w.w) * TS + 8 : goal[1] * TS + 8;
      const dx = sx - (p.x + p.w / 2), dy = sy - (p.y + p.h / 2);
      if (dx > 2) hold("ArrowRight"); if (dx < -2) hold("ArrowLeft"); if (dy > 2) hold("ArrowDown"); if (dy < -2) hold("ArrowUp");
    },
    shmup(w) {
      const p = w.player; if (!p || p.dead) return;
      let ty = w.H / 2, tx = 90;
      const ahead = w.enemies.filter((e) => !e.dead && !e.delay && e.x > p.x).sort((a, b) => a.x - b.x)[0];
      if (ahead) ty = ahead.y; if (w.boss && w.boss.active && !w.boss.dead) ty = w.boss.y;
      let push = 0;
      for (const s of w.eshots) { const dx = s.x - p.x, dy = s.y - p.y; if (dx > -10 && dx < 70 && Math.abs(dy) < 22) push += (dy > 0 ? -1 : 1) * (22 - Math.abs(dy)); }
      const want = ty + push * 2.2 - p.y;
      if (want > 4) hold("ArrowDown"); if (want < -4) hold("ArrowUp");
      if (p.x < tx - 6) hold("ArrowRight"); if (p.x > tx + 30) hold("ArrowLeft");
      if (w.eshots.length > 30 && p.bombs > 0 && Math.random() < 0.01) tap("b");
    },
  };
  const orig = g.step.bind(g);
  g.step = (dt) => {
    t += dt;
    inp.keys = {};
    if (g.scene === "play" && g.world) pilots[g.spec.genre](g.world);
    orig(dt);
  };
  return true;
})()`;

const W = { arena: [384, 216], dungeon: [384, 216] };
const b = await launch({ size: "480x270" });
try {
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  await b.goto(url);
  for (let i = 0; i < 40 && !(await b.eval("!!(window.CG && CG.game && CG.game.scene === 'title')")); i++) {
    await b.eval("window.__step && __step(1)");
    await new Promise((r) => setTimeout(r, 100));
  }
  const genre = await b.eval("CG.game.spec.genre");
  const [vw, vh] = await b.eval("[CG.game.W, CG.game.H]");
  await b.send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
  await b.eval("window.dispatchEvent(new Event('resize')); __step(2); true");
  await b.eval("CG.game.audio.muted = true; true");
  await b.eval(PILOT);
  if (start !== "title") {
    await b.eval(`(() => { const g = CG.game; g.score = 0; g.lives = 9; g.stats = { coins: 0, kills: 0, deaths: 0, time: 0, gems: 0 }; g.carry = {}; g.beginLevel(${level != null ? Number(level) : 0}); g.transition.t = 0; g.transition.dir = 0; return true; })()`);
    if (start === "boss") {
      await b.eval(`(() => { const g = CG.game; g.beginLevel(g.spec.levels.length - 1); g.transition.t = 0; g.transition.dir = 0; const w = g.world;
        if (w.bossSpawn && w.player && g.spec.genre === "platformer") { w.player.x = w.bossSpawn.x - 170; w.player.y = w.bossSpawn.y - 40; w.cam.snap(w.player.x, w.player.y); }
        if (g.spec.genre === "dungeon" && w.boss) { w.player.x = w.boss.x - 80; w.player.y = w.boss.y + 4; w.cam.snap(w.player.x, w.player.y); }
        if (g.spec.genre === "arena") { w.timeLeft = 0.2; }
        if (g.spec.genre === "shmup") { w.t = w.length - 1; w.waveIdx = w.waves.length; }
        return true; })()`);
    }
  }
  const total = Math.round(seconds * fps), per = Math.round(60 / fps);
  const log = [];
  for (let f = 0; f < total; f++) {
    await b.eval(`__step(${per})`);
    const data = await b.eval("CG.game.gfx.display.toDataURL('image/png')");
    fs.writeFileSync(path.join(out, `f${String(f).padStart(5, "0")}.png`), Buffer.from(data.split(",")[1], "base64"));
    if (f % fps === 0) log.push(await b.eval("JSON.stringify({s: CG.game.scene, l: CG.game.levelIndex, d: CG.game.stats ? CG.game.stats.deaths : 0, k: CG.game.stats ? CG.game.stats.kills : 0, x: CG.game.world && CG.game.world.player ? Math.round(CG.game.world.player.x) : 0})"));
  }
  fs.writeFileSync(path.join(out, "log.json"), JSON.stringify({ url, genre, width: vw, height: vh, fps, frames: total, log: log.map((l) => JSON.parse(l)) }, null, 1));
  console.log(JSON.stringify({ genre, frames: total, size: [vw, vh], last: log.at(-1), errors: b.logs.filter((l) => /error|exception/i.test(l)).slice(0, 5) }));
} finally {
  await b.close();
}
