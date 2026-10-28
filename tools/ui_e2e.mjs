// End-to-end UI test: loads example workflows in the real ComfyUI frontend, queues them, checks for errors,
// screenshots the in-node player and the ComfyGame sidebar panel.
//   node tools/ui_e2e.mjs [base-url] [workflow names...] [--out dir]
import fs from "node:fs";
import path from "node:path";
import { launch } from "./playtest.mjs";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : "ui-out";
const base = args[0] || "http://127.0.0.1:8188";
const names = args.slice(1).length ? args.slice(1) : ["01_quick_platformer", "03_all_genres", "04_idea_dice", "07_ascii_level"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

const b = await launch({ size: "1700x960" });
const results = [];
try {
  await b.goto(base);
  await sleep(9000);
  // tidy the canvas: close side panels that a user may have left open
  await b.eval(`document.querySelectorAll('[aria-label="Close"], .p-dialog-close-button').forEach(x => { try { x.click(); } catch (e) {} }); true`);
  for (const name of names) {
    const r = { name, ok: true };
    try {
      await b.eval(`(async () => { const wf = await (await fetch('/api/comfygame/workflows/${name}')).json(); await comfyAPI.app.app.loadGraphData(wf, true, true, '${name}'); return true; })()`);
      await sleep(1500);
      const before = await b.eval(`fetch('/api/history?max_items=1').then(r=>r.json()).then(h=>Object.keys(h)[0]||'')`);
      await b.eval(`comfyAPI.app.app.queuePrompt(0, 1).then(() => true)`);
      // wait for the queue to drain
      let done = false;
      for (let i = 0; i < 240 && !done; i++) {
        await sleep(1500);
        const q = await b.eval(`fetch('/api/queue').then(r=>r.json()).then(q=>q.queue_running.length + q.queue_pending.length)`);
        const last = await b.eval(`fetch('/api/history?max_items=1').then(r=>r.json()).then(h=>Object.keys(h)[0]||'')`);
        done = q === 0 && last && last !== before;
      }
      const status = await b.eval(`fetch('/api/history?max_items=1').then(r=>r.json()).then(h=>{const v=Object.values(h)[0]; return {s: v.status.status_str, msgs: v.status.messages.filter(m=>m[0]==='execution_error').map(m=>m[1].exception_message)}})`);
      r.status = status;
      if (status.s !== "success") r.ok = false;
      await sleep(1200);
      r.players = await b.eval(`comfyAPI.app.app.graph._nodes.filter(n=>n.comfyClass==='ComfyGameBuild').map(n=>n.cgPlayer && n.cgPlayer.info ? n.cgPlayer.info.id : null)`);
      if (!r.players.length || r.players.some((x) => !x)) { r.ok = false; r.note = "player widget not loaded"; }
      await b.shot(path.join(out, `${name}.png`));
    } catch (e) {
      r.ok = false;
      r.error = e.message;
    }
    results.push(r);
    console.log(JSON.stringify(r));
  }
  // start the first game inside its node and screenshot it running
  try {
    await b.eval(`(()=>{ const n = comfyAPI.app.app.graph._nodes.find(n=>n.comfyClass==='ComfyGameBuild'); n.cgPlayer.el.querySelector('.cg-poster').click(); return true; })()`);
    await sleep(3500);
    await b.shot(path.join(out, "node_player_running.png"));
  } catch (e) { console.log("node player:", e.message); }
  // sidebar panel tabs
  try {
    await b.eval(`(()=>{ const btn=[...document.querySelectorAll('button, .side-bar-button')].find(x=>/ComfyGame/i.test(x.getAttribute('aria-label')||x.textContent||'')); btn.click(); return !!btn; })()`);
    await sleep(1500);
    for (const tab of ["Play", "Library", "Create", "AI Studio"]) {
      await b.eval(`(()=>{ const t=[...document.querySelectorAll('.cg-tab')].find(x=>x.textContent==='${tab}'); t && t.click(); return !!t; })()`);
      await sleep(1800);
      await b.shot(path.join(out, `panel_${tab.replace(" ", "_").toLowerCase()}.png`));
    }
  } catch (e) { console.log("panel:", e.message); }
} finally {
  const errs = b.logs.filter((l) => /\[(error|exception)\]/.test(l) && !/graph accessed before initialization|favicon/.test(l));
  console.log(JSON.stringify({ consoleErrors: errs.slice(0, 20) }, null, 1));
  await b.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
