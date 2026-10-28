"""The game model that flows through the node graph (GG_GAME) and its procedural auto-completion.

A game is a plain dict. Nodes fill in parts; `complete()` generates whatever is still missing so a
two-node graph (Game Setup -> Build) already produces a full, polished game. `runtime_spec()` turns it
into the JSON the JavaScript runtime plays.
"""
import copy
import random
import re
import time

from . import backgrounds, palettes, sprites, tiles
from .audio import music, sfx, synth
from .levels import arena as lv_arena
from .levels import dungeon as lv_dungeon
from .levels import platformer as lv_platformer
from .levels import shmup as lv_shmup

GENRES = ["platformer", "arena", "dungeon", "shmup"]

GENRE_DEFAULTS = {
    "platformer": dict(palette="forest", tiles="grass", bg="forest", mood="adventure", hero="knight", levels=4, abilities=["double_jump"], weapon=None,
                       enemies=[("Slime", "slime", "walker"), ("Bat", "bat", "flyer"), ("Shroom", "mushroom", "hopper"), ("Spitter", "plant", "shooter")],
                       boss=("King Slime", "slime", 14)),
    "arena": dict(palette="sweetie16", tiles="grass", bg="forest", mood="intense", hero="ranger", levels=3, abilities=[], weapon="blaster",
                  enemies=[("Slime", "slime", "chaser"), ("Bat", "bat", "orbiter"), ("Imp", "imp", "runner"), ("Golem", "beetle", "tank"), ("Eye", "eyeball", "shooter"), ("Splitter", "mutant", "splitter")],
                  boss=("Overlord", "eyeball", 30)),
    "dungeon": dict(palette="spooky", tiles="dungeon", bg="castle", mood="mysterious", hero="knight", levels=4, abilities=[], weapon="sword",
                    enemies=[("Slime", "slime", "chaser"), ("Skeleton", "skeleton", "charger"), ("Bat", "bat", "orbiter"), ("Ghost", "ghost", "orbiter"), ("Eye", "eyeball", "shooter")],
                    boss=("Lich King", "ghost", 30)),
    "shmup": dict(palette="neon", tiles="tech", bg="space", mood="intense", hero="fighter", levels=3, abilities=[], weapon="blaster",
                  enemies=[("Drone", "enemy_ship", "line"), ("Weaver", "enemy_ship", "weaver"), ("Turret", "enemy_ship", "turret"), ("Diver", "enemy_ship", "kamikaze"), ("Spinner", "enemy_ship", "spinner")],
                  boss=("Dreadnought", "boss_ship", 40)),
}

THEME_TILES = {"forest": "grass", "mountains": "stone", "desert": "sand", "snow": "snow", "cave": "cave", "city": "tech", "space": "tech",
               "ocean": "sand", "volcano": "lava", "candy": "candy", "jungle": "jungle", "castle": "dungeon", "sky": "grass", "underwater": "ice"}
THEME_PALETTE = {"forest": "forest", "mountains": "sweetie16", "desert": "desert", "snow": "ice", "cave": "spooky", "city": "cyber", "space": "neon",
                 "ocean": "ocean", "volcano": "lava", "candy": "candy", "jungle": "jungle", "castle": "spooky", "sky": "sweetie16", "underwater": "ocean"}


def slugify(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", str(s).lower()).strip("-")
    return s[:40] or "game"


def new_game(title="My Game", genre="platformer", seed=0, difficulty="normal", lives=3, tagline="", intro="", ending="", palette=None,
             theme=None, crt=False, resolution=(480, 270)):
    genre = genre if genre in GENRES else "platformer"
    d = GENRE_DEFAULTS[genre]
    diff = {"easy": 0.7, "normal": 1.0, "hard": 1.35, "brutal": 1.7}.get(str(difficulty).lower(), difficulty if isinstance(difficulty, (int, float)) else 1.0)
    return {
        "title": title or "Untitled", "tagline": tagline or "", "genre": genre, "seed": int(seed) & 0x7FFFFFFF, "difficulty": float(diff), "lives": int(lives),
        "theme": theme, "palette": palettes.resolve(palette) if palette else None, "crt": bool(crt), "resolution": list(resolution),
        "text": {"intro": intro or "", "ending": ending or ""},
        "player": None, "enemies": None, "boss": None, "levels": None, "level_settings": {},
        "tileset": None, "tile_style": None, "backgrounds": {}, "bg_theme": None,
        "music": {}, "music_mood": None, "music_style": "nes", "sfx": None, "sfx_style": "retro",
        "scripts": [], "code": "", "items": {}, "extra": {}, "defaults_used": d["hero"],
    }


def copy_game(game):
    """Shallow-ish copy so nodes never mutate an upstream (cached) dict."""
    g = dict(game)
    for k in ("text", "level_settings", "backgrounds", "music", "items", "extra"):
        g[k] = dict(game.get(k) or {})
    g["scripts"] = list(game.get("scripts") or [])
    if game.get("enemies") is not None:
        g["enemies"] = [dict(e) for e in game["enemies"]]
    if game.get("player") is not None:
        g["player"] = dict(game["player"])
    if game.get("boss") is not None:
        g["boss"] = dict(game["boss"])
    if game.get("levels") is not None:
        g["levels"] = list(game["levels"])
    return g


def make_actor(name, kind=None, behavior="walker", hp=1, speed=1.0, damage=1, score=100, sprite=None, description=""):
    return {"name": name, "kind": kind, "behavior": behavior, "hp": hp, "speed": speed, "damage": damage, "score": score, "sprite": sprite, "description": description}


def theme_of(game):
    return game.get("theme") or GENRE_DEFAULTS[game["genre"]]["bg"]


def palette_of(game):
    if game.get("palette"):
        return game["palette"]
    th = game.get("theme")
    return palettes.resolve(THEME_PALETTE.get(th) if th else GENRE_DEFAULTS[game["genre"]]["palette"])


def rerender(asset, pal):
    """Procedural assets made without an explicit palette are re-drawn in the game's palette so everything matches."""
    if not isinstance(asset, dict) or not asset.get("recipe") or asset["recipe"].get("locked"):
        return asset
    r = asset["recipe"]
    kind = r.get("type")
    if kind == "sprite":
        out = sprites.make(r["kind"], r.get("seed", 0), pal)
    elif kind == "boss":
        out = sprites.boss_ship(r.get("seed", 0), pal) if r["kind"] == "boss_ship" else sprites.boss(r["kind"], r.get("seed", 0), pal)
    elif kind == "tiles":
        out = tiles.generate(r["style"], pal, r.get("seed", 0))
    elif kind == "background":
        out = backgrounds.generate(r["theme"], pal, r.get("seed", 0), w=r.get("w", 512), h=r.get("h", 270))
    else:
        return asset
    out["recipe"] = dict(r, locked=True)
    return out


def complete(game, progress=None):
    """Return a copy of `game` with every missing part generated procedurally (deterministic per seed)."""
    g = copy_game(game)
    genre = g["genre"]
    d = GENRE_DEFAULTS[genre]
    seed = g["seed"]
    rng = random.Random(seed)
    pal = palette_of(g)
    g["palette"] = pal
    theme = theme_of(g)
    step = (lambda msg: progress(msg)) if progress else (lambda msg: None)

    # re-colour procedural assets that were created without their own palette
    for key in ("player", "boss"):
        if g.get(key) and g[key].get("sprite") is not None:
            g[key]["sprite"] = rerender(g[key]["sprite"], pal)
    for e in g.get("enemies") or []:
        if e.get("sprite") is not None:
            e["sprite"] = rerender(e["sprite"], pal)
    if g.get("tileset") is not None:
        g["tileset"] = rerender(g["tileset"], pal)
    for k, v in list(g["backgrounds"].items()):
        g["backgrounds"][k] = rerender(v, pal)

    # actors
    if not g.get("player"):
        g["player"] = make_actor("Hero", d["hero"])
    p = g["player"]
    p.setdefault("hp", 3 if genre == "platformer" else 5)
    p.setdefault("abilities", list(d["abilities"]))
    if not p.get("abilities") and genre == "platformer":
        p["abilities"] = list(d["abilities"])
    p.setdefault("weapon", d["weapon"])
    if not p.get("weapon"):
        p["weapon"] = d["weapon"]
    if p.get("sprite") is None:
        kind = p.get("kind") or d["hero"]
        if genre == "shmup" and kind not in sprites.SHIP_KINDS:
            kind = "fighter"
        p["sprite"] = sprites.make(kind, seed % 997, pal)
    if not g.get("enemies"):
        g["enemies"] = [make_actor(n, k, b, hp=1 + i // 2, speed=1.0, score=100 + 50 * i) for i, (n, k, b) in enumerate(d["enemies"])]
    for i, e in enumerate(g["enemies"]):
        e.setdefault("behavior", "walker")
        e.setdefault("hp", 1)
        e.setdefault("speed", 1.0)
        e.setdefault("damage", 1)
        e.setdefault("score", 100)
        if e.get("sprite") is None:
            kind = e.get("kind") or d["enemies"][i % len(d["enemies"])][1]
            if genre == "shmup" and kind not in ("enemy_ship", "boss_ship") and kind not in sprites.CREATURES and kind not in sprites.HEROES:
                kind = "enemy_ship"
            e["sprite"] = sprites.make(kind, seed * 3 + i * 17 + 1, pal)
    if g.get("boss") is None and genre in GENRES:
        n, k, hp = d["boss"]
        g["boss"] = make_actor(n, k, "boss", hp=hp)
    b = g["boss"]
    if b is not None and b.get("sprite") is None:
        kind = b.get("kind") or d["boss"][1]
        b["sprite"] = sprites.boss_ship(seed, pal) if (genre == "shmup" or kind == "boss_ship") else sprites.boss(kind, seed + 5, pal)
    step("actors")

    # levels
    if not g.get("levels"):
        ls = g.get("level_settings") or {}
        n = int(ls.get("count") or d["levels"])
        boss_last = ls.get("boss", True)
        diff = g["difficulty"]
        levels = []
        for i in range(n):
            last = i == n - 1 and boss_last
            if genre == "platformer":
                lv = lv_platformer.generate(seed, i, n, ls.get("length", 6), diff, g["enemies"], last, ls.get("features"), liquid=g.get("tile_style") == "lava" or theme == "volcano", theme=g.get("tile_style") or THEME_TILES.get(theme, "grass"))
            elif genre == "dungeon":
                lv = lv_dungeon.generate(seed, i, n, ls.get("size", 1.0), diff, g["enemies"], last, theme="dungeon")
            elif genre == "arena":
                lv = lv_arena.generate(seed, i, n, ls.get("duration", 70), diff, g["enemies"], last, theme=g.get("tile_style") or "grass")
            else:
                lv = lv_shmup.generate(seed, i, n, ls.get("length", 70), diff, g["enemies"], last, theme="space")
            levels.append(lv)
        names = ls.get("names") or []
        for i, lv in enumerate(levels):
            if i < len(names) and names[i]:
                lv["name"] = names[i]
        g["levels"] = levels
    step("levels")

    # art
    if g.get("tileset") is None:
        style = g.get("tile_style") or THEME_TILES.get(theme) or d["tiles"]
        if genre == "dungeon" and not g.get("tile_style"):
            style = "dungeon"
        g["tileset"] = tiles.generate(style, pal, seed)
    if not g["backgrounds"].get("main"):
        bg_theme = g.get("bg_theme") or theme
        W, H = g["resolution"]
        g["backgrounds"]["main"] = backgrounds.generate(bg_theme, pal, seed, w=max(512, W + 32), h=H)
    items = g["items"]
    items.setdefault("coin", sprites.coin(pal))
    items.setdefault("gem", sprites.gem(pal))
    items.setdefault("heart", sprites.heart(pal))
    items.setdefault("potion", sprites.potion(pal))
    items.setdefault("flag", sprites.flag(pal))
    step("art")

    # audio
    mood = g.get("music_mood") or d["mood"]
    if g["music"].get("main") is None:
        song = music.compose(mood, seed, bars=24 if mood not in ("chill", "spooky", "mysterious") else 16, instruments=g.get("music_style") or "nes")
        g["music"]["main"] = music.render(song)
    if g["music"].get("boss") is None and any(lv.get("boss") for lv in g["levels"]):
        song = music.compose("boss", seed + 1, bars=16, instruments=g.get("music_style") or "nes")
        g["music"]["boss"] = music.render(song)
    if not g.get("sfx"):
        g["sfx"] = sfx.pack(seed, g.get("sfx_style") or "retro")
    step("audio")
    return g


def _audio_entry(a, compress=True):
    """Music entries can be raw numpy loops, (array, sr) tuples, or ready runtime dicts / data URLs."""
    if a is None:
        return None
    if isinstance(a, str):
        return {"src": a}
    if isinstance(a, dict) and "src" in a:
        return a
    if isinstance(a, tuple):
        arr, sr = a
        return music.loop_spec(arr, sr, compress)
    return music.loop_spec(a, synth.SR, compress)


def _sfx_entry(v):
    if isinstance(v, str):
        return v
    if isinstance(v, tuple):
        return synth.data_url(v[0], v[1], compress=False)
    return synth.data_url(v, sfx.SR, compress=False)


def runtime_spec(game, compress_audio=True):
    """JSON-ready spec for the JavaScript runtime (assets embedded as data URLs)."""
    g = game
    pal = g["palette"]
    tc = palettes.theme_colors(pal)
    sprites_out = {"player": sprites.sprite_to_spec(g["player"]["sprite"])}
    enemies = []
    for i, e in enumerate(g["enemies"]):
        key = f"e{i}"
        sprites_out[key] = sprites.sprite_to_spec(e["sprite"])
        enemies.append({k: e[k] for k in ("name", "behavior", "hp", "speed", "damage", "score") if k in e} | {"id": key, "sprite": key, "description": e.get("description", "")})
    boss = None
    if g.get("boss"):
        sprites_out["boss"] = sprites.sprite_to_spec(g["boss"]["sprite"])
        boss = {"name": g["boss"].get("name", "Boss"), "hp": g["boss"].get("hp", 20), "sprite": "boss"}
    for k, s in g["items"].items():
        sprites_out[k] = sprites.sprite_to_spec(s)
    music_out = {}
    for k, a in g["music"].items():
        ent = _audio_entry(a, compress_audio)
        if ent:
            music_out[k] = ent
    jingles = {"win": synth.data_url(music.jingle("win"), compress=False), "lose": synth.data_url(music.jingle("lose"), compress=False)}
    p = g["player"]
    spec = {
        "version": 1, "engine": "ComfyGame", "id": g.get("id") or slugify(g["title"]) + "-" + str(g["seed"]),
        "title": g["title"], "tagline": g.get("tagline", ""), "genre": g["genre"], "seed": g["seed"],
        "style": {"palette": pal, "resolution": g["resolution"], "crt": g.get("crt", False), "accent": tc["accent"], "accent2": tc["accent2"]},
        "rules": {"lives": g.get("lives", 3), "difficulty": g.get("difficulty", 1.0)},
        "text": g.get("text", {}),
        "player": {"name": p.get("name", "Hero"), "hp": int(p.get("hp", 3)), "speed": float(p.get("speed", 1.0)), "jump": float(p.get("jump", 1.0)),
                   "abilities": list(p.get("abilities") or []), "weapon": p.get("weapon"), "sprite": "player"},
        "enemies": enemies, "boss": boss, "levels": g["levels"],
        "assets": {"sprites": sprites_out, "tiles": tiles.to_spec(g["tileset"]),
                   "backgrounds": {k: backgrounds.to_spec(v) for k, v in g["backgrounds"].items() if v}},
        "audio": {"music": music_out, "sfx": {k: _sfx_entry(v) for k, v in (g.get("sfx") or {}).items()}, "jingles": jingles},
        "scripts": [s for s in g.get("scripts", []) if s and s.strip()],
        "code": g.get("code") or "",
        "meta": {"created": int(time.time()), "generator": "ComfyGame", "theme": theme_of(g)},
    }
    return spec


def summary(game):
    """Human-readable outline (used in node previews and LLM refinement prompts)."""
    lines = [f"{game['title']} ({game['genre']}, seed {game['seed']}, difficulty {game['difficulty']:.2f})"]
    if game.get("tagline"):
        lines.append(game["tagline"])
    p = game.get("player") or {}
    if p:
        lines.append(f"Player: {p.get('name', 'Hero')} hp={p.get('hp')} abilities={p.get('abilities')} weapon={p.get('weapon')}")
    for e in game.get("enemies") or []:
        lines.append(f"Enemy: {e.get('name')} [{e.get('behavior')}] hp={e.get('hp')} speed={e.get('speed')}")
    if game.get("boss"):
        lines.append(f"Boss: {game['boss'].get('name')} hp={game['boss'].get('hp')}")
    if game.get("levels"):
        lines.append("Levels: " + ", ".join(l.get("name", "?") for l in game["levels"]))
    return "\n".join(lines)


def deepcopy_light(game):
    return copy.copy(game)
