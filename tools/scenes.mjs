// Visual review: jumps a built game into key moments and screenshots them.
//   node tools/scenes.mjs <play-url> <name> [--out dir]
import fs from "node:fs";
import path from "node:path";
import { launch } from "./playtest.mjs";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : "scenes-out";
const [url, name = "game"] = args;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

const b = await launch({ size: "960x540" });
const shot = (n) => b.shot(path.join(out, `${name}_${n}.png`));
try {
  await b.goto(url);
  await sleep(1800);
  const genre = await b.eval("CG.game.spec.genre");
  await b.press("Enter");
  await sleep(700);
  if ((await b.eval("CG.game.scene")) === "intro") { await shot("intro"); await b.press("Enter"); await sleep(300); await b.press("Enter"); }
  await sleep(1800);
  // play a bit
  if (genre === "platformer") {
    await b.key("ArrowRight", "keyDown");
    for (let i = 0; i < 6; i++) { await b.press("Space", 200); await sleep(250); }
    await b.key("ArrowRight", "keyUp");
  } else if (genre === "shmup") {
    await b.key("ArrowUp", "keyDown"); await sleep(1500); await b.key("ArrowUp", "keyUp"); await sleep(3500);
  } else {
    await b.key("ArrowRight", "keyDown"); await sleep(900); await b.key("ArrowRight", "keyUp");
    for (let i = 0; i < 5; i++) { await b.press("KeyX", 80); await sleep(250); }
  }
  await shot("action");
  if (genre === "arena") {
    await b.eval("CG.game.world.gainXp(CG.game.world.xpNext)");
    await sleep(900);
    await shot("levelup");
    await b.press("Space"); await sleep(400);
    await b.eval("(() => { const w = CG.game.world; w.timeLeft = 0.5; })()");
    await sleep(3500);
    await shot("boss");
  } else if (genre === "platformer") {
    await b.eval("(() => { const g = CG.game; g.beginLevel(g.spec.levels.length - 1); })()");
    await sleep(500);
    await b.eval("(() => { const w = CG.game.world; if (w.bossSpawn) { w.player.x = w.bossSpawn.x - 150; w.player.y = w.bossSpawn.y - 40; w.cam.snap(w.player.x, w.player.y); } })()");
    await b.key("ArrowRight", "keyDown"); await sleep(400); await b.key("ArrowRight", "keyUp");
    await sleep(2600);
    await shot("boss");
  } else if (genre === "dungeon") {
    await b.eval("(() => { const g = CG.game; g.beginLevel(g.spec.levels.length - 1); })()");
    await sleep(500);
    await b.eval("(() => { const w = CG.game.world; if (w.boss) { w.player.x = w.boss.x - 70; w.player.y = w.boss.y + 4; w.cam.snap(w.player.x, w.player.y); } })()");
    await sleep(3200);
    await b.press("KeyX"); await sleep(600);
    await shot("boss");
  } else if (genre === "shmup") {
    await b.eval("(() => { const w = CG.game.world; w.t = w.length + 0.1; w.waveIdx = w.waves.length; })()");
    await sleep(6500);
    await shot("boss");
  }
  await b.press("Escape"); await sleep(500);
  await shot("pause");
  await b.press("Escape"); await sleep(300);
  await b.eval("(() => { const g = CG.game; g.lives = 1; const w = g.world; if (w.killPlayer) w.killPlayer(); else if (w.hitPlayer) { w.player.inv = 0; w.player.shield = 0; w.hitPlayer(); } else { w.player.inv = 0; w.hurtPlayer(99); } })()");
  await sleep(3500);
  await shot("gameover");
} catch (e) {
  console.log("ERROR", e.message);
} finally {
  console.log(JSON.stringify({ errors: b.logs.filter((l) => /error|exception/i.test(l)) }));
  await b.close();
}
