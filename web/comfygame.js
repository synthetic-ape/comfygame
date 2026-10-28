// ComfyGame frontend: in-node game player, sidebar panel (play, library, templates, AI studio), node colours.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const CATEGORY_COLORS = {
  ComfyGame: ["#1d4d55", "#163c42"],
  "ComfyGame/Art": ["#5b3170", "#462656"],
  "ComfyGame/World": ["#2f5a2c", "#244522"],
  "ComfyGame/Actors": ["#6a3d1e", "#522f17"],
  "ComfyGame/Audio": ["#26457a", "#1d355e"],
  "ComfyGame/Design": ["#7a5a14", "#5e4510"],
};
const TYPE_COLORS = {
  CG_GAME: "#3ec6d4", CG_SPRITE: "#c77dff", CG_ACTOR: "#ff9f43", CG_ROSTER: "#ff6b6b", CG_LEVELS: "#6ad46a",
  CG_TILESET: "#9ccc65", CG_BACKDROP: "#80cbc4", CG_MUSIC: "#64b5f6", CG_SFX: "#4fc3f7", CG_PALETTE: "#f6c453",
};
const categoryOf = {};
const listeners = new Set();
let current = null;

const url = (route) => api.apiURL(route);
const playUrl = (id) => url(`/comfygame/play/${encodeURIComponent(id)}`) + `?v=${Date.now()}`;
const toast = (severity, summary, detail, life = 4000) => {
  try { app.extensionManager.toast.add({ severity, summary, detail, life }); } catch (e) { console.log("[ComfyGame]", summary, detail); }
};
const setCurrent = (info) => { current = info; for (const fn of listeners) fn(info); };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}

const CSS = `
.cg-player{display:flex;flex-direction:column;gap:6px;width:100%;height:100%;box-sizing:border-box}
.cg-screen{position:relative;flex:1;min-height:150px;background:#05050a;border-radius:8px;overflow:hidden;border:1px solid var(--border-color,#333)}
.cg-screen iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
.cg-poster{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#cfd3e6;font:13px sans-serif;text-align:center;padding:12px;background-size:cover;background-position:center;cursor:pointer}
.cg-poster.has-thumb::before{content:"";position:absolute;inset:0;background:rgba(5,5,10,.35)}
.cg-poster > *{position:relative}
.cg-play-btn{width:64px;height:64px;border-radius:50%;background:#3ec6d4;color:#05121a;display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 4px 18px rgba(0,0,0,.5);transition:transform .15s}
.cg-poster:hover .cg-play-btn{transform:scale(1.08)}
.cg-bar{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.cg-bar .cg-title{flex:1;min-width:80px;font:600 12px sans-serif;color:var(--input-text,#ddd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cg-btn{background:var(--comfy-input-bg,#222);color:var(--input-text,#ddd);border:1px solid var(--border-color,#444);border-radius:6px;padding:4px 9px;font:12px sans-serif;cursor:pointer;white-space:nowrap}
.cg-btn:hover{border-color:#3ec6d4;color:#fff}
.cg-btn.primary{background:#2a8f9a;border-color:#3ec6d4;color:#fff}
.cg-btn.primary:hover{background:#33a7b4}
.cg-btn.danger:hover{border-color:#ff6b6b}
.cg-btn:disabled{opacity:.5;cursor:default}
.cg-panel{display:flex;flex-direction:column;height:100%;font:13px sans-serif;color:var(--input-text,#ddd);box-sizing:border-box}
.cg-head{display:flex;align-items:center;gap:8px;padding:12px 12px 6px}
.cg-logo{font:800 17px sans-serif;letter-spacing:.5px;background:linear-gradient(90deg,#3ec6d4,#c77dff);-webkit-background-clip:text;background-clip:text;color:transparent}
.cg-sub{color:var(--descrip-text,#999);font-size:11px}
.cg-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--border-color,#333)}
.cg-tab{padding:7px 10px;cursor:pointer;color:var(--descrip-text,#999);border-bottom:2px solid transparent;font-weight:600;font-size:12px}
.cg-tab.on{color:#fff;border-bottom-color:#3ec6d4}
.cg-body{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
.cg-card{background:var(--comfy-input-bg,#1d1d1d);border:1px solid var(--border-color,#333);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
.cg-card h4{margin:0;font:700 13px sans-serif;color:#fff}
.cg-card p{margin:0;color:var(--descrip-text,#aaa);font-size:12px;line-height:1.45}
.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.cg-game{border-radius:8px;overflow:hidden;border:1px solid var(--border-color,#333);background:#0b0b12;cursor:pointer;display:flex;flex-direction:column}
.cg-game:hover{border-color:#3ec6d4}
.cg-game img{width:100%;aspect-ratio:16/9;object-fit:cover;image-rendering:pixelated;display:block}
.cg-game .meta{padding:6px 7px;display:flex;flex-direction:column;gap:2px}
.cg-game .t{font-weight:700;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cg-game .g{font-size:11px;color:var(--descrip-text,#999)}
.cg-game .acts{display:flex;gap:4px;padding:0 7px 7px}
.cg-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cg-field{display:flex;flex-direction:column;gap:3px;flex:1;min-width:110px}
.cg-field label{font-size:11px;color:var(--descrip-text,#999)}
.cg-input,.cg-select,.cg-area{background:var(--comfy-menu-bg,#151515);color:var(--input-text,#ddd);border:1px solid var(--border-color,#444);border-radius:6px;padding:6px 8px;font:12px sans-serif;box-sizing:border-box;width:100%}
.cg-area{min-height:84px;resize:vertical;font-family:inherit;line-height:1.4}
.cg-dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:#666}
.cg-dot.ok{background:#4ade80}.cg-dot.bad{background:#f87171}
.cg-busy{display:flex;align-items:center;gap:8px;color:#3ec6d4;font-size:12px}
.cg-spin{width:14px;height:14px;border:2px solid #3ec6d4;border-top-color:transparent;border-radius:50%;animation:cgspin .8s linear infinite}
@keyframes cgspin{to{transform:rotate(360deg)}}
.cg-tpl{display:flex;gap:10px;align-items:flex-start;text-align:left;white-space:normal;width:100%;box-sizing:border-box}
.cg-tpl .ic{font-size:22px;line-height:1}
.cg-empty{color:var(--descrip-text,#999);text-align:center;padding:30px 10px}
.cg-check{display:flex;gap:7px;align-items:center;font-size:12px;color:var(--descrip-text,#aaa);cursor:pointer}
.cg-check input{margin:0;flex:none}
`;

function injectCss() {
  if (document.getElementById("cg-style")) return;
  document.head.append(el("style", { id: "cg-style" }, CSS));
}

// ---------------------------------------------------------------- player widget
function makePlayer(opts = {}) {
  const screen = el("div", { class: "cg-screen" });
  const title = el("div", { class: "cg-title" }, opts.emptyTitle || "No game yet");
  let info = null, frame = null;
  const poster = () => {
    screen.replaceChildren();
    frame = null;
    const p = el("div", { class: "cg-poster" + (info ? " has-thumb" : "") });
    if (info) {
      p.style.backgroundImage = `url("${url(`/comfygame/thumb/${encodeURIComponent(info.id)}`)}?v=${info.v || 0}")`;
      p.append(el("div", { class: "cg-play-btn" }, "▶"), el("div", { style: { fontWeight: "700", textShadow: "0 1px 3px #000" } }, "Click to play"));
      p.addEventListener("click", () => start());
    } else {
      p.append(el("div", { style: { fontSize: "28px" } }, "🎮"), el("div", {}, opts.emptyText || "Queue the workflow to build a game"));
    }
    screen.append(p);
  };
  const start = () => {
    if (!info) return;
    screen.replaceChildren();
    frame = el("iframe", { sandbox: "allow-scripts allow-pointer-lock", allow: "fullscreen; autoplay; gamepad", allowfullscreen: true, title: info.title || "game" });
    frame.src = playUrl(info.id);
    screen.append(frame);
    setTimeout(() => frame && frame.focus(), 150);
  };
  const btn = (label, tip, fn, cls = "cg-btn") => el("button", { class: cls, title: tip, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  const bar = el("div", { class: "cg-bar" }, title,
    btn("▶ Play", "Restart the game", () => start()),
    btn("⛶", "Fullscreen", () => { if (!frame) start(); setTimeout(() => (frame || screen).requestFullscreen && (frame || screen).requestFullscreen(), 60); }),
    btn("↗", "Open in a new browser tab", () => info && window.open(url(`/comfygame/play/${encodeURIComponent(info.id)}`), "_blank")),
    btn("⤓ HTML", "Download the single-file game", () => info && window.open(url(`/comfygame/download/${encodeURIComponent(info.id)}`), "_blank")),
    btn("⤓ itch.io", "Download a zip ready for itch.io (HTML5 game)", () => info && window.open(url(`/comfygame/download/${encodeURIComponent(info.id)}`) + "?zip=1", "_blank")),
  );
  const root = el("div", { class: "cg-player" }, screen, bar);
  // keep keyboard input inside the game instead of the graph editor
  for (const ev of ["keydown", "keyup", "wheel", "pointerdown"]) root.addEventListener(ev, (e) => e.stopPropagation());
  poster();
  return {
    el: root,
    load(i, autoplay = false) {
      info = Object.assign({}, i, { v: Date.now() });
      title.textContent = `${i.title || i.id}  ·  ${i.genre || ""}${i.levels ? "  ·  " + i.levels + " levels" : ""}`;
      autoplay ? start() : poster();
    },
    stop() { poster(); },
    get info() { return info; },
  };
}

// ---------------------------------------------------------------- sidebar panel
function renderPanel(container) {
  injectCss();
  container.replaceChildren();
  const tabs = ["Play", "Library", "Create", "AI Studio"];
  let active = current ? "Play" : "Create";
  const body = el("div", { class: "cg-body" });
  const tabRow = el("div", { class: "cg-tabs" });
  const player = makePlayer({ emptyText: "Build a game (Create tab or the Build & Play node) and it shows up here." });
  if (current) player.load(current);
  const onCurrent = (info) => { player.load(info, true); show("Play"); };
  listeners.add(onCurrent);

  const show = (name) => {
    active = name;
    tabRow.replaceChildren(...tabs.map((t) => el("div", { class: "cg-tab" + (t === active ? " on" : ""), onclick: () => show(t) }, t)));
    body.replaceChildren();
    if (name === "Play") renderPlay();
    else if (name === "Library") renderLibrary();
    else if (name === "Create") renderCreate();
    else renderAI();
  };

  const renderPlay = () => {
    player.el.style.height = "auto";
    player.el.querySelector(".cg-screen").style.aspectRatio = "16/9";
    body.append(player.el);
    body.append(el("div", { class: "cg-card" }, el("h4", {}, "Controls"),
      el("p", {}, "Click the game first. Arrows / WASD move, Space / Z jump or dodge, X / J attack or bomb, Shift / C dash or focus, Esc pause, M mute, F fullscreen. Gamepads and touch work too.")));
  };

  const renderLibrary = async () => {
    const grid = el("div", { class: "cg-grid" });
    body.append(el("div", { class: "cg-row" }, el("div", { class: "cg-sub", style: { flex: 1 } }, "Every game you build is saved in output/comfygame."),
      el("button", { class: "cg-btn", onclick: () => show("Library") }, "⟳ Refresh")), grid);
    let games = [];
    try { games = await (await api.fetchApi("/comfygame/games")).json(); } catch (e) { grid.append(el("div", { class: "cg-empty" }, "Could not load games: " + e)); return; }
    if (!games.length) { grid.replaceWith(el("div", { class: "cg-empty" }, "No games yet. Head to Create!")); return; }
    for (const g of games) {
      let armed = false;
      const del = el("button", { class: "cg-btn danger", title: "Delete this game", onclick: async (e) => {
        e.stopPropagation();
        if (!armed) { armed = true; del.textContent = "Sure?"; setTimeout(() => { armed = false; del.textContent = "🗑"; }, 2500); return; }
        await api.fetchApi(`/comfygame/games/${encodeURIComponent(g.id)}`, { method: "DELETE" });
        card.remove();
      } }, "🗑");
      const card = el("div", { class: "cg-game", onclick: () => { setCurrent(g); } },
        el("img", { src: url(`/comfygame/thumb/${encodeURIComponent(g.id)}`), loading: "lazy" }),
        el("div", { class: "meta" }, el("div", { class: "t" }, g.title), el("div", { class: "g" }, `${g.genre} · ${g.levels} levels · ${new Date(g.created * 1000).toLocaleDateString()}`)),
        el("div", { class: "acts" },
          el("button", { class: "cg-btn primary", onclick: (e) => { e.stopPropagation(); setCurrent(g); } }, "▶ Play"),
          el("button", { class: "cg-btn", title: "Download HTML", onclick: (e) => { e.stopPropagation(); window.open(url(`/comfygame/download/${encodeURIComponent(g.id)}`), "_blank"); } }, "⤓"),
          del));
      grid.append(card);
    }
  };

  const loadTemplate = async (name, after) => {
    try {
      const wf = await (await api.fetchApi(`/comfygame/workflows/${encodeURIComponent(name)}`)).json();
      await app.loadGraphData(wf, true, true, name);
      if (after) after();
      toast("success", "Template loaded", name + " — press Run (or Ctrl+Enter) to build the game.");
    } catch (e) { toast("error", "Could not load template", String(e)); }
  };

  const quickBuild = async (design, statusEl) => {
    statusEl.replaceChildren(el("span", { class: "cg-spin" }), "Building game (art, levels, music)...");
    const r = await api.fetchApi("/comfygame/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design }) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    statusEl.replaceChildren();
    setCurrent(j);
    toast("success", "Game ready", j.title);
    return j;
  };

  const renderCreate = async () => {
    const status = el("div", { class: "cg-busy" });
    const genre = el("select", { class: "cg-select" }, ...["any", "platformer", "arena", "dungeon", "shmup"].map((g) => el("option", { value: g }, g)));
    body.append(el("div", { class: "cg-card" },
      el("h4", {}, "🎲 Instant game (no AI, no models)"),
      el("p", {}, "Rolls a complete design and builds it: procedural pixel art, levels, chiptune music and sound effects."),
      el("div", { class: "cg-row" }, el("div", { class: "cg-field" }, el("label", {}, "Genre"), genre),
        el("button", { class: "cg-btn primary", style: { alignSelf: "flex-end" }, onclick: async (e) => {
          e.target.disabled = true;
          try {
            const d = await (await api.fetchApi(`/comfygame/dice?seed=${Math.floor(Math.random() * 1e9)}&genre=${genre.value}`)).json();
            await quickBuild(d, status);
          } catch (err) { status.replaceChildren(); toast("error", "Build failed", String(err.message || err)); }
          e.target.disabled = false;
        } }, "Roll & build")), status));
    const card = el("div", { class: "cg-card" }, el("h4", {}, "📐 Node-graph templates"), el("p", {}, "Load a ready workflow onto the canvas, tweak any node, then Run."));
    let names = [];
    try { names = await (await api.fetchApi("/comfygame/workflows")).json(); } catch (e) { /* none */ }
    const describe = {
      "01_quick_platformer": ["🏃", "Quick platformer", "Game Setup → Build. The smallest possible game graph."],
      "02_custom_platformer": ["🛠️", "Custom platformer", "Every part as a node: palette, sprites, tiles, background, levels, enemies, boss, music, SFX, script."],
      "03_all_genres": ["🕹️", "Four genres", "Platformer, arena survivor, dungeon crawler and space shooter side by side."],
      "04_idea_dice": ["🎲", "Idea Dice", "A random but coherent game design every run, no AI."],
      "05_ai_art_zimage": ["🖼️", "AI art (Z-Image Turbo)", "Idea Dice designs the cast, a fast local image model draws it, Sprite From Image pixelates it."],
      "06_ai_designer_claude": ["🤖", "AI designer (Claude)", "Describe a game; Claude designs it and Z-Image draws the cast."],
      "07_ascii_level": ["✏️", "Hand-made level", "Draw a level with text characters."],
      "08_local_llm": ["🧠", "Local LLM designer", "Design games with a text model running inside ComfyUI (no internet)."],
    };
    const list = el("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } });
    for (const n of names) {
      const [ic, t, d] = describe[n] || ["📄", n, ""];
      list.append(el("button", { class: "cg-btn cg-tpl", onclick: () => loadTemplate(n) }, el("span", { class: "ic" }, ic),
        el("span", {}, el("div", { style: { fontWeight: "700", marginBottom: "2px" } }, t), el("div", { class: "cg-sub" }, d))));
    }
    if (!names.length) list.append(el("div", { class: "cg-sub" }, "No templates found (example_workflows folder)."));
    card.append(list);
    body.append(card);
    body.append(el("div", { class: "cg-card" }, el("h4", {}, "Tip"), el("p", {}, "Double-click the canvas and type 'ComfyGame' to see every node. Build & Play shows the game right inside the node.")));
  };

  const renderAI = async () => {
    const status = el("div", { class: "cg-busy" });
    const idea = el("textarea", { class: "cg-area", placeholder: "Describe your game... e.g. 'a grumpy cat wizard who throws fish at haunted vacuum cleaners in a spooky mansion'" });
    idea.value = localStorage.getItem("cg.idea") || "";
    idea.addEventListener("input", () => localStorage.setItem("cg.idea", idea.value));
    const provider = el("select", { class: "cg-select" },
      el("option", { value: "claude_code" }, "Claude subscription (Claude Code)"), el("option", { value: "anthropic_api" }, "Claude API key"),
      el("option", { value: "openai_compat" }, "Local server (Ollama / LM Studio)"));
    provider.value = localStorage.getItem("cg.provider") || "claude_code";
    provider.addEventListener("change", () => localStorage.setItem("cg.provider", provider.value));
    const model = el("input", { class: "cg-input", placeholder: "default", value: localStorage.getItem("cg.model") || "" });
    model.addEventListener("change", () => localStorage.setItem("cg.model", model.value));
    const effort = el("select", { class: "cg-select" }, ...["low", "medium", "high"].map((x) => el("option", { value: x }, x)));
    effort.value = "medium";
    const genre = el("select", { class: "cg-select" }, ...["auto", "platformer", "arena", "dungeon", "shmup"].map((g) => el("option", { value: g }, g)));
    const code = el("input", { type: "checkbox" });
    const dots = el("span", { class: "cg-sub" }, "checking providers...");
    const revise = el("input", { type: "checkbox" });
    const run = async (btn) => {
      if (!idea.value.trim()) { toast("warn", "Describe your game first"); return; }
      btn.disabled = true;
      status.replaceChildren(el("span", { class: "cg-spin" }), "Designing with AI (10-60 s)...");
      try {
        const body = { idea: idea.value, provider: provider.value, model: model.value, effort: effort.value, genre: genre.value, allow_code: code.checked };
        if (revise.checked && current) body.base_id = current.id;
        const r = await api.fetchApi("/comfygame/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || r.statusText);
        await quickBuild(j.design, status);
      } catch (err) { status.replaceChildren(); toast("error", "AI design failed", String(err.message || err), 9000); }
      btn.disabled = false;
    };
    body.append(el("div", { class: "cg-card" },
      el("h4", {}, "🤖 Describe a game, get a game"),
      idea,
      el("div", { class: "cg-row" }, el("div", { class: "cg-field" }, el("label", {}, "Provider"), provider), el("div", { class: "cg-field" }, el("label", {}, "Model"), model)),
      el("div", { class: "cg-row" }, el("div", { class: "cg-field" }, el("label", {}, "Genre"), genre), el("div", { class: "cg-field" }, el("label", {}, "Effort"), effort)),
      el("label", { class: "cg-check" }, code, "Let the AI write a custom mechanic (JavaScript mod)"),
      el("label", { class: "cg-check" }, revise, "Revise the game currently in the Play tab"),
      el("div", { class: "cg-row" },
        el("button", { class: "cg-btn primary", onclick: (e) => run(e.target) }, "✨ Design & build"),
        el("button", { class: "cg-btn", title: "Load the AI workflow so you can see and edit every step", onclick: () => loadTemplate("06_ai_designer_claude", () => {
          const n = app.graph._nodes.find((x) => x.comfyClass === "ComfyGameAIDesigner");
          if (n) for (const w of n.widgets || []) { if (w.name === "idea") w.value = idea.value || w.value; if (w.name === "provider") w.value = provider.value; if (w.name === "model") w.value = model.value; }
        }) }, "Open as node graph")),
      status, dots));
    // paste-from-any-chatbot path
    const pasted = el("textarea", { class: "cg-area", placeholder: "Paste a design JSON from any chatbot here" });
    const pstatus = el("div", { class: "cg-busy" });
    body.append(el("div", { class: "cg-card" },
      el("h4", {}, "💬 Use any chatbot (claude.ai, etc.)"),
      el("p", {}, "Copy the designer prompt, paste it into a chat with your idea, then paste the JSON reply below."),
      el("div", { class: "cg-row" },
        el("button", { class: "cg-btn", onclick: async () => {
          const t = await (await api.fetchApi("/comfygame/system_prompt")).text();
          try { await navigator.clipboard.writeText(t + "\n\nGame idea: "); toast("success", "Prompt copied", "Paste it into your chatbot, add your idea."); }
          catch (e) { pasted.value = t; toast("info", "Prompt placed in the box", "Copy it from there."); }
        } }, "📋 Copy designer prompt"),
        el("button", { class: "cg-btn primary", onclick: async () => {
          try { const d = JSON.parse(pasted.value.slice(pasted.value.indexOf("{"), pasted.value.lastIndexOf("}") + 1)); await quickBuild(d, pstatus); }
          catch (err) { pstatus.replaceChildren(); toast("error", "Could not build", String(err.message || err)); }
        } }, "Build from JSON")),
      pasted, pstatus));
    // settings
    const key = el("input", { class: "cg-input", type: "password", placeholder: "sk-ant-... (stored in ComfyUI/user)" });
    const base = el("input", { class: "cg-input", placeholder: "http://127.0.0.1:11434/v1" });
    const omodel = el("input", { class: "cg-input", placeholder: "e.g. qwen3:8b" });
    body.append(el("div", { class: "cg-card" }, el("h4", {}, "⚙️ AI settings"),
      el("div", { class: "cg-field" }, el("label", {}, "Anthropic API key (only for the 'Claude API key' provider)"), key),
      el("div", { class: "cg-row" }, el("div", { class: "cg-field" }, el("label", {}, "Local server URL"), base), el("div", { class: "cg-field" }, el("label", {}, "Local model"), omodel)),
      el("div", { class: "cg-row" }, el("button", { class: "cg-btn", onclick: async () => {
        const payload = { openai_base_url: base.value, openai_model: omodel.value };
        if (key.value) payload.anthropic_api_key = key.value;
        await api.fetchApi("/comfygame/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        key.value = ""; toast("success", "Saved"); refreshStatus();
      } }, "Save"))));
    const refreshStatus = async () => {
      try {
        const s = await (await api.fetchApi("/comfygame/providers")).json();
        base.placeholder = s.openai_compat.base_url; omodel.value = omodel.value || s.openai_compat.model || "";
        const dot = (ok) => el("span", { class: "cg-dot " + (ok ? "ok" : "bad") });
        dots.replaceChildren(el("span", { class: "cg-row" }, dot(s.claude_code.available), "Claude Code", dot(s.anthropic_api.available), s.anthropic_api.sdk ? "API key" : "API (pip install anthropic)"));
      } catch (e) { dots.textContent = ""; }
    };
    refreshStatus();
  };

  container.append(el("div", { class: "cg-panel" },
    el("div", { class: "cg-head" }, el("span", { class: "cg-logo" }, "ComfyGame"), el("span", { class: "cg-sub" }, "make games with nodes")),
    tabRow, body));
  show(active);
  return () => listeners.delete(onCurrent);
}

// ---------------------------------------------------------------- extension
app.registerExtension({
  name: "ComfyGame.Engine",
  settings: [
    { id: "ComfyGame.AutoplayInNode", name: "Autoplay the game in the Build node after a run", type: "boolean", defaultValue: false, category: ["ComfyGame", "Player", "Autoplay"] },
    { id: "ComfyGame.OpenPanelOnBuild", name: "Show built games in the ComfyGame panel", type: "boolean", defaultValue: true, category: ["ComfyGame", "Player", "Panel"] },
  ],
  commands: [
    { id: "ComfyGame.OpenPanel", label: "ComfyGame: open panel", icon: "mdi mdi-gamepad-variant-outline", function: () => { try { app.extensionManager.command.execute("Workspace.ToggleSidebarTab.comfygame"); } catch (e) { /* older frontend */ } } },
  ],
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData.name || !nodeData.name.startsWith("ComfyGame")) return;
    categoryOf[nodeData.name] = nodeData.category;
    if (nodeData.name !== "ComfyGameBuild") return;
    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated ? onCreated.apply(this, arguments) : undefined;
      injectCss();
      this.cgPlayer = makePlayer();
      const w = this.addDOMWidget("game_player", "cg_player", this.cgPlayer.el, { serialize: false, hideOnZoom: false, getMinHeight: () => 260 });
      w.serialize = false; // keep widgets_values aligned with the real inputs when the workflow is reloaded
      this.setSize([Math.max(this.size[0], 440), Math.max(this.size[1], 520)]);
      return r;
    };
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      const r = onExecuted ? onExecuted.apply(this, arguments) : undefined;
      const info = output && output.comfygame && output.comfygame[0];
      if (info && this.cgPlayer) {
        const auto = app.extensionManager.setting ? app.extensionManager.setting.get("ComfyGame.AutoplayInNode") : false;
        this.cgPlayer.load(info, !!auto);
        current = info;
        for (const fn of listeners) fn(info);
      }
      return r;
    };
  },
  nodeCreated(node) {
    const cat = categoryOf[node.comfyClass];
    if (!cat) return;
    const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.ComfyGame;
    node.color = c[0];
    node.bgcolor = c[1];
  },
  async setup() {
    injectCss();
    try {
      const colors = (window.LGraphCanvas && window.LGraphCanvas.link_type_colors) || (app.canvas && app.canvas.default_connection_color_byType);
      if (colors) Object.assign(colors, TYPE_COLORS);
    } catch (e) { /* cosmetic only */ }
    try {
      app.extensionManager.registerSidebarTab({
        id: "comfygame", icon: "mdi mdi-gamepad-variant-outline", title: "Games", tooltip: "ComfyGame: play, library, templates, AI studio", type: "custom",
        render: (container) => renderPanel(container),
      });
    } catch (e) { console.warn("[ComfyGame] sidebar unavailable", e); }
  },
});
