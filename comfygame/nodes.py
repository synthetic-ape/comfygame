"""ComfyUI nodes (V3 API). Every node is a small step of the game; `Build & Play Game` assembles and exports it."""
import json
import os
import random

import numpy as np
import torch
from comfy_api.latest import io, ui

import folder_paths

from . import backgrounds, builder, design, ideas, palettes, sprites, tiles
from . import game as G
from . import pixel as px
from .audio import music as music_mod
from .audio import sfx as sfx_mod
from .audio import synth
from .levels import arena as lv_arena
from .levels import common as lv_common
from .levels import dungeon as lv_dungeon
from .levels import platformer as lv_platformer
from .levels import shmup as lv_shmup
from .llm import providers

GAME = io.Custom("CG_GAME")
SPRITE = io.Custom("CG_SPRITE")
ACTOR = io.Custom("CG_ACTOR")
ROSTER = io.Custom("CG_ROSTER")
LEVELS = io.Custom("CG_LEVELS")
TILESET = io.Custom("CG_TILESET")
BACKDROP = io.Custom("CG_BACKDROP")
MUSIC = io.Custom("CG_MUSIC")
SFX = io.Custom("CG_SFX")
PALETTE = io.Custom("CG_PALETTE")

CAT = "ComfyGame"
SEED_MAX = 0x7FFFFFFF
HERO_LOOKS = sprites.HERO_KINDS + sprites.SHIP_KINDS
CREATURE_LOOKS = sprites.CREATURE_KINDS + ["enemy_ship"]
ITEM_KINDS = ["coin", "gem", "heart", "potion", "flag"]
SAMPLE_LEVEL = """........................................
........................................
.........................o.o.o..........
........................=======.....*...
.........?#?#?..........................
.................................ooo....
.......................b.........===..G.
..P..........a................c......###
#############..#####^^####..############
#############..#############..##########"""
SAMPLE_SCRIPT = """// Combo counter: chain kills quickly for bonus points.
let combo = 0, timer = 0;
return {
  onEnemyKilled(e) {
    combo++; timer = 2;
    if (combo > 1) api.float("COMBO x" + combo, e.x, e.y - 8, api.theme.gold);
    api.addScore(combo * 25);
  },
  onUpdate(dt) { timer -= dt; if (timer <= 0) combo = 0; },
  draw() {
    if (combo > 1) api.text("COMBO x" + combo, api.W / 2, 22, { align: "center", color: api.theme.gold, outline: "#000" });
  },
};"""


# ------------------------------------------------------------------ helpers
def to_image(rgba):
    """numpy RGBA uint8 (or list of them, same size) -> ComfyUI IMAGE tensor [B,H,W,3]."""
    arrs = rgba if isinstance(rgba, list) else [rgba]
    return torch.from_numpy(np.stack([a[..., :3].astype(np.float32) / 255.0 for a in arrs]))


def image_to_rgba(image, index=0, mask=None):
    img = image[min(index, image.shape[0] - 1)].detach().cpu().float().numpy()
    rgb = (np.clip(img[..., :3], 0, 1) * 255).astype(np.uint8)
    a = np.full(rgb.shape[:2], 255, dtype=np.uint8)
    if img.shape[-1] == 4:
        a = (np.clip(img[..., 3], 0, 1) * 255).astype(np.uint8)
    if mask is not None:
        m = mask[min(index, mask.shape[0] - 1)].detach().cpu().float().numpy()
        if m.shape != a.shape:
            from PIL import Image
            m = np.array(Image.fromarray((m * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]))) / 255.0
        a = (np.clip(m, 0, 1) * 255).astype(np.uint8)
    return np.dstack([rgb, a])


def preview(cls, rgba, scale=None, max_side=512):
    return ui.PreviewImage(to_image(px.preview(rgba, scale=scale, max_side=max_side)), cls=cls)


def sprite_preview_img(sprite, max_side=512):
    return px.preview(sprite["img"], max_side=max_side)


def swatch(pal, size=24):
    img = px.blank(size * len(pal), size)
    for i, c in enumerate(pal):
        img[:, i * size:(i + 1) * size] = px.rgba(c)
    return img


def opt_palette(palette):
    return palettes.resolve(palette) if palette else None


def key_out_background(rgba, tolerance=34):
    """Make the background transparent by flood-filling from the corners (works for plain AI backgrounds)."""
    from collections import deque
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3].astype(np.int32)
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for (y, x) in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        q.append((y, x))
        seen[y, x] = True
    corners = np.array([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]])
    ref = np.median(corners, axis=0)
    tol2 = tolerance * tolerance * 3
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                d = rgb[ny, nx] - ref
                if (d * d).sum() <= tol2:
                    seen[ny, nx] = True
                    q.append((ny, nx))
    out = rgba.copy()
    out[seen, 3] = 0
    return out


def build_sprite_from_images(frames_rgba, height, pixelate, colors, palette, outline, facing):
    boxes = [px.bbox(f, 40) for f in frames_rgba]
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
    out = []
    for f in frames_rgba:
        c = px.crop(f, (x0, y0, x1, y1))
        if facing == "left":
            c = px.flip_h(c)
        ch, cw = c.shape[:2]
        th = max(4, int(height))
        tw = max(2, int(round(cw * th / max(1, ch))))
        if pixelate:
            small = px.mode_downscale(c, tw, th, colors=max(colors or 0, 16) if colors else 32)
        else:
            small = px.binarize_alpha(px.resize(c, tw, th, smooth=True), 100)
        if colors and colors > 1:
            small = px.quantize(small, colors)
        if palette:
            small = px.snap(small, palette)
        canvas = px.blank(tw + 2, th + 2)
        canvas[1:1 + th, 1:1 + tw] = small
        if outline == "auto":
            outline = not px.has_outline(canvas)
        if outline:
            dark = palettes.by_luma(palette)[0] if palette else "#141018"
            canvas = px.outline(canvas, dark if palettes.luma(dark) < 0.25 else "#141018")
        out.append(canvas)
    fps = 8
    n = len(out)
    anims = {"idle": {"frames": list(range(n)), "fps": fps}, "run": {"frames": list(range(n)), "fps": fps * 1.5}, "walk": {"frames": list(range(n)), "fps": fps}, "fly": {"frames": list(range(n)), "fps": fps}}
    if n == 1:
        anims = {}  # single frame: the runtime animates it procedurally (bob, squash, tilt)
    return {"img": px.hstack(out), "fw": out[0].shape[1], "fh": out[0].shape[0], "frames": n, "anims": anims}


def output_root():
    return os.path.join(folder_paths.get_output_directory(), "comfygame")


def expand_levels(levels_obj, game):
    """CG_LEVELS = {"items": [{"gen": settings} | {"level": dict}]} -> concrete level list for this game."""
    if not levels_obj:
        return None
    out = []
    items = levels_obj.get("items", [])
    gens = [it for it in items if "gen" in it]
    for it in items:
        if "level" in it:
            out.append(it["level"])
            continue
        s = it["gen"]
        n = int(s.get("count", 3))
        seed = s.get("seed") or game["seed"]
        diff = game["difficulty"]
        boss = s.get("boss", True) and it is gens[-1]
        genre = game["genre"]
        names = s.get("names") or []
        theme = G.theme_of(game)
        for i in range(n):
            last = boss and i == n - 1
            if genre == "platformer":
                lv = lv_platformer.generate(seed, i, n, s.get("length", 6), diff, game.get("enemies"), last, s.get("features"), liquid=theme == "volcano", theme=G.THEME_TILES.get(theme, "grass"))
            elif genre == "dungeon":
                lv = lv_dungeon.generate(seed, i, n, s.get("size", 1.0), diff, game.get("enemies"), last, traps=s.get("traps", True), dark=s.get("dark", True))
            elif genre == "arena":
                lv = lv_arena.generate(seed, i, n, s.get("duration", 70), diff, game.get("enemies"), last, obstacles=s.get("obstacles", 1.0))
            else:
                lv = lv_shmup.generate(seed, i, n, s.get("length", 70), diff, game.get("enemies"), last, density=s.get("density", 1.0))
            if i < len(names) and names[i]:
                lv["name"] = names[i]
            out.append(lv)
    return out


def level_preview(genre, levels):
    pv = []
    for lv in levels[:6]:
        if genre == "platformer" and lv.get("kind") == "platformer":
            pv.append(lv_platformer.preview(lv, 2))
        elif lv.get("kind") == "dungeon":
            pv.append(lv_dungeon.preview(lv, 3))
        elif lv.get("kind") == "arena":
            pv.append(lv_arena.preview(lv, 3))
        else:
            pv.append(lv_shmup.preview(lv))
    return lv_common.stack_previews(pv) if pv else px.blank(8, 8)


def gen_preview(genre, settings, prev=None):
    fake = {"seed": settings.get("seed") or 1, "difficulty": 1.0, "genre": genre, "enemies": None, "theme": None}
    lv = expand_levels({"items": (prev or {}).get("items", []) + [{"gen": settings}]}, fake)
    return level_preview(genre, lv)


def chain_levels(prev, item):
    items = list((prev or {}).get("items", []))
    items.append(item)
    return {"items": items}


# ------------------------------------------------------------------ core
class GameSetup(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameSetup", display_name="Game Setup", category=CAT,
            description="Start a game: title, genre, theme and difficulty. Connect it to 'Build & Play Game' and you already have a complete game; everything you don't specify is generated.",
            search_aliases=["game", "new game", "comfygame", "game engine"],
            inputs=[
                io.String.Input("title", default="Moss Knight"),
                io.Combo.Input("genre", options=G.GENRES, default="platformer", tooltip="platformer: jump & stomp | arena: survive waves | dungeon: torch-lit crawler | shmup: space shooter"),
                io.Combo.Input("theme", options=["auto"] + backgrounds.THEME_NAMES, default="auto", tooltip="Sets background, tiles, palette and level names"),
                io.Combo.Input("difficulty", options=["easy", "normal", "hard", "brutal"], default="normal"),
                io.Int.Input("seed", default=1, min=0, max=SEED_MAX, control_after_generate=True, tooltip="Same seed = same game. Change it for a new variation."),
                io.Int.Input("lives", default=3, min=1, max=9),
                io.String.Input("tagline", default="", optional=True, tooltip="Shown under the title"),
                io.String.Input("intro_story", default="", multiline=True, optional=True, tooltip="Typewriter story shown before level 1"),
                io.String.Input("ending_text", default="", multiline=True, optional=True, tooltip="Shown on the victory screen"),
                io.Boolean.Input("crt_filter", default=False, optional=True),
                io.Combo.Input("resolution", options=["auto", "480x270", "384x216", "640x360", "320x180"], default="auto", optional=True, tooltip="Internal pixel resolution, scaled to fit the screen. auto: 480x270 for side-scrollers, 384x216 (closer camera) for top-down games"),
                PALETTE.Input("palette", optional=True),
            ],
            outputs=[GAME.Output(display_name="game")],
        )

    @classmethod
    def execute(cls, title, genre, theme, difficulty, seed, lives, tagline="", intro_story="", ending_text="", crt_filter=False, resolution="auto", palette=None):
        if resolution == "auto":
            resolution = "384x216" if genre in ("arena", "dungeon") else "480x270"
        res = [int(v) for v in resolution.split("x")]
        g = G.new_game(title, genre, seed, difficulty, lives, tagline, intro_story, ending_text, palette, None if theme == "auto" else theme, crt_filter, res)
        return io.NodeOutput(g)


class BuildGame(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameBuild", display_name="Build & Play Game", category=CAT, is_output_node=True,
            description="Assembles the game, generates anything missing, and exports one self-contained HTML file you can play here, share, or upload to itch.io.",
            search_aliases=["play", "export", "build", "html game"],
            inputs=[
                GAME.Input("game"),
                ACTOR.Input("player", optional=True), ROSTER.Input("enemies", optional=True), ACTOR.Input("boss", optional=True),
                LEVELS.Input("levels", optional=True), TILESET.Input("tileset", optional=True), BACKDROP.Input("background", optional=True),
                MUSIC.Input("music", optional=True), SFX.Input("sfx", optional=True),
                io.String.Input("script", optional=True, force_input=True, tooltip="JavaScript gameplay mod (from 'Game Script' / 'AI Script')"),
                io.String.Input("export_name", default="", optional=True, tooltip="Folder name under output/comfygame (empty = from title + seed)"),
                io.Boolean.Input("compress_music", default=True, optional=True, tooltip="MP3-encode music (smaller files). Off = WAV."),
            ],
            outputs=[io.String.Output(display_name="html_path"), io.Image.Output(display_name="thumbnail"), GAME.Output(display_name="game")],
        )

    @classmethod
    def execute(cls, game, player=None, enemies=None, boss=None, levels=None, tileset=None, background=None, music=None, sfx=None, script=None, export_name="", compress_music=True):
        import comfy.utils
        g = G.copy_game(game)
        if player:
            g["player"] = dict(player)
        if enemies:
            g["enemies"] = [dict(e) for e in enemies["list"]]
        if boss:
            g["boss"] = dict(boss)
        if tileset:
            g["tileset"] = tileset
        if background:
            g["backgrounds"]["main"] = background
        if music:
            g["music"].update(music)
        overrides = {}
        if sfx:
            if sfx.get("complete"):
                g["sfx"] = dict(sfx["sounds"])
            else:
                overrides = dict(sfx.get("sounds", {}))
        if script and script.strip():
            g["scripts"].append(script)
        pbar = comfy.utils.ProgressBar(5)
        if levels:
            # the roster decides where flyers go, so levels are expanded once enemies are known
            roster = g.get("enemies") or [{"behavior": b} for _, _, b in G.GENRE_DEFAULTS[g["genre"]]["enemies"]]
            g["levels"] = expand_levels(levels, {**g, "enemies": roster})
        steps = iter(range(1, 5))
        done = G.complete(g, progress=lambda m: pbar.update_absolute(next(steps, 4), 5))
        if overrides:
            done["sfx"] = {**done["sfx"], **overrides}
        spec = G.runtime_spec(done, compress_audio=compress_music)
        name = G.slugify(export_name) if export_name else None
        info = builder.write_game(spec, done, output_root(), name)
        pbar.update_absolute(5, 5)
        thumb = to_image(info["thumb"])
        meta = info["meta"]
        ui_out = {"comfygame": [{"id": meta["id"], "title": meta["title"], "genre": meta["genre"], "levels": meta["levels"], "size": meta["size"]}]}
        return io.NodeOutput(info["html"], thumb, done, ui=ui_out)


# ------------------------------------------------------------------ art
class Palette(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGamePalette", display_name="Palette", category=CAT + "/Art",
            description="Colour palette for the whole game. Art nodes snap to it so everything matches.",
            inputs=[io.Combo.Input("preset", options=list(palettes.PALETTES.keys()), default="forest"),
                    io.String.Input("custom_hex", default="", optional=True, tooltip="Optional: your own colours, e.g. #1a1c2c #5d275d #b13e53 ... (overrides preset)")],
            outputs=[PALETTE.Output(display_name="palette"), io.Image.Output(display_name="swatch")],
        )

    @classmethod
    def execute(cls, preset, custom_hex=""):
        pal = palettes.resolve(custom_hex) if custom_hex and custom_hex.strip() else palettes.resolve(preset)
        sw = swatch(pal)
        return io.NodeOutput(pal, to_image(sw), ui=preview(cls, sw, scale=2))


class PaletteFromImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGamePaletteFromImage", display_name="Palette From Image", category=CAT + "/Art",
            description="Extract a palette from any image (concept art, a photo, an AI render) so the whole game wears its colours.",
            inputs=[io.Image.Input("image"), io.Int.Input("colors", default=12, min=4, max=32)],
            outputs=[PALETTE.Output(display_name="palette"), io.Image.Output(display_name="swatch")],
        )

    @classmethod
    def execute(cls, image, colors):
        rgba = image_to_rgba(image)
        from PIL import Image
        q = Image.fromarray(rgba[..., :3]).resize((128, 128)).quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
        p = q.getpalette()[: colors * 3]
        pal = sorted({palettes.rgb_to_hex(p[i:i + 3]) for i in range(0, len(p), 3)}, key=palettes.luma)
        sw = swatch(pal)
        return io.NodeOutput(pal, to_image(sw), ui=preview(cls, sw, scale=2))


class PixelSprite(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGamePixelSprite", display_name="Pixel Sprite (procedural)", category=CAT + "/Art",
            description="Animated pixel-art character, creature, ship or item drawn procedurally. Change the seed for colour variations.",
            inputs=[io.Combo.Input("kind", options=HERO_LOOKS + CREATURE_LOOKS + ITEM_KINDS, default="knight"),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=True),
                    PALETTE.Input("palette", optional=True, tooltip="Unconnected: recoloured to the game palette at build time")],
            outputs=[SPRITE.Output(display_name="sprite"), io.Image.Output(display_name="sheet")],
        )

    @classmethod
    def execute(cls, kind, seed, palette=None):
        pal = opt_palette(palette)
        spr = sprites.make(kind, seed, pal)
        spr["recipe"] = {"type": "sprite", "kind": kind, "seed": seed, "locked": pal is not None}
        img = sprite_preview_img(spr)
        return io.NodeOutput(spr, to_image(img), ui=preview(cls, spr["img"]))


class PixelBoss(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGamePixelBoss", display_name="Pixel Boss (procedural)", category=CAT + "/Art",
            description="A big crowned boss version of any creature or hero, or a boss warship.",
            inputs=[io.Combo.Input("kind", options=sprites.CREATURE_KINDS + sprites.HERO_KINDS + ["boss_ship"], default="slime"),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=True), PALETTE.Input("palette", optional=True)],
            outputs=[SPRITE.Output(display_name="sprite"), io.Image.Output(display_name="sheet")],
        )

    @classmethod
    def execute(cls, kind, seed, palette=None):
        pal = opt_palette(palette)
        spr = sprites.boss_ship(seed, pal) if kind == "boss_ship" else sprites.boss(kind, seed, pal)
        spr["recipe"] = {"type": "boss", "kind": kind, "seed": seed, "locked": pal is not None}
        return io.NodeOutput(spr, to_image(sprite_preview_img(spr)), ui=preview(cls, spr["img"]))


class SpriteFromImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameSpriteFromImage", display_name="Sprite From Image", category=CAT + "/Art",
            description="Turn any image (an AI render, a drawing, a photo) into a game sprite: cut out, crop, pixelate, palette-snap, outline. An image batch becomes animation frames.",
            search_aliases=["ai sprite", "image to sprite", "pixelate"],
            inputs=[
                io.Image.Input("image"),
                io.Mask.Input("mask", optional=True, tooltip="Foreground mask (e.g. from Remove Background). Without it the plain background is keyed out."),
                io.Int.Input("height", default=28, min=8, max=96, tooltip="In-game height in pixels (heroes ~24-32, enemies ~20-28, bosses ~40-56; tiles are 16)"),
                io.Combo.Input("background", options=["auto key", "mask", "keep"], default="auto key"),
                io.Boolean.Input("pixelate", default=True, tooltip="On: each sprite pixel takes the dominant colour of its area (crisp pixel art). Off: smooth resize"),
                io.Int.Input("max_colors", default=16, min=0, max=64, tooltip="0 = keep all colours"),
                io.Combo.Input("outline", options=["auto", "on", "off"], default="auto", tooltip="auto: add a dark outline only if the art has none"),
                io.Combo.Input("facing", options=["right", "left"], default="right", tooltip="Which way the character in the image faces"),
                PALETTE.Input("palette", optional=True),
            ],
            outputs=[SPRITE.Output(display_name="sprite"), io.Image.Output(display_name="preview")],
        )

    @classmethod
    def execute(cls, image, height, background, pixelate, max_colors, outline, facing, mask=None, palette=None):
        frames = []
        for i in range(image.shape[0]):
            use_mask = mask if (mask is not None and background in ("mask", "auto key")) else None
            rgba = image_to_rgba(image, i, use_mask)
            if use_mask is None and background == "auto key":
                rgba = key_out_background(rgba)
            frames.append(rgba)
        spr = build_sprite_from_images(frames, height, pixelate, max_colors, opt_palette(palette), {"on": True, "off": False}.get(outline, "auto"), facing)
        img = sprite_preview_img(spr)
        return io.NodeOutput(spr, to_image(img), ui=preview(cls, spr["img"]))


class Tileset(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameTileset", display_name="Tileset (procedural)", category=CAT + "/Art",
            description="Auto-tiling ground, platforms, blocks, springs, hazards, top-down walls/floors, chests and stairs.",
            inputs=[io.Combo.Input("style", options=tiles.STYLE_NAMES, default="grass"), io.Int.Input("seed", default=0, min=0, max=SEED_MAX),
                    PALETTE.Input("palette", optional=True)],
            outputs=[TILESET.Output(display_name="tileset"), io.Image.Output(display_name="sheet")],
        )

    @classmethod
    def execute(cls, style, seed, palette=None):
        pal = opt_palette(palette)
        t = tiles.generate(style, pal, seed)
        t["recipe"] = {"type": "tiles", "style": style, "seed": seed, "locked": pal is not None}
        return io.NodeOutput(t, to_image(px.preview(t["img"], scale=3)), ui=preview(cls, t["img"], scale=3))


class TilesetFromImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameTilesetFromImage", display_name="Tileset From Texture", category=CAT + "/Art",
            description="Use any texture image (e.g. an AI 'seamless stone texture') as the ground fill; edges, caps and props stay procedural.",
            inputs=[io.Image.Input("texture"), io.Combo.Input("style", options=tiles.STYLE_NAMES, default="stone", tooltip="Style for the procedural edges and props"),
                    io.Int.Input("max_colors", default=12, min=0, max=32, tooltip="Colours in the pixelated texture (0 = keep)"), PALETTE.Input("palette", optional=True)],
            outputs=[TILESET.Output(display_name="tileset"), io.Image.Output(display_name="sheet")],
        )

    @classmethod
    def execute(cls, texture, style, max_colors, palette=None):
        pal = opt_palette(palette)
        t = tiles.tiles_from_texture(image_to_rgba(texture), style, pal, colors=max_colors)
        sample = px.blank(t["fill"].shape[1] * 3, t["fill"].shape[0] * 2)
        for yy in range(2):
            for xx in range(3):
                sample[yy * t["fill"].shape[0]:(yy + 1) * t["fill"].shape[0], xx * t["fill"].shape[1]:(xx + 1) * t["fill"].shape[1]] = t["fill"]
        return io.NodeOutput(t, to_image(px.preview(t["img"], scale=3)), ui=preview(cls, sample, scale=3))


class Background(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameBackground", display_name="Parallax Background (procedural)", category=CAT + "/Art",
            description="Layered, seamlessly tiling parallax scenery: skies, mountains, forests, cities, caves, space...",
            inputs=[io.Combo.Input("theme", options=backgrounds.THEME_NAMES, default="forest"), io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=True),
                    PALETTE.Input("palette", optional=True)],
            outputs=[BACKDROP.Output(display_name="background"), io.Image.Output(display_name="preview")],
        )

    @classmethod
    def execute(cls, theme, seed, palette=None):
        pal = opt_palette(palette)
        bg = backgrounds.generate(theme, pal, seed)
        bg["recipe"] = {"type": "background", "theme": theme, "seed": seed, "locked": pal is not None}
        comp = backgrounds.composite(bg, 480, 270, 80)
        return io.NodeOutput(bg, to_image(comp), ui=preview(cls, comp, scale=1))


class BackgroundFromImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameBackgroundFromImage", display_name="Background From Image", category=CAT + "/Art",
            description="Use any image (an AI landscape, a painting) as the game backdrop. Optionally add procedural parallax hills in front of it.",
            inputs=[io.Image.Input("image"),
                    io.Combo.Input("foreground", options=["none"] + backgrounds.THEME_NAMES, default="none", tooltip="Add procedural parallax layers from this theme in front"),
                    io.Boolean.Input("pixelate", default=True), io.Int.Input("max_colors", default=24, min=0, max=64),
                    io.Float.Input("darken", default=0.1, min=0.0, max=0.8, step=0.05, tooltip="Darken so sprites stand out"),
                    PALETTE.Input("palette", optional=True)],
            outputs=[BACKDROP.Output(display_name="background"), io.Image.Output(display_name="preview")],
        )

    @classmethod
    def execute(cls, image, foreground, pixelate, max_colors, darken, palette=None):
        rgba = image_to_rgba(image)
        pal = opt_palette(palette)
        h = 270
        if not pixelate:
            h = 540
        bg = backgrounds.from_image(rgba, h=h, palette=pal, colors=max_colors, darken=darken)
        if not pixelate:
            bg["layers"][0]["img"] = bg["layers"][0]["img"]
        if foreground != "none":
            proc = backgrounds.generate(foreground, pal, 0)
            bg["layers"] += [L for L in proc["layers"][1:] if L.get("parallax", 0) >= 0.3]
        comp = backgrounds.composite(bg, 480, 270, 80)
        return io.NodeOutput(bg, to_image(comp), ui=preview(cls, comp, scale=1))


# ------------------------------------------------------------------ world
def _names(s):
    return [n.strip() for n in str(s or "").split(",") if n.strip()]


class PlatformerLevels(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGamePlatformerLevels", display_name="Platformer Levels", category=CAT + "/World",
            description="Generates side-scrolling levels with a difficulty ramp: pits, platforms, hazards, secrets, 3 gems per level, a checkpoint and a boss arena.",
            inputs=[io.Int.Input("count", default=4, min=1, max=12), io.Int.Input("length", default=6, min=3, max=14, tooltip="Level length in screens"),
                    io.Boolean.Input("spikes", default=True), io.Boolean.Input("moving_platforms", default=True), io.Boolean.Input("springs", default=True),
                    io.Boolean.Input("crumbling_blocks", default=True), io.Boolean.Input("boss_at_end", default=True),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX, tooltip="0 = use the game seed"),
                    io.String.Input("names", default="", optional=True, tooltip="Comma-separated level names"), LEVELS.Input("levels", optional=True, tooltip="Append to these levels")],
            outputs=[LEVELS.Output(display_name="levels"), io.Image.Output(display_name="maps")],
        )

    @classmethod
    def execute(cls, count, length, spikes, moving_platforms, springs, crumbling_blocks, boss_at_end, seed, names="", levels=None):
        feats = ["platforms", "blocks"] + [f for f, on in (("spikes", spikes), ("moving", moving_platforms), ("springs", springs), ("crumble", crumbling_blocks)) if on]
        s = {"count": count, "length": length, "features": feats, "boss": boss_at_end, "seed": seed, "names": _names(names)}
        img = gen_preview("platformer", s)
        return io.NodeOutput(chain_levels(levels, {"gen": s}), to_image(img), ui=preview(cls, img, scale=1))


class DungeonFloors(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameDungeonFloors", display_name="Dungeon Floors", category=CAT + "/World",
            description="Rooms and corridors with a key chest, locked stairs, loot chests, traps, torches and a boss floor.",
            inputs=[io.Int.Input("count", default=4, min=1, max=12), io.Float.Input("size", default=1.0, min=0.7, max=1.6, step=0.05),
                    io.Boolean.Input("traps", default=True), io.Boolean.Input("darkness", default=True), io.Boolean.Input("boss_at_end", default=True),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX), io.String.Input("names", default="", optional=True), LEVELS.Input("levels", optional=True)],
            outputs=[LEVELS.Output(display_name="levels"), io.Image.Output(display_name="maps")],
        )

    @classmethod
    def execute(cls, count, size, traps, darkness, boss_at_end, seed, names="", levels=None):
        s = {"count": count, "size": size, "traps": traps, "dark": darkness, "boss": boss_at_end, "seed": seed, "names": _names(names)}
        fake = {"seed": seed or 1, "difficulty": 1.0, "genre": "dungeon", "enemies": None, "theme": None}
        lv = expand_levels({"items": [{"gen": s}]}, fake)
        img = px.hstack([lv_dungeon.preview(x, 3) for x in lv[:4]])
        return io.NodeOutput(chain_levels(levels, {"gen": s}), to_image(img), ui=preview(cls, img, scale=1))


class ArenaStages(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameArenaStages", display_name="Arena Stages", category=CAT + "/World",
            description="Survival stages: an arena with obstacles and an escalating timeline of enemy waves; boss at the end.",
            inputs=[io.Int.Input("count", default=3, min=1, max=10), io.Int.Input("duration", default=70, min=30, max=300, tooltip="Seconds to survive per stage"),
                    io.Float.Input("obstacles", default=1.0, min=0.0, max=2.0, step=0.1), io.Boolean.Input("boss_at_end", default=True),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX), io.String.Input("names", default="", optional=True), LEVELS.Input("levels", optional=True)],
            outputs=[LEVELS.Output(display_name="levels"), io.Image.Output(display_name="maps")],
        )

    @classmethod
    def execute(cls, count, duration, obstacles, boss_at_end, seed, names="", levels=None):
        s = {"count": count, "duration": duration, "obstacles": obstacles, "boss": boss_at_end, "seed": seed, "names": _names(names)}
        fake = {"seed": seed or 1, "difficulty": 1.0, "genre": "arena", "enemies": None, "theme": None}
        lv = expand_levels({"items": [{"gen": s}]}, fake)
        img = level_preview("arena", lv[:3])
        return io.NodeOutput(chain_levels(levels, {"gen": s}), to_image(img), ui=preview(cls, img, scale=1))


class ShmupStages(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameShmupStages", display_name="Shmup Stages", category=CAT + "/World",
            description="Shooter stages: a timeline of formations (lines, sine weavers, V, dive bombers, turrets, swarms) and a multi-phase boss.",
            inputs=[io.Int.Input("count", default=3, min=1, max=10), io.Int.Input("length", default=70, min=30, max=240, tooltip="Seconds before the boss"),
                    io.Float.Input("density", default=1.0, min=0.5, max=2.0, step=0.1), io.Boolean.Input("boss_at_end", default=True),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX), io.String.Input("names", default="", optional=True), LEVELS.Input("levels", optional=True)],
            outputs=[LEVELS.Output(display_name="levels"), io.Image.Output(display_name="timeline")],
        )

    @classmethod
    def execute(cls, count, length, density, boss_at_end, seed, names="", levels=None):
        s = {"count": count, "length": length, "density": density, "boss": boss_at_end, "seed": seed, "names": _names(names)}
        fake = {"seed": seed or 1, "difficulty": 1.0, "genre": "shmup", "enemies": None, "theme": None}
        lv = expand_levels({"items": [{"gen": s}]}, fake)
        img = level_preview("shmup", lv[:4])
        return io.NodeOutput(chain_levels(levels, {"gen": s}), to_image(img), ui=preview(cls, img, scale=2))


class AsciiLevel(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameAsciiLevel", display_name="Level From Text (ASCII)", category=CAT + "/World",
            description="Draw a level with characters. Platformer: # ground  = platform  ^ spikes  o coin  * gem  H heart  P start  G goal  C checkpoint  ? block  S spring  M/V moving  X crumble  L lava  a-h enemies  B boss. Dungeon: # wall  . floor  < start  > stairs  k key chest  c chest  t torch  ^ trap.",
            inputs=[io.String.Input("text", default=SAMPLE_LEVEL, multiline=True), io.String.Input("name", default="Handmade Level"),
                    io.Combo.Input("kind", options=["platformer", "dungeon"], default="platformer"), LEVELS.Input("levels", optional=True)],
            outputs=[LEVELS.Output(display_name="levels"), io.Image.Output(display_name="map")],
        )

    @classmethod
    def execute(cls, text, name, kind, levels=None):
        lv = lv_platformer.from_text(text, name) if kind == "platformer" else lv_dungeon.from_text(text, name)
        img = lv_platformer.preview(lv, 4) if kind == "platformer" else lv_dungeon.preview(lv, 5)
        return io.NodeOutput(chain_levels(levels, {"level": lv}), to_image(img), ui=preview(cls, img, scale=1))


# ------------------------------------------------------------------ actors
class Player(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGamePlayer", display_name="Player", category=CAT + "/Actors",
            description="The hero: stats, abilities and weapon. Connect a sprite (procedural or from an image) or pick a look.",
            inputs=[io.String.Input("name", default="Hero"), io.Combo.Input("look", options=["auto"] + HERO_LOOKS, default="auto"), SPRITE.Input("sprite", optional=True),
                    io.Int.Input("hp", default=3, min=1, max=12), io.Float.Input("speed", default=1.0, min=0.5, max=2.0, step=0.05), io.Float.Input("jump", default=1.0, min=0.6, max=1.6, step=0.05),
                    io.Boolean.Input("double_jump", default=True), io.Boolean.Input("dash", default=False), io.Boolean.Input("wall_jump", default=False), io.Boolean.Input("shoot", default=False),
                    io.Combo.Input("weapon", options=["auto", "blaster", "spread", "laser", "magic", "sword"], default="auto", tooltip="Arena / dungeon / shmup weapon")],
            outputs=[ACTOR.Output(display_name="player")],
        )

    @classmethod
    def execute(cls, name, look, hp, speed, jump, double_jump, dash, wall_jump, shoot, weapon, sprite=None):
        abil = [a for a, on in (("double_jump", double_jump), ("dash", dash), ("wall_jump", wall_jump), ("shoot", shoot)) if on]
        a = {"name": name, "kind": None if look == "auto" else look, "hp": hp, "speed": speed, "jump": jump, "abilities": abil,
             "weapon": None if weapon == "auto" else weapon, "sprite": sprite}
        return io.NodeOutput(a)


class Enemy(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameEnemy", display_name="Enemy", category=CAT + "/Actors",
            description="Add an enemy type to the roster (chain several). Behaviours adapt to the genre: e.g. 'flyer' orbits in top-down games.",
            inputs=[io.String.Input("name", default="Slime"), io.Combo.Input("behavior", options=design.ALL_BEHAVIORS + ["walker", "hopper", "flyer", "spiky"], default="walker"),
                    io.Combo.Input("look", options=["auto"] + CREATURE_LOOKS + sprites.HERO_KINDS, default="auto"), SPRITE.Input("sprite", optional=True),
                    io.Float.Input("hp", default=1.0, min=1.0, max=30.0, step=0.5), io.Float.Input("speed", default=1.0, min=0.3, max=2.5, step=0.05),
                    io.Int.Input("damage", default=1, min=1, max=3), io.Int.Input("score", default=100, min=0, max=10000, step=10), ROSTER.Input("roster", optional=True)],
            outputs=[ROSTER.Output(display_name="roster")],
        )

    @classmethod
    def execute(cls, name, behavior, look, hp, speed, damage, score, sprite=None, roster=None):
        lst = list((roster or {}).get("list", []))
        lst.append({"name": name, "behavior": behavior, "kind": None if look == "auto" else look, "hp": hp, "speed": speed, "damage": damage, "score": score, "sprite": sprite})
        return io.NodeOutput({"list": lst[:8]})


class Boss(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameBoss", display_name="Boss", category=CAT + "/Actors",
            description="The final boss. Each genre gives it its own attack patterns and an enraged second phase.",
            inputs=[io.String.Input("name", default="King Slime"), io.Combo.Input("look", options=["auto"] + sprites.CREATURE_KINDS + sprites.HERO_KINDS + ["boss_ship"], default="auto"),
                    SPRITE.Input("sprite", optional=True), io.Int.Input("hp", default=20, min=3, max=150)],
            outputs=[ACTOR.Output(display_name="boss")],
        )

    @classmethod
    def execute(cls, name, look, hp, sprite=None):
        return io.NodeOutput({"name": name, "kind": None if look == "auto" else look, "behavior": "boss", "hp": hp, "sprite": sprite})


# ------------------------------------------------------------------ audio
class ChipMusic(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameChipMusic", display_name="Chiptune Music", category=CAT + "/Audio",
            description="Composes a seamless looping chiptune (melody motifs, bass, arpeggios, drums) for a mood. Preview it right here.",
            inputs=[io.Combo.Input("mood", options=music_mod.MOOD_NAMES, default="adventure"), io.Combo.Input("instruments", options=list(music_mod.INSTRUMENTS.keys()), default="nes"),
                    io.Int.Input("tempo", default=0, min=0, max=220, tooltip="BPM, 0 = mood default"), io.Int.Input("bars", default=24, min=8, max=64, step=8),
                    io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=True),
                    io.Combo.Input("slot", options=["main", "boss", "title"], default="main", tooltip="Which track this is in the game"), MUSIC.Input("music", optional=True)],
            outputs=[MUSIC.Output(display_name="music"), io.Audio.Output(display_name="audio")],
        )

    @classmethod
    def execute(cls, mood, instruments, tempo, bars, seed, slot, music=None):
        song = music_mod.compose(mood, seed, tempo, bars, instruments=instruments)
        audio = music_mod.render(song)
        m = dict(music or {})
        m[slot] = audio
        a = synth.to_comfy_audio(audio)
        return io.NodeOutput(m, a, ui=ui.PreviewAudio(a, cls=cls))


class MusicFromAudio(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameMusicFromAudio", display_name="Music From Audio", category=CAT + "/Audio",
            description="Use any ComfyUI audio as game music: a music model's output, Load Audio, etc. It loops in game.",
            inputs=[io.Audio.Input("audio"), io.Combo.Input("slot", options=["main", "boss", "title"], default="main"),
                    io.Float.Input("max_seconds", default=90.0, min=5.0, max=300.0, step=1.0), io.Float.Input("volume", default=0.9, min=0.1, max=1.5, step=0.05),
                    MUSIC.Input("music", optional=True)],
            outputs=[MUSIC.Output(display_name="music")],
        )

    @classmethod
    def execute(cls, audio, slot, max_seconds, volume, music=None):
        x, sr = synth.from_comfy_audio(audio)
        x = x[: int(max_seconds * sr)]
        fade = min(len(x) // 4, int(0.05 * sr))
        if fade > 0:
            x = x.copy()
            ramp = np.linspace(1, 0, fade)
            x[-fade:] = (x[-fade:].T * ramp).T
            x[:fade] = (x[:fade].T * ramp[::-1]).T
        x = synth.normalize(x, 0.9) * volume
        m = dict(music or {})
        m[slot] = (x, sr)
        return io.NodeOutput(m)


class SoundEffects(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameSoundEffects", display_name="Sound Effects", category=CAT + "/Audio",
            description="A full set of retro sound effects (jump, coin, hit, explosion, power-up...) in one style. Preview plays them in sequence.",
            inputs=[io.Combo.Input("style", options=list(sfx_mod.STYLES.keys()), default="retro"), io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=True)],
            outputs=[SFX.Output(display_name="sfx"), io.Audio.Output(display_name="audio")],
        )

    @classmethod
    def execute(cls, style, seed):
        pack = sfx_mod.pack(seed, style)
        a = synth.to_comfy_audio(sfx_mod.preview_track(pack), sfx_mod.SR)
        return io.NodeOutput({"sounds": pack, "complete": True}, a, ui=ui.PreviewAudio(a, cls=cls))


class SoundFromAudio(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameSoundFromAudio", display_name="Sound From Audio", category=CAT + "/Audio",
            description="Replace one sound effect with any ComfyUI audio (a recording, an audio model's output...).",
            inputs=[io.Audio.Input("audio"), io.Combo.Input("sound", options=sfx_mod.NAMES, default="jump"), io.Float.Input("max_seconds", default=1.5, min=0.05, max=6.0, step=0.05),
                    SFX.Input("sfx", optional=True)],
            outputs=[SFX.Output(display_name="sfx")],
        )

    @classmethod
    def execute(cls, audio, sound, max_seconds, sfx=None):
        x, sr = synth.from_comfy_audio(audio)
        if x.ndim == 2:
            x = x.mean(axis=1)
        x = synth.normalize(x[: int(max_seconds * sr)], 0.85)
        base = dict((sfx or {}).get("sounds", {}))
        base[sound] = (x, sr)
        return io.NodeOutput({"sounds": base, "complete": bool((sfx or {}).get("complete"))})


# ------------------------------------------------------------------ design / AI
PROMPT_OUTS = ["player_prompt", "enemy1_prompt", "enemy2_prompt", "enemy3_prompt", "boss_prompt", "background_prompt", "tiles_prompt"]


def _prompt_outputs():
    return [io.String.Output(display_name=n) for n in PROMPT_OUTS]


def _prompt_values(g):
    p = design.art_prompts(g)
    return [p["player"], p["enemy_1"], p["enemy_2"], p["enemy_3"], p["boss"], p["background"], p["tiles"]]


class IdeaDice(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameIdeaDice", display_name="Game Idea Dice (no AI)", category=CAT + "/Design",
            description="Rolls a complete, coherent game design from a seed: genre, theme, title, hero, enemies with behaviours, boss, story, music. Also outputs image prompts so an image model can draw the cast.",
            search_aliases=["random game", "idea", "inspiration"],
            inputs=[io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=True),
                    io.Combo.Input("genre", options=["any"] + G.GENRES, default="any"), io.Combo.Input("theme", options=["any"] + list(ideas.THEMES.keys()), default="any")],
            outputs=[GAME.Output(display_name="game")] + _prompt_outputs() + [io.String.Output(display_name="design_json")],
        )

    @classmethod
    def execute(cls, seed, genre, theme):
        d = ideas.roll(seed, genre, theme)
        g = design.to_game(d, seed)
        text = json.dumps(d, indent=1)
        return io.NodeOutput(g, *_prompt_values(g), text, ui=ui.PreviewText(G.summary(g)))


class AIDesigner(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameAIDesigner", display_name="AI Game Designer (LLM)", category=CAT + "/Design",
            description="Describe a game in plain words; an LLM designs it (title, story, cast, behaviours, levels, music, art prompts, optional custom mechanic code). "
                        "Providers: claude_code (your Claude subscription via Claude Code), anthropic_api (API key), openai_compat (Ollama / LM Studio), comfy_local (a text model loaded in ComfyUI via the clip input).",
            search_aliases=["llm", "claude", "ai", "game designer", "prompt to game"],
            inputs=[
                io.String.Input("idea", default="A tiny robot gardener defends a greenhouse from mutant bugs", multiline=True),
                io.Combo.Input("provider", options=providers.PROVIDERS, default="claude_code"),
                io.String.Input("model", default="", tooltip="claude_code: opus / sonnet / haiku or a full model id. anthropic_api: e.g. claude-opus-5-5. openai_compat: the server's model name."),
                io.Combo.Input("effort", options=["low", "medium", "high"], default="medium", tooltip="Claude thinking effort (higher = slower, more inventive)"),
                io.Combo.Input("genre", options=["auto"] + G.GENRES, default="auto"),
                io.Boolean.Input("custom_mechanic_code", default=False, tooltip="Let the model write a JavaScript mod with one signature mechanic"),
                io.Int.Input("seed", default=0, min=0, max=SEED_MAX, control_after_generate=False, tooltip="Change to get a different design for the same idea"),
                io.Clip.Input("clip", optional=True, tooltip="For provider comfy_local: a text-generation model from Load CLIP"),
                GAME.Input("revise_game", optional=True, tooltip="Revise this game instead of starting fresh (the idea becomes the change request)"),
            ],
            outputs=[GAME.Output(display_name="game")] + _prompt_outputs() + [io.String.Output(display_name="design_json")],
        )

    @classmethod
    def execute(cls, idea, provider, model, effort, genre, custom_mechanic_code, seed, clip=None, revise_game=None):
        base = (revise_game or {}).get("extra", {}).get("design") if revise_game else None
        d, raw = providers.design(idea + (f"\n(variation #{seed})" if seed else ""), provider, model, effort, custom_mechanic_code, base, genre, clip, seed)
        g = design.to_game(d, (revise_game or {}).get("seed") if revise_game else None)
        return io.NodeOutput(g, *_prompt_values(g), json.dumps(d, indent=1), ui=ui.PreviewText(G.summary(g)))


class GameFromJSON(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameFromJSON", display_name="Game From Design JSON", category=CAT + "/Design",
            description="Paste a design JSON (written by you, or by any chatbot using the prompt in the ComfyGame panel). Unknown values are matched to the closest supported ones.",
            inputs=[io.String.Input("design_json", multiline=True, default=json.dumps(ideas.roll(7, "platformer"), indent=1)), io.Int.Input("seed", default=0, min=0, max=SEED_MAX, tooltip="0 = derive from the title")],
            outputs=[GAME.Output(display_name="game")] + _prompt_outputs(),
        )

    @classmethod
    def execute(cls, design_json, seed):
        g = design.to_game(design_json, seed or None)
        return io.NodeOutput(g, *_prompt_values(g), ui=ui.PreviewText(G.summary(g)))


class ArtPrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameArtPrompt", display_name="Game Art Prompt", category=CAT + "/Design",
            description="Builds an image-model prompt that produces clean, cut-out-friendly game assets.",
            inputs=[io.String.Input("subject", default="a brave little fox knight with a blue scarf", multiline=True),
                    io.Combo.Input("asset", options=["character", "creature", "boss", "item", "background", "texture", "ship"], default="character"),
                    io.Combo.Input("art_style", options=["pixel art", "cute chibi pixel art", "16-bit SNES", "hand-drawn cartoon", "clay 3d render", "painterly fantasy", "vector flat"], default="pixel art")],
            outputs=[io.String.Output(display_name="prompt"), io.String.Output(display_name="negative")],
        )

    @classmethod
    def execute(cls, subject, asset, art_style):
        framing = {
            "character": "full body character, side view facing right, standing pose, centered, plain white background, game sprite",
            "creature": "single monster, full body, side view facing right, centered, plain white background, game sprite",
            "boss": "giant boss monster, full body, side view facing right, imposing, centered, plain white background, game sprite",
            "item": "single game item icon, centered, plain white background",
            "ship": "spaceship side view facing right, centered, plain white background, game sprite",
            "background": "wide game background landscape, layered parallax scenery, no characters, no text",
            "texture": "seamless tileable ground texture, flat top-down view, game texture",
        }[asset]
        prompt = f"{subject}, {framing}, {art_style}, crisp shapes, bold colors, high contrast"
        negative = "text, watermark, signature, blurry, multiple characters, cropped, frame, border, shadow on ground"
        return io.NodeOutput(prompt, negative)


class ApplySprites(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameApplySprites", display_name="Apply Art To Game", category=CAT + "/Design",
            description="Attach sprites / tiles / background to a designed game (e.g. AI-generated art for an LLM or dice design). Enemy slots follow roster order.",
            inputs=[GAME.Input("game"), SPRITE.Input("player", optional=True), SPRITE.Input("enemy_1", optional=True), SPRITE.Input("enemy_2", optional=True),
                    SPRITE.Input("enemy_3", optional=True), SPRITE.Input("enemy_4", optional=True), SPRITE.Input("boss", optional=True),
                    TILESET.Input("tileset", optional=True), BACKDROP.Input("background", optional=True)],
            outputs=[GAME.Output(display_name="game")],
        )

    @classmethod
    def execute(cls, game, player=None, enemy_1=None, enemy_2=None, enemy_3=None, enemy_4=None, boss=None, tileset=None, background=None):
        g = G.copy_game(game)
        if player is not None:
            g["player"] = dict(g.get("player") or {"name": "Hero"}, sprite=player)
        ens = [e for e in (enemy_1, enemy_2, enemy_3, enemy_4)]
        if any(e is not None for e in ens):
            roster = g.get("enemies") or [G.make_actor(n, k, b) for n, k, b in G.GENRE_DEFAULTS[g["genre"]]["enemies"]]
            roster = [dict(e) for e in roster]
            for i, s in enumerate(ens):
                if s is not None and i < len(roster):
                    roster[i]["sprite"] = s
            g["enemies"] = roster
        if boss is not None:
            n, k, hp = G.GENRE_DEFAULTS[g["genre"]]["boss"]
            g["boss"] = dict(g.get("boss") or G.make_actor(n, k, "boss", hp=hp), sprite=boss)
        if tileset is not None:
            g["tileset"] = tileset
        if background is not None:
            g["backgrounds"]["main"] = background
        return io.NodeOutput(g)


class GameScript(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameScript", display_name="Game Script (JavaScript mod)", category=CAT + "/Design",
            description="Add custom gameplay with a few lines of JavaScript (hooks: onUpdate, draw, onEnemyKilled, onPlayerHit, onLevelStart...). See docs/SCRIPTING.md.",
            inputs=[io.String.Input("code", default=SAMPLE_SCRIPT, multiline=True)],
            outputs=[io.String.Output(display_name="script")],
        )

    @classmethod
    def execute(cls, code):
        return io.NodeOutput(code)


class AIScript(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameAIScript", display_name="AI Script (LLM writes a mod)", category=CAT + "/Design",
            description="Describe a mechanic ('enemies explode into three smaller ones', 'gravity flips every 10 seconds') and an LLM writes the JavaScript mod.",
            inputs=[io.String.Input("mechanic", default="Every 15 seconds a golden coin rain falls from the sky for 4 seconds; catching coins gives bonus points", multiline=True),
                    io.Combo.Input("provider", options=providers.PROVIDERS, default="claude_code"), io.String.Input("model", default=""),
                    io.Combo.Input("effort", options=["low", "medium", "high"], default="medium"), io.Int.Input("seed", default=0, min=0, max=SEED_MAX),
                    io.Clip.Input("clip", optional=True)],
            outputs=[io.String.Output(display_name="script")],
        )

    @classmethod
    def execute(cls, mechanic, provider, model, effort, seed, clip=None):
        code = providers.write_script(mechanic + (f"\n(variation {seed})" if seed else ""), provider, model, effort, clip, seed)
        return io.NodeOutput(code, ui=ui.PreviewText(code))


class GameInfo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ComfyGameInfo", display_name="Game Info", category=CAT, is_output_node=True,
            description="Shows a readable summary of a game (useful after the AI designer).",
            inputs=[GAME.Input("game")], outputs=[io.String.Output(display_name="summary")],
        )

    @classmethod
    def execute(cls, game):
        s = G.summary(game)
        return io.NodeOutput(s, ui=ui.PreviewText(s))


NODES = [GameSetup, BuildGame, Palette, PaletteFromImage, PixelSprite, PixelBoss, SpriteFromImage, Tileset, TilesetFromImage, Background, BackgroundFromImage,
         PlatformerLevels, DungeonFloors, ArenaStages, ShmupStages, AsciiLevel, Player, Enemy, Boss, ChipMusic, MusicFromAudio, SoundEffects, SoundFromAudio,
         IdeaDice, AIDesigner, GameFromJSON, ArtPrompt, ApplySprites, GameScript, AIScript, GameInfo]
