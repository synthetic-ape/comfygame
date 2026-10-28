# Making games with ComfyGame

ComfyGame turns ComfyUI into a game engine: nodes describe a game, **Build & Play Game** assembles it, and the result plays inside the node and exports as one HTML file. This guide covers the fastest path, every building block, creative recipes, AI mode, automation and fixes.

## 1. How it works

```
 Game Setup ──┐
 Palette ─────┤                     ┌─ plays inside the node
 Sprites ─────┤                     ├─ ComfyGame panel: Play / Library
 Levels ──────┼──► Build & Play ────┤
 Enemies ─────┤     (fills in       ├─ output/comfygame/<name>/index.html
 Music, SFX ──┤      anything       └─ itch.io zip
 Script ──────┘      missing)
```

- **Game Setup** starts a game: title, genre, theme, difficulty, seed, story.
- Every other node adds or replaces one part. Anything you leave out is generated procedurally from the seed, in the game's palette.
- **Build & Play Game** completes the game, embeds the JavaScript runtime and all assets into one file, and shows a player in the node.
- Runs are cached like any ComfyUI graph: change the music node and only the music is redone.

Genres: **platformer** (jump, stomp, secrets, boss arena), **arena** (survive waves, level up, boss), **dungeon** (torch-lit floors, keys, chests, boss floor), **shmup** (space shooter with bullet-pattern bosses).

## 2. Install

1. `cd ComfyUI/custom_nodes` then `git clone <repo-url> comfygame` (or ComfyUI-Manager → *Install via Git URL*).
2. Restart ComfyUI. No pip installs are needed.
3. A gamepad icon labelled **ComfyGame** appears in the left sidebar.

Optional extras:
- **AI art**: Z-Image Turbo + BiRefNet (ComfyUI offers the downloads when you open template 05). Any image model works.
- **Claude with your subscription**: install [Claude Code](https://claude.com/claude-code) and run `claude` once to log in.
- **Claude with an API key**: `<ComfyUI python> -m pip install anthropic`, then paste the key in the panel's AI settings.
- **Local LLM**: Ollama or LM Studio, or a text model in ComfyUI's **Load CLIP** (Qwen3-4B ships with Z-Image Turbo).

## 3. Your first game in two minutes

1. Sidebar → **ComfyGame** → **Create** → **Quick platformer**.
2. Press **Run** (Ctrl+Enter). The build takes about 3 seconds.
3. Click the game in the **Build & Play Game** node. Arrows/WASD move, Space jumps, Esc pauses.
4. Change **seed** and run again for a new world. Try **genre: dungeon** or **theme: candy**.
5. Press **⤓ HTML** to save the game, or **⤓ itch.io** for an upload-ready zip.

No graph at all: **Create → Roll & build** makes a random game, or type an idea in **AI Studio**.

## 4. The building blocks

**Core**
- *Game Setup*: title, genre, theme (sets backgrounds, tiles, palette and level names), difficulty, seed, lives, tagline, intro story, ending, CRT filter, resolution.
- *Build & Play Game*: optional inputs for player, enemies, boss, levels, tileset, background, music, sfx, script.

**Art**
- *Palette* (16 presets or your own hex list), *Palette From Image* (steal the colours of any picture).
- *Pixel Sprite*: animated procedural heroes (knight, mage, ninja, robot, fox, astronaut, ranger, princess), creatures (slime, bat, ghost, eyeball, spider, mushroom, beetle, plant, imp, drone, skeleton, mutant), ships and items. The seed changes colours; *mutant* and *enemy_ship* make a new design per seed.
- *Pixel Boss*: a big crowned version of any creature, or a warship.
- *Sprite From Image*: any image → sprite. Cuts out the background (or uses a mask), crops, shrinks with palette-aware pooling that keeps outlines, optional palette snap and outline. An image **batch** becomes animation frames; a single image is animated procedurally (bob, squash, tilt).
- *Tileset* (13 styles) and *Tileset From Texture* (any texture becomes the ground material, painted seamlessly across the world).
- *Parallax Background* (14 themes, layered and seamless) and *Background From Image* (optionally with procedural hills in front).

**World**
- *Platformer Levels*: count, length, hazards on/off, boss at the end, level names. Every generated level is checked against the jump physics.
- *Dungeon Floors*, *Arena Stages*, *Shmup Stages*: count, size or duration, density, boss.
- *Level From Text*: draw levels with characters. Chain level nodes to mix handmade and generated levels.

**Actors**
- *Player*: name, look or sprite, HP, speed, jump, double jump, dash, wall jump, shoot, weapon.
- *Enemy*: chain one node per enemy type; pick a behaviour (walker, hopper, flyer, shooter, charger, spiky, chaser, runner, orbiter, tank, splitter, exploder, turret, weaver, kamikaze, spinner).
- *Boss*: name, look or sprite, HP. Each genre gives it attack patterns and an enraged phase.

**Audio**
- *Chiptune Music*: mood (heroic, adventure, happy, chill, spooky, mysterious, intense, epic, retro, boss), instruments (nes, gameboy, soft, synth), tempo, length; plays in the node. Slot `boss` gives the boss its own theme.
- *Music From Audio*: use any ComfyUI audio (a music model, Load Audio) as a looping track.
- *Sound Effects* (retro, soft, crunchy, space) and *Sound From Audio* (replace one sound, e.g. your own voice for `jump`).

**Design and AI**
- *Game Idea Dice*: a complete, coherent design per seed. No AI.
- *AI Game Designer*: an idea in, a full design out, plus image prompts for each asset.
- *Game From Design JSON*: paste a design from anywhere.
- *Game Art Prompt*: prompts tuned for clean, cut-out-friendly assets.
- *Apply Art To Game*: attach sprites/tiles/background to a designed game.
- *Game Script* / *AI Script*: JavaScript gameplay mods.

## 5. Creative recipes

1. **One prompt, whole cast.** Template 05: Idea Dice (or the AI designer) writes prompts, Z-Image Turbo draws hero, enemies, boss, background and ground. Change the dice seed for a new game; change a KSampler seed to redraw just that character.
2. **Your drawing as the hero.** *Load Image* (a doodle on white paper) → *Sprite From Image* (`background: auto key`) → *Player*.
3. **Your pet as the hero.** Photo → an image-edit model ("turn this cat into a cute pixel-art character, side view, plain white background") → *Remove Background* → *Sprite From Image*.
4. **Steal a palette.** *Palette From Image* on a painting, a film still or a sunset → *Game Setup*. Every procedural asset follows it.
5. **Animated sprites.** Generate four images with the same prompt and seeds that differ a little, or img2img the same pose at low denoise, then batch them into *Sprite From Image*.
6. **A real soundtrack.** Any ComfyUI music model → *Music From Audio* (`slot: main`), a darker prompt → second node with `slot: boss`.
7. **Voice-acted sound effects.** Record "boing!" → *Load Audio* → *Sound From Audio* (`sound: jump`).
8. **Write your name in a level.** *Level From Text* with `#` letters; chain *Platformer Levels* after it for the rest of the game.
9. **Genre remix.** Keep the whole graph and switch *Game Setup → genre*: the same cast becomes a survivor, a crawler or a shooter (behaviours translate automatically).
10. **Seed surfing.** Idea Dice with *control after generate: randomize*, set the queue count to 10, run, then browse the **Library** and keep your favourite.
11. **Revise with Claude.** AI Studio → tick *Revise the game currently in the Play tab* → "make it harder, add a dash, and give the boss a pirate theme".
12. **Signature mechanic.** *AI Script*: "every 20 seconds gravity flips for 5 seconds", "enemies leave slippery ice trails", "a combo meter that slows time at x10".
13. **Game jam in an hour.** AI designer → AI art → play → tweak one node at a time → export to itch.io.

## 6. AI mode

Pick a provider in the *AI Game Designer* node or the AI Studio tab:

| Provider | Cost / privacy | Speed |
|---|---|---|
| `claude_code` | your Claude subscription, via the Claude Code CLI | ~10-30 s |
| `anthropic_api` | API key billing | ~10-30 s |
| `openai_compat` | Ollama / LM Studio on your machine | depends on model |
| `comfy_local` | a text model loaded inside ComfyUI, fully offline | ~80 s with Qwen3-4B on 16 GB |
| any chatbot | copy the prompt, paste the JSON back | manual |

Tips:
- Be specific about tone and mechanics: "a cozy farming platformer where the hero is a mole who digs through soft dirt" beats "a farm game".
- Name the genre if you care; otherwise the model picks the best fit.
- *custom_mechanic_code* asks for one signature mechanic in JavaScript. Bigger models (Claude) write better code; small local models should leave it off.
- Small local models sometimes write odd values; ComfyGame maps them to the nearest supported option and retries once if the JSON is broken.
- ComfyGame only contacts a provider when you run an AI node or press an AI Studio button.

## 7. Automation

- Any ComfyGame graph runs through ComfyUI's `/prompt` API (save it with *Export (API)*).
- `POST /api/comfygame/build {"design": {...}}` builds directly from a design; `GET /api/comfygame/dice?seed=N` rolls one; `POST /api/comfygame/design {"idea": "...", "provider": "claude_code"}` asks an LLM.
- `GET /api/comfygame/games`, `/play/{id}`, `/download/{id}` (`?zip=1`) manage the library.
- `python tools/build_game.py --genre arena --seed 3` builds without ComfyUI.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| No ComfyGame tab | Restart ComfyUI and hard-refresh the page (Ctrl+F5); the folder must be in `custom_nodes`. |
| Keys don't move the player | Click inside the game first so it has keyboard focus. |
| No sound | Browsers start audio after the first click or key press; press M if muted. |
| "Claude Code CLI not found" | Install Claude Code and run `claude` once to log in; then retry. |
| "anthropic package not installed" | Run pip with ComfyUI's own Python (`.venv/Scripts/python -m pip install anthropic` in Desktop installs). |
| Local LLM gives a strange game | Try another seed or a bigger model; the design JSON is shown in the node so you can fix it by hand with *Game From Design JSON*. |
| AI template shows missing models | Accept ComfyUI's download dialog, or swap in an image model you have. |
| AI sprite has leftover background | Connect the *Remove Background* mask and set `background: mask`. |
| Sprite too small or big | *Sprite From Image → height* (heroes 24-32, enemies 20-28, bosses 40-56; tiles are 16). |
| Want the same game again | Use the same seed with *control after generate: fixed*. |
