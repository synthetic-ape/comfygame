// Headless playtest harness: drives Chrome over the DevTools protocol (no dependencies, Node 22+).
//
//   node tools/playtest.mjs <url> [steps] [--out dir] [--size 960x540]
//
// steps is a "|" separated list: wait:ms  shot:name  key:Code  hold:Code:ms  down:Code  up:Code  eval:js  click:x:y
// Example: node tools/playtest.mjs http://127.0.0.1:8765/game/ "wait:1200|shot:title|key:Enter|wait:1500|hold:ArrowRight:1500|shot:run"
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEYS = {
  ArrowLeft: [37, "ArrowLeft"], ArrowUp: [38, "ArrowUp"], ArrowRight: [39, "ArrowRight"], ArrowDown: [40, "ArrowDown"],
  Enter: [13, "Enter"], Space: [32, " "], Escape: [27, "Escape"], KeyZ: [90, "z"], KeyX: [88, "x"], KeyC: [67, "c"],
  ShiftLeft: [16, "Shift"], KeyP: [80, "p"], KeyM: [77, "m"], KeyA: [65, "a"], KeyD: [68, "d"], KeyW: [87, "w"], KeyS: [83, "s"], KeyJ: [74, "j"], KeyK: [75, "k"],
};

export function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}

export async function launch({ size = "960x540", port = 9300 + Math.floor(Math.random() * 500) } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error("Chrome/Edge not found (set CHROME_PATH)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-chrome-"));
  const [w, h] = size.split("x").map(Number);
  const proc = spawn(exe, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${w},${h}`,
    "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", "--mute-audio",
    "--enable-unsafe-swiftshader", "about:blank",
  ], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { /* not up yet */ }
  }
  if (!targets) throw new Error("Chrome did not start");
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === "Runtime.consoleAPICalled") logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    else if (msg.method === "Runtime.exceptionThrown") logs.push("[exception] " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const api = {
    send, logs,
    async goto(url) { await send("Page.navigate", { url }); await new Promise((r) => setTimeout(r, 600)); },
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result?.value;
    },
    async key(code, type) {
      const [vk, key] = KEYS[code] || [0, code];
      await send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    },
    async press(code, ms = 60) { await api.key(code, "keyDown"); await new Promise((r) => setTimeout(r, ms)); await api.key(code, "keyUp"); },
    async click(x, y) {
      for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    },
    async shot(file) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); return file; },
    async close() { try { ws.close(); } catch { /* ignore */ } proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }, 500); },
  };
  return api;
}

export async function run(url, steps, { out = ".", size } = {}) {
  const b = await launch({ size });
  fs.mkdirSync(out, { recursive: true });
  const shots = [];
  try {
    await b.goto(url);
    for (const raw of steps.split("|").map((s) => s.trim()).filter(Boolean)) {
      const [cmd, ...args] = raw.split(":");
      const rest = raw.slice(cmd.length + 1);
      if (cmd === "wait") await new Promise((r) => setTimeout(r, Number(args[0])));
      else if (cmd === "shot") shots.push(await b.shot(path.join(out, `${args[0]}.png`)));
      else if (cmd === "key") await b.press(args[0]);
      else if (cmd === "down") await b.key(args[0], "keyDown");
      else if (cmd === "up") await b.key(args[0], "keyUp");
      else if (cmd === "hold") { await b.key(args[0], "keyDown"); await new Promise((r) => setTimeout(r, Number(args[1]))); await b.key(args[0], "keyUp"); }
      else if (cmd === "click") await b.click(Number(args[0]), Number(args[1]));
      else if (cmd === "eval") console.log("eval>", JSON.stringify(await b.eval(rest)));
    }
  } finally {
    const errs = b.logs.filter((l) => /error|exception|crash/i.test(l));
    console.log(JSON.stringify({ shots, errors: errs, logs: b.logs.slice(-15) }, null, 1));
    await b.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  const [url, steps = "wait:1500|shot:page"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const opt = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
  run(url, steps, { out: opt("--out", "."), size: opt("--size", "960x540") }).catch((e) => { console.error(e); process.exit(1); });
}
