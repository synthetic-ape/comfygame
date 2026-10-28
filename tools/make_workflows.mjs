// Builds example_workflows/*.json inside the real ComfyUI frontend (so the JSON is exactly what ComfyUI saves),
// and saves a screenshot of each graph to docs/img/. Needs ComfyUI running with ComfyGame installed.
//   node tools/make_workflows.mjs [http://127.0.0.1:8188] [only-this-name]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./playtest.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = process.argv[2] || "http://127.0.0.1:8188";
const ONLY = process.argv[3];

const ZIMAGE = {
  unet: { name: "z_image_turbo_bf16.safetensors", url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors", directory: "diffusion_models" },
  clip: { name: "qwen_3_4b.safetensors", url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors", directory: "text_encoders" },
  vae: { name: "ae.safetensors", url: "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors", directory: "vae" },
  bg: { name: "birefnet.safetensors", url: "https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors", directory: "background_removal" },
};

const note = (id, pos, text, size = [420, 300]) => ({ id, type: "MarkdownNote", pos, size, text });

const WORKFLOWS = {
  "01_quick_platformer": {
    nodes: [
      note("n", [40, 40], "# Your first game\n\n1. Press **Run** (Ctrl+Enter).\n2. Click the game in **Build & Play Game** to play it.\n\nEverything you don't specify is generated: pixel art, levels, music, sound effects, boss.\n\n* Change **seed** for a new variation\n* Try another **genre** or **theme**\n* Open the **ComfyGame** sidebar tab for your library and the AI studio\n\nControls: arrows/WASD, Space jump, Shift dash, Esc pause.", [440, 360]),
      { id: "setup", type: "ComfyGameSetup", pos: [40, 460], w: { title: "Moss Knight", genre: "platformer", theme: "forest", seed: 3, control_after_generate: "fixed", tagline: "A tiny knight. A very big forest." } },
      { id: "build", type: "ComfyGameBuild", pos: [540, 40], size: [620, 640] },
    ],
    links: [["setup", "game", "build", "game"]],
  },

  "02_custom_platformer": {
    nodes: [
      note("n", [40, -380], "# Every part is a node\n\nThis graph builds a platformer from parts. Swap any of them: connect **Sprite From Image** instead of a procedural sprite, use **Music From Audio** with any audio model, chain more **Enemy** nodes, add your own **Level From Text**.\n\nUnconnected palettes: procedural art is recoloured to the game palette automatically.", [560, 300]),
      { id: "pal", type: "ComfyGamePalette", pos: [40, 40], w: { preset: "sweetie16" } },
      { id: "setup", type: "ComfyGameSetup", pos: [420, 40], w: { title: "Sky Fox", genre: "platformer", theme: "mountains", seed: 21, control_after_generate: "fixed", tagline: "Leap from peak to peak.", intro_story: "The sky crystals were stolen from the mountain shrine. Rusty the fox grabs a scarf and starts climbing.", ending_text: "The crystals glow again. Rusty naps on the highest peak, very proud." } },
      { id: "tiles", type: "ComfyGameTileset", pos: [860, 40], w: { style: "stone", seed: 2 } },
      { id: "bg", type: "ComfyGameBackground", pos: [1220, 40], w: { theme: "mountains", seed: 4, control_after_generate: "fixed" } },
      { id: "hero_spr", type: "ComfyGamePixelSprite", pos: [40, 620], w: { kind: "fox", seed: 0, control_after_generate: "fixed" } },
      { id: "player", type: "ComfyGamePlayer", pos: [420, 620], w: { name: "Rusty", hp: 4, dash: true, wall_jump: true, double_jump: true } },
      { id: "boss_spr", type: "ComfyGamePixelBoss", pos: [860, 620], w: { kind: "beetle", seed: 3, control_after_generate: "fixed" } },
      { id: "boss", type: "ComfyGameBoss", pos: [1220, 620], w: { name: "Stone Beetle", hp: 24 } },
      { id: "e1s", type: "ComfyGamePixelSprite", pos: [40, 1100], w: { kind: "slime", seed: 0, control_after_generate: "fixed" } },
      { id: "e1", type: "ComfyGameEnemy", pos: [420, 1100], w: { name: "Pebble Slime", behavior: "walker" } },
      { id: "e2s", type: "ComfyGamePixelSprite", pos: [40, 1460], w: { kind: "bat", seed: 0, control_after_generate: "fixed" } },
      { id: "e2", type: "ComfyGameEnemy", pos: [420, 1460], w: { name: "Cliff Bat", behavior: "flyer", speed: 1.1 } },
      { id: "e3s", type: "ComfyGamePixelSprite", pos: [860, 1100], w: { kind: "mushroom", seed: 0, control_after_generate: "fixed" } },
      { id: "e3", type: "ComfyGameEnemy", pos: [1220, 1100], w: { name: "Hop Cap", behavior: "hopper", hp: 2 } },
      { id: "e4s", type: "ComfyGamePixelSprite", pos: [860, 1460], w: { kind: "plant", seed: 0, control_after_generate: "fixed" } },
      { id: "e4", type: "ComfyGameEnemy", pos: [1220, 1460], w: { name: "Seed Spitter", behavior: "shooter", hp: 2, score: 250 } },
      { id: "levels", type: "ComfyGamePlatformerLevels", pos: [1620, 1100], w: { count: 4, length: 6, names: "Foothills, Windy Ledge, Crystal Caves, Summit Shrine" } },
      { id: "m1", type: "ComfyGameChipMusic", pos: [1620, 40], w: { mood: "adventure", instruments: "nes", seed: 5, control_after_generate: "fixed", slot: "main" } },
      { id: "m2", type: "ComfyGameChipMusic", pos: [1620, 520], w: { mood: "boss", instruments: "nes", seed: 2, control_after_generate: "fixed", slot: "boss", bars: 16 } },
      { id: "sfx", type: "ComfyGameSoundEffects", pos: [2000, 520], w: { style: "retro", seed: 0, control_after_generate: "fixed" } },
      { id: "script", type: "ComfyGameScript", pos: [2000, 1100], size: [440, 420] },
      { id: "build", type: "ComfyGameBuild", pos: [2520, 40], size: [640, 700] },
    ],
    links: [
      ["pal", "palette", "setup", "palette"], ["setup", "game", "build", "game"], ["tiles", "tileset", "build", "tileset"], ["bg", "background", "build", "background"],
      ["hero_spr", "sprite", "player", "sprite"], ["player", "player", "build", "player"], ["boss_spr", "sprite", "boss", "sprite"], ["boss", "boss", "build", "boss"],
      ["e1s", "sprite", "e1", "sprite"], ["e2s", "sprite", "e2", "sprite"], ["e3s", "sprite", "e3", "sprite"], ["e4s", "sprite", "e4", "sprite"],
      ["e1", "roster", "e2", "roster"], ["e2", "roster", "e3", "roster"], ["e3", "roster", "e4", "roster"], ["e4", "roster", "build", "enemies"],
      ["levels", "levels", "build", "levels"], ["m1", "music", "m2", "music"], ["m2", "music", "build", "music"], ["sfx", "sfx", "build", "sfx"], ["script", "script", "build", "script"],
    ],
    groups: [
      { title: "Look", color: "#5b3170", nodes: ["pal", "setup", "tiles", "bg"] },
      { title: "Hero & boss", color: "#6a3d1e", nodes: ["hero_spr", "player", "boss_spr", "boss"] },
      { title: "Enemies (chain more!)", color: "#6a3d1e", nodes: ["e1s", "e1", "e2s", "e2", "e3s", "e3", "e4s", "e4"] },
      { title: "Sound", color: "#26457a", nodes: ["m1", "m2", "sfx"] },
      { title: "World & code", color: "#2f5a2c", nodes: ["levels", "script"] },
    ],
  },

  "03_all_genres": {
    nodes: [
      { id: "s1", type: "ComfyGameSetup", pos: [40, 40], w: { title: "Moss Knight", genre: "platformer", theme: "forest", seed: 3, control_after_generate: "fixed" } },
      { id: "b1", type: "ComfyGameBuild", pos: [440, 40], size: [560, 560] },
      { id: "s2", type: "ComfyGameSetup", pos: [1060, 40], w: { title: "Ember Arena", genre: "arena", theme: "volcano", seed: 8, control_after_generate: "fixed" } },
      { id: "b2", type: "ComfyGameBuild", pos: [1460, 40], size: [560, 560] },
      { id: "s3", type: "ComfyGameSetup", pos: [40, 700], w: { title: "Crypt Crawler", genre: "dungeon", theme: "castle", seed: 5, control_after_generate: "fixed" } },
      { id: "b3", type: "ComfyGameBuild", pos: [440, 700], size: [560, 560] },
      { id: "s4", type: "ComfyGameSetup", pos: [1060, 700], w: { title: "Nova Strike", genre: "shmup", theme: "space", seed: 2, control_after_generate: "fixed" } },
      { id: "b4", type: "ComfyGameBuild", pos: [1460, 700], size: [560, 560] },
    ],
    links: [["s1", "game", "b1", "game"], ["s2", "game", "b2", "game"], ["s3", "game", "b3", "game"], ["s4", "game", "b4", "game"]],
    groups: [
      { title: "Platformer", color: "#2f5a2c", nodes: ["s1", "b1"] }, { title: "Arena survivor", color: "#6a3d1e", nodes: ["s2", "b2"] },
      { title: "Dungeon crawler", color: "#5b3170", nodes: ["s3", "b3"] }, { title: "Space shooter", color: "#26457a", nodes: ["s4", "b4"] },
    ],
  },

  "04_idea_dice": {
    nodes: [
      note("n", [40, 40], "# Idea Dice\n\nEvery **Run** rolls a new, coherent game: genre, theme, title, hero, enemies with behaviours, boss, story, music style.\n\nNo AI and no models needed. Set *control after generate* to **fixed** to keep a game you like.", [440, 260]),
      { id: "dice", type: "ComfyGameIdeaDice", pos: [40, 360], w: { seed: 42, control_after_generate: "randomize", genre: "any", theme: "any" } },
      { id: "info", type: "ComfyGameInfo", pos: [40, 820], size: [440, 240] },
      { id: "build", type: "ComfyGameBuild", pos: [540, 40], size: [620, 640] },
    ],
    links: [["dice", "game", "build", "game"], ["dice", "game", "info", "game"]],
  },

  "05_ai_art_zimage": aiArt("dice"),
  "06_ai_designer_claude": aiArt("llm"),

  "07_ascii_level": {
    nodes: [
      note("n", [40, 40], "# Draw your own level\n\nEdit the text in **Level From Text**: `#` ground, `=` platform, `^` spikes, `o` coin, `*` gem, `?` bonus block, `S` spring, `M` moving platform, `a`-`h` enemies, `P` start, `G` goal.\n\nIt becomes level 1, followed by two generated levels with a boss.", [460, 280]),
      { id: "setup", type: "ComfyGameSetup", pos: [40, 380], w: { title: "Handmade Hero", genre: "platformer", theme: "candy", seed: 9, control_after_generate: "fixed" } },
      { id: "ascii", type: "ComfyGameAsciiLevel", pos: [560, 40], size: [520, 420] },
      { id: "levels", type: "ComfyGamePlatformerLevels", pos: [560, 520], w: { count: 2, length: 5 } },
      { id: "build", type: "ComfyGameBuild", pos: [1140, 40], size: [620, 640] },
    ],
    links: [["setup", "game", "build", "game"], ["ascii", "levels", "levels", "levels"], ["levels", "levels", "build", "levels"]],
  },

  "08_local_llm": {
    nodes: [
      note("n", [40, 40], "# Offline AI designer\n\nA text model runs **inside ComfyUI** (no internet, no API). Here it is Qwen3-4B, the text encoder that ships with Z-Image Turbo; any text-generation model that **Load CLIP** supports works (pick the matching type).\n\nTakes ~1-2 minutes on a 16 GB GPU. For Claude, use template 06 or the AI Studio tab.", [460, 300]),
      { id: "clip", type: "CLIPLoader", pos: [40, 400], w: { clip_name: "qwen_3_4b.safetensors", type: "lumina2" }, models: [ZIMAGE.clip] },
      { id: "ai", type: "ComfyGameAIDesigner", pos: [40, 560], size: [460, 420], w: { idea: "A penguin chef slides across icy kitchens fighting angry vegetables", provider: "comfy_local", effort: "low" } },
      { id: "info", type: "ComfyGameInfo", pos: [560, 760], size: [440, 240] },
      { id: "build", type: "ComfyGameBuild", pos: [560, 40], size: [620, 640] },
    ],
    links: [["clip", "CLIP", "ai", "clip"], ["ai", "game", "build", "game"], ["ai", "game", "info", "game"]],
  },
};

function aiArt(kind) {
  const nodes = [];
  const links = [];
  const groups = [];
  const designer = kind === "dice"
    ? { id: "design", type: "ComfyGameIdeaDice", pos: [440, 40], size: [400, 420], w: { seed: 11, control_after_generate: "fixed", genre: "platformer", theme: "any" } }
    : { id: "design", type: "ComfyGameAIDesigner", pos: [440, 40], size: [420, 520], w: { idea: "A tiny robot gardener defends a greenhouse from mutant bugs", provider: "claude_code", model: "sonnet", effort: "medium", genre: "platformer" } };
  nodes.push(
    note("n", [40, -420], kind === "dice"
      ? "# AI art with a fast local model\n\n**Idea Dice** designs the game and writes one image prompt per asset. **Z-Image Turbo** (8 steps, ~2 s per image on a 16 GB GPU) draws them, **Remove Background** cuts them out and **Sprite From Image** turns them into crisp pixel sprites.\n\nMissing models? ComfyUI offers to download them when you open this workflow (Z-Image Turbo ~20 GB total, BiRefNet ~0.9 GB). Any image model works: replace the sampler chain with SDXL / Flux / your favourite."
      : "# Describe a game, Claude designs it\n\n**AI Game Designer** sends your idea to Claude via your **subscription** (provider `claude_code`, needs Claude Code installed and logged in) or an API key (`anthropic_api`). Claude writes the full design and one image prompt per asset; Z-Image Turbo draws the cast locally.\n\nTick **custom_mechanic_code** to let Claude add a signature mechanic in JavaScript.", [800, 360]),
    { id: "unet", type: "UNETLoader", pos: [40, 40], w: { unet_name: ZIMAGE.unet.name }, models: [ZIMAGE.unet] },
    { id: "shift", type: "ModelSamplingAuraFlow", pos: [40, 220], w: { shift: 3 } },
    { id: "clip", type: "CLIPLoader", pos: [40, 380], w: { clip_name: ZIMAGE.clip.name, type: "lumina2" }, models: [ZIMAGE.clip] },
    { id: "vae", type: "VAELoader", pos: [40, 560], w: { vae_name: ZIMAGE.vae.name }, models: [ZIMAGE.vae] },
    { id: "rmbg", type: "LoadBackgroundRemovalModel", pos: [40, 700], w: { bg_removal_name: ZIMAGE.bg.name }, models: [ZIMAGE.bg] },
    designer,
    { id: "neg", type: "CLIPTextEncode", pos: [40, 860], size: [360, 160], w: { text: "" }, title: "Negative (unused at cfg 1)" },
    { id: "lat", type: "EmptySD3LatentImage", pos: [40, 1080], w: { width: 768, height: 768, batch_size: 1 }, title: "Sprite canvas 768x768" },
    { id: "latbg", type: "EmptySD3LatentImage", pos: [40, 1280], w: { width: 1344, height: 768, batch_size: 1 }, title: "Background canvas" },
    { id: "lattex", type: "EmptySD3LatentImage", pos: [40, 1480], w: { width: 512, height: 512, batch_size: 1 }, title: "Texture canvas" },
  );
  links.push(["unet", "MODEL", "shift", "model"], ["clip", "CLIP", "neg", "clip"]);
  const slots = [
    ["player_prompt", "Hero", "player", 30], ["enemy1_prompt", "Enemy 1", "enemy_1", 24], ["enemy2_prompt", "Enemy 2", "enemy_2", 24],
    ["enemy3_prompt", "Enemy 3", "enemy_3", 24], ["boss_prompt", "Boss", "boss", 52], ["background_prompt", "Background", "background", 0], ["tiles_prompt", "Ground texture", "tileset", 0],
  ];
  const X = 960, ROW = 380;
  slots.forEach(([out, title, target, h], i) => {
    const y = 40 + i * ROW, p = `s${i}`;
    nodes.push(
      { id: `${p}t`, type: "CLIPTextEncode", pos: [X, y], size: [380, 200], title: `${title} prompt` },
      { id: `${p}k`, type: "KSampler", pos: [X + 420, y], w: { seed: 100 + i, control_after_generate: "fixed", steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple" } },
      { id: `${p}d`, type: "VAEDecode", pos: [X + 780, y] },
    );
    links.push(["clip", "CLIP", `${p}t`, "clip"], ["design", out, `${p}t`, "text"], ["shift", "MODEL", `${p}k`, "model"], [`${p}t`, "CONDITIONING", `${p}k`, "positive"],
      ["neg", "CONDITIONING", `${p}k`, "negative"], [target === "background" ? "latbg" : target === "tileset" ? "lattex" : "lat", "LATENT", `${p}k`, "latent_image"],
      [`${p}k`, "LATENT", `${p}d`, "samples"], ["vae", "VAE", `${p}d`, "vae"]);
    const members = [`${p}t`, `${p}k`, `${p}d`];
    if (target === "background") {
      nodes.push({ id: `${p}x`, type: "ComfyGameBackgroundFromImage", pos: [X + 1060, y], w: { foreground: "none", pixelate: true, max_colors: 32, darken: 0.12 } });
      links.push([`${p}d`, "IMAGE", `${p}x`, "image"], [`${p}x`, "background", "apply", "background"]);
      members.push(`${p}x`);
    } else if (target === "tileset") {
      nodes.push({ id: `${p}x`, type: "ComfyGameTilesetFromImage", pos: [X + 1060, y], w: { style: "grass", max_colors: 8 } });
      links.push([`${p}d`, "IMAGE", `${p}x`, "texture"], [`${p}x`, "tileset", "apply", "tileset"]);
      members.push(`${p}x`);
    } else {
      nodes.push({ id: `${p}r`, type: "RemoveBackground", pos: [X + 1060, y] },
        { id: `${p}x`, type: "ComfyGameSpriteFromImage", pos: [X + 1340, y], w: { height: h, background: "mask", max_colors: 16, outline: "auto" } });
      links.push(["rmbg", "bg_model", `${p}r`, "bg_removal_model"], [`${p}d`, "IMAGE", `${p}r`, "image"], [`${p}d`, "IMAGE", `${p}x`, "image"], [`${p}r`, "mask", `${p}x`, "mask"],
        [`${p}x`, "sprite", "apply", target]);
      members.push(`${p}r`, `${p}x`);
    }
    groups.push({ title, color: target === "background" || target === "tileset" ? "#2f5a2c" : "#5b3170", nodes: members });
  });
  nodes.push({ id: "apply", type: "ComfyGameApplySprites", pos: [X + 1780, 40] }, { id: "build", type: "ComfyGameBuild", pos: [X + 2120, 40], size: [680, 700] });
  links.push(["design", "game", "apply", "game"], ["apply", "game", "build", "game"]);
  groups.unshift({ title: "Models (Z-Image Turbo + BiRefNet)", color: "#444444", nodes: ["unet", "shift", "clip", "vae", "rmbg", "neg", "lat", "latbg", "lattex"] });
  return { nodes, links, groups };
}

// Runs in the page: builds the graph, frames it and returns the serialized workflow.
const PAGE_BUILD = async (spec) => {
  const app = window.comfyAPI.app.app;
  const LG = window.LiteGraph;
  app.graph.clear();
  const ids = {};
  for (const n of spec.nodes) {
    const node = LG.createNode(n.type);
    if (!node) throw new Error("unknown node type " + n.type);
    app.graph.add(node);
    node.pos = [n.pos[0], n.pos[1]];
    if (n.title) node.title = n.title;
    if (n.text != null) node.widgets[0].value = n.text;
    for (const [k, v] of Object.entries(n.w || {})) {
      const w = (node.widgets || []).find((x) => x.name === k);
      if (!w) throw new Error(`no widget '${k}' on ${n.type}: ` + (node.widgets || []).map((x) => x.name).join(","));
      w.value = v;
    }
    if (n.models) node.properties = Object.assign(node.properties || {}, { models: n.models });
    const cs = node.computeSize();
    node.setSize([Math.max(n.size ? n.size[0] : 0, cs[0], 300), Math.max(n.size ? n.size[1] : 0, cs[1])]);
    ids[n.id] = node;
  }
  for (const [a, out, b, inp] of spec.links) {
    const A = ids[a], B = ids[b];
    if (!A || !B) throw new Error(`link to unknown node ${a} -> ${b}`);
    const oi = A.findOutputSlot(out), ii = B.findInputSlot(inp);
    if (oi < 0) throw new Error(`no output '${out}' on ${A.type}: ` + A.outputs.map((o) => o.name).join(","));
    if (ii < 0) throw new Error(`no input '${inp}' on ${B.type}: ` + B.inputs.map((o) => o.name).join(","));
    A.connect(oi, B, ii);
  }
  for (const g of spec.groups || []) {
    const ms = g.nodes.map((id) => ids[id]);
    const x0 = Math.min(...ms.map((m) => m.pos[0])) - 24, y0 = Math.min(...ms.map((m) => m.pos[1])) - 80;
    const x1 = Math.max(...ms.map((m) => m.pos[0] + m.size[0])) + 24, y1 = Math.max(...ms.map((m) => m.pos[1] + m.size[1])) + 24;
    const group = new LG.LGraphGroup(g.title);
    group.pos = [x0, y0];
    group.size = [x1 - x0, y1 - y0];
    group.color = g.color;
    app.graph.add(group);
  }
  // frame everything
  const all = Object.values(ids);
  const bx0 = Math.min(...all.map((m) => m.pos[0])) - 60, by0 = Math.min(...all.map((m) => m.pos[1])) - 120;
  const bx1 = Math.max(...all.map((m) => m.pos[0] + m.size[0])) + 60, by1 = Math.max(...all.map((m) => m.pos[1] + m.size[1])) + 60;
  const cw = app.canvas.canvas.width / (window.devicePixelRatio || 1), ch = app.canvas.canvas.height / (window.devicePixelRatio || 1);
  const s = Math.min(cw / (bx1 - bx0), ch / (by1 - by0), 1);
  app.canvas.ds.scale = s;
  app.canvas.ds.offset = [-bx0 + (cw / s - (bx1 - bx0)) / 2, -by0 + (ch / s - (by1 - by0)) / 2];
  app.graph.setDirtyCanvas(true, true);
  return app.graph.serialize();
};

const b = await launch({ size: "1800x1000" });
let failed = 0;
try {
  await b.goto(BASE);
  await new Promise((r) => setTimeout(r, 9000));
  fs.mkdirSync(path.join(ROOT, "example_workflows"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "docs", "img"), { recursive: true });
  for (const [name, spec] of Object.entries(WORKFLOWS)) {
    if (ONLY && name !== ONLY) continue;
    try {
      const wf = await b.eval(`(${PAGE_BUILD.toString()})(${JSON.stringify(spec)})`);
      fs.writeFileSync(path.join(ROOT, "example_workflows", name + ".json"), JSON.stringify(wf, null, 1));
      await new Promise((r) => setTimeout(r, 800));
      await b.shot(path.join(ROOT, "docs", "img", name + ".png"));
      console.log("ok", name, wf.nodes.length, "nodes");
    } catch (e) {
      failed++;
      console.log("FAIL", name, e.message);
    }
  }
} finally {
  await b.close();
}
process.exit(failed ? 1 : 0);
