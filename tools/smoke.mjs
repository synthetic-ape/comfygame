// Smoke test: play each built game with a simple bot, force the level-clear / victory flow, report errors.
//   node tools/smoke.mjs <base-url> <game-id> [<game-id> ...] [--out dir]
import fs from "node:fs";
import path from "node:path";
import { launch } from "./playtest.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOTS = {
  async platformer(b, ms) {
    await b.key("ArrowRight", "keyDown");
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await b.press("Space", 220);
      await sleep(260 + Math.random() * 300);
    }
    await b.key("ArrowRight", "keyUp");
  },
  async arena(b, ms) {
    const dirs = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    const end = Date.now() + ms;
    let i = 0;
    while (Date.now() < end) {
      const d = dirs[i++ % 4];
      await b.key(d, "keyDown");
      await sleep(500);
      if (i % 3 === 0) await b.press("Space", 50);
      await b.key(d, "keyUp");
      // pick an upgrade if a choice screen is open
      if (await b.eval("!!(CG.game.world && CG.game.world.choice)")) { await sleep(400); await b.press("Space"); }
    }
  },
  async dungeon(b, ms) {
    const dirs = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    const end = Date.now() + ms;
    let i = 0;
    while (Date.now() < end) {
      const d = dirs[Math.floor(i++ / 2) % 4];
      await b.key(d, "keyDown");
      await b.press("KeyX", 80);
      await sleep(350);
      await b.key(d, "keyUp");
    }
  },
  async shmup(b, ms) {
    const end = Date.now() + ms;
    let up = true;
    while (Date.now() < end) {
      const d = up ? "ArrowUp" : "ArrowDown";
      await b.key(d, "keyDown");
      await sleep(600);
      await b.key(d, "keyUp");
      up = !up;
      if (Math.random() < 0.15) await b.press("KeyX");
    }
  },
};

async function testGame(base, id, out) {
  const b = await launch({ size: "960x540" });
  const report = { id, ok: true, notes: [] };
  const shot = async (name) => b.shot(path.join(out, `${id}_${name}.png`));
  try {
    await b.goto(`${base.replace(/\/$/, "")}/${id}`);
    await sleep(1500);
    const genre = await b.eval("CG.game && CG.game.spec.genre");
    report.genre = genre;
    if (!genre) throw new Error("game did not boot");
    await shot("title");
    await b.press("Enter");
    await sleep(1800);
    if ((await b.eval("CG.game.scene")) === "intro") { await b.press("Enter"); await sleep(300); await b.press("Enter"); await sleep(1300); }
    report.notes.push("scene after start: " + (await b.eval("CG.game.scene")));
    await BOTS[genre](b, 6000);
    await shot("play");
    const st = await b.eval("(() => { const g = CG.game, w = g.world; return { scene: g.scene, level: g.levelIndex, score: g.score, lives: g.lives, kills: g.stats.kills, coins: g.stats.coins, px: w && w.player ? Math.round(w.player.x) : null, enemies: w && w.enemies ? w.enemies.length : null }; })()");
    report.state = st;
    await BOTS[genre](b, 5000);
    await shot("play2");
    // walk through every level with forced wins to exercise transitions, boss levels and the victory screen
    const levels = await b.eval("CG.game.spec.levels.length");
    for (let i = 0; i < levels; i++) {
      await b.eval("CG.game.world && CG.game.world.forceWin && CG.game.world.forceWin()");
      await sleep(2400);
      const sc = await b.eval("CG.game.scene");
      if (sc !== "clear") report.notes.push(`level ${i}: expected clear, got ${sc}`);
      if (i === 0) await shot("clear");
      await b.press("Enter");
      await sleep(1400);
      if (i < levels - 1) {
        const lvl = await b.eval("CG.game.levelIndex");
        if (lvl !== i + 1) report.notes.push(`expected level ${i + 1}, got ${lvl}`);
        await BOTS[genre](b, 1200);
        if (i === levels - 2) await shot("lastlevel");
      }
    }
    const fin = await b.eval("CG.game.scene");
    if (fin !== "victory") { report.ok = false; report.notes.push("final scene " + fin); }
    await sleep(1200);
    await shot("victory");
  } catch (e) {
    report.ok = false;
    report.notes.push("ERROR " + e.message);
  } finally {
    report.errors = b.logs.filter((l) => /error|exception|crash|failed/i.test(l));
    if (report.errors.length) report.ok = false;
    await b.close();
  }
  return report;
}

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : "smoke-out";
const [base, ...ids] = args;
fs.mkdirSync(out, { recursive: true });
const results = [];
for (const id of ids) {
  const r = await testGame(base, id, out);
  console.log(JSON.stringify(r));
  results.push(r);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
