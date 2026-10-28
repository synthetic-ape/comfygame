"""Game *designs*: the compact JSON that people, the Idea Dice and LLMs write. `to_game()` validates it
(fuzzy-matching anything unknown onto what the engine supports) and returns a CG_GAME dict.
"""
import json
import re
import zlib

from . import backgrounds, game as G, palettes, sprites, tiles
from .audio import music, sfx

BEHAVIORS = {
    "platformer": ["walker", "hopper", "flyer", "shooter", "charger", "spiky"],
    "arena": ["chaser", "runner", "orbiter", "shooter", "charger", "tank", "splitter", "exploder", "turret"],
    "dungeon": ["chaser", "runner", "orbiter", "shooter", "charger", "tank", "splitter", "exploder", "turret"],
    "shmup": ["line", "weaver", "turret", "kamikaze", "spinner", "tank"],
}
ALL_BEHAVIORS = sorted({b for v in BEHAVIORS.values() for b in v})
ABILITIES = ["double_jump", "dash", "wall_jump", "shoot"]
WEAPONS = ["blaster", "spread", "laser", "magic", "sword"]
LOOKS = sprites.HERO_KINDS + sprites.CREATURE_KINDS + sprites.SHIP_KINDS + ["enemy_ship", "boss_ship"]

# Free-text look -> sprite kind. First match wins.
LOOK_WORDS = [
    (r"knight|paladin|soldier|warrior|guard|armou?r", "knight"), (r"wizard|mage|witch|sorcer|warlock|magic", "mage"),
    (r"ninja|assassin|samurai|rogue|thief", "ninja"), (r"robot|android|mech|cyborg|bot\b|machine", "robot"),
    (r"fox|cat|dog|wolf|rabbit|bunny|animal|bear|raccoon|squirrel|hamster|penguin|otter|duck|bird|owl|frog|panda|pig|hedgehog|mouse|kitten|puppy|monkey|koala|sloth", "fox"), (r"astronaut|space ?man|pilot|cosmonaut", "astronaut"),
    (r"ranger|archer|elf|hunter|hood|explorer|adventurer|scout", "ranger"), (r"princess|queen|girl|lady|fairy|dancer", "princess"),
    (r"slime|blob|ooze|jelly|goo", "slime"), (r"bat|vampire", "bat"), (r"ghost|spirit|phantom|wraith|specter|spectre|soul", "ghost"),
    (r"eye|watcher|beholder", "eyeball"), (r"spider|arachnid|crab|scorpion", "spider"), (r"mushroom|shroom|fung", "mushroom"),
    (r"beetle|bug|insect|ant\b|tortoise|turtle|snail", "beetle"), (r"plant|flower|vine|cactus|tree", "plant"),
    (r"imp|devil|demon|goblin|gremlin|kobold|orc", "imp"), (r"drone|probe|sentry|turret", "drone"), (r"skelet|bone|undead|zombie|lich|mummy", "skeleton"),
    (r"ship|fighter|jet|plane|craft|starship|rocket", "fighter"), (r"ufo|saucer|alien ship|invader", "enemy_ship"),
]


def guess_look(text, default="mutant"):
    t = str(text or "").lower()
    if t in LOOKS:
        return t
    for pat, kind in LOOK_WORDS:
        if re.search(pat, t):
            return kind
    return default


THEME_SYNONYMS = {
    "snow": "ice frozen winter arctic glacier tundra polar snowy christmas kitchen",
    "ocean": "sea beach water island coast lake river pirate tropical shore",
    "space": "galaxy stars cosmic planet orbit nebula alien moon starship",
    "volcano": "lava fire hell inferno magma ash furnace",
    "castle": "dungeon crypt tomb catacomb haunted gothic medieval mansion spooky",
    "city": "cyberpunk neon urban street factory lab robot metropolis",
    "desert": "sand dune egypt pyramid canyon wasteland",
    "mountains": "mountain peak cliff hills highland alpine",
    "forest": "woods garden meadow grassland village farm park",
    "cave": "underground mine cavern crystal tunnel",
    "candy": "sweet sugar cake toy dessert bakery",
    "jungle": "rainforest swamp temple aztec tiki",
    "sky": "clouds heaven floating airship",
    "underwater": "reef coral abyss deep_sea aquarium submarine",
}


def _closest(value, options, default):
    v = str(value or "").lower().strip().replace(" ", "_").replace("-", "_")
    if v in options:
        return v
    for o in options:
        if v and (v in o or o in v):
            return o
    return default


def theme_of_text(text):
    t = _closest(text, backgrounds.THEME_NAMES, None)
    if t:
        return t
    words = re.findall(r"[a-z_]+", str(text or "").lower())
    for theme, syn in THEME_SYNONYMS.items():
        if any(w in syn.split() for w in words):
            return theme
    return None


def _num(v, d, lo, hi):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return d


def _seed_from(text):
    return zlib.crc32(str(text).encode("utf-8")) & 0x7FFFFFFF


def extract_json(text):
    """Pull the first JSON object out of an LLM reply (handles ```json fences and trailing chatter)."""
    if isinstance(text, dict):
        return text
    s = str(text or "")
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", s, re.S)
    if m:
        s = m.group(1)
    start = s.find("{")
    if start < 0:
        raise ValueError("no JSON object found")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                chunk = s[start:i + 1]
                try:
                    return json.loads(chunk)
                except json.JSONDecodeError:
                    # forgive trailing commas, the most common LLM mistake
                    return json.loads(re.sub(r",\s*([}\]])", r"\1", chunk))
    # truncated output: close the brackets we can see
    chunk = s[start:]
    opens = chunk.count("{") - chunk.count("}")
    sq = chunk.count("[") - chunk.count("]")
    return json.loads(re.sub(r",\s*$", "", chunk.rstrip()) + "]" * max(0, sq) + "}" * max(0, opens))


def to_game(design, seed=None):
    """Validate a design dict and turn it into a CG_GAME (art/audio left for `complete()` unless given)."""
    d = design if isinstance(design, dict) else extract_json(design)
    genre = _closest(d.get("genre"), G.GENRES, "platformer")
    title = str(d.get("title") or "Untitled")[:40]
    seed = int(seed if seed is not None else d.get("seed", _seed_from(title))) & 0x7FFFFFFF
    theme = theme_of_text(d.get("theme") or d.get("background")) or G.GENRE_DEFAULTS[genre]["bg"]
    pal = d.get("palette")
    pal = palettes.resolve(pal) if pal else palettes.resolve(G.THEME_PALETTE.get(theme, "forest"))
    story = d.get("story") or {}
    g = G.new_game(title, genre, seed, d.get("difficulty", "normal"), int(_num(d.get("lives"), 3, 1, 9)), str(d.get("tagline") or "")[:90],
                   str(story.get("intro") or d.get("intro") or "")[:600], str(story.get("ending") or d.get("ending") or "")[:400], pal, theme,
                   bool(d.get("crt", False)))
    p = d.get("player") or {}
    look = guess_look(p.get("look") or p.get("kind") or p.get("name"), "fighter" if genre == "shmup" else G.GENRE_DEFAULTS[genre]["hero"])
    if genre == "shmup" and look not in sprites.SHIP_KINDS:
        look = "fighter"
    abil = [_closest(a, ABILITIES, None) for a in (p.get("abilities") or [])]
    g["player"] = {
        "name": str(p.get("name") or "Hero")[:24], "kind": look, "hp": int(_num(p.get("hp"), 3 if genre == "platformer" else 5, 1, 12)),
        "speed": _num(p.get("speed"), 1.0, 0.5, 2.0), "jump": _num(p.get("jump"), 1.0, 0.6, 1.6),
        "abilities": [a for a in abil if a] or list(G.GENRE_DEFAULTS[genre]["abilities"]),
        "weapon": _closest(p.get("weapon"), WEAPONS, G.GENRE_DEFAULTS[genre]["weapon"]) if (p.get("weapon") or G.GENRE_DEFAULTS[genre]["weapon"]) else None,
        "sprite": None, "description": str(p.get("description") or p.get("look") or ""), "art_prompt": str(p.get("art_prompt") or ""),
    }
    enemies = []
    for i, e in enumerate((d.get("enemies") or [])[:8]):
        if not isinstance(e, dict):
            continue
        beh = _closest(e.get("behavior"), BEHAVIORS[genre], None) or _closest(e.get("behavior"), ALL_BEHAVIORS, BEHAVIORS[genre][i % len(BEHAVIORS[genre])])
        elook = guess_look(e.get("look") or e.get("kind") or e.get("name"), "enemy_ship" if genre == "shmup" else "mutant")
        enemies.append({
            "name": str(e.get("name") or f"Foe {i + 1}")[:24], "kind": elook, "behavior": beh, "hp": _num(e.get("hp"), 1, 1, 20),
            "speed": _num(e.get("speed"), 1.0, 0.3, 2.5), "damage": int(_num(e.get("damage"), 1, 1, 3)), "score": int(_num(e.get("score"), 100, 10, 5000)),
            "sprite": None, "description": str(e.get("description") or ""), "art_prompt": str(e.get("art_prompt") or ""),
        })
    g["enemies"] = enemies or None
    b = d.get("boss")
    if isinstance(b, dict) and b:
        blook = guess_look(b.get("look") or b.get("kind") or b.get("name"), "boss_ship" if genre == "shmup" else "slime")
        g["boss"] = {"name": str(b.get("name") or "Boss")[:28], "kind": "boss_ship" if genre == "shmup" else blook, "behavior": "boss",
                     "hp": int(_num(b.get("hp"), 20, 5, 120)), "sprite": None, "description": str(b.get("description") or ""), "art_prompt": str(b.get("art_prompt") or "")}
    lv = d.get("levels") or {}
    if isinstance(lv, list):
        lv = {"count": len(lv), "names": [x.get("name") if isinstance(x, dict) else str(x) for x in lv]}
    g["level_settings"] = {k: v for k, v in {
        "count": int(_num(lv.get("count"), G.GENRE_DEFAULTS[genre]["levels"], 1, 12)), "length": int(_num(lv.get("length"), 6, 3, 14)),
        "features": [f for f in (lv.get("features") or []) if f in ("spikes", "platforms", "moving", "springs", "crumble", "blocks")] or None,
        "boss": bool(lv.get("boss_at_end", True)),
        "names": [str(n)[:28] for n in (lv.get("names") or [])],
        "duration": int(_num(lv.get("duration"), 70, 30, 240)), "size": _num(lv.get("size"), 1.0, 0.7, 1.6),
    }.items() if v is not None}
    m = d.get("music") or {}
    if isinstance(m, str):
        m = {"mood": m}
    g["music_mood"] = _closest(m.get("mood"), music.MOOD_NAMES, None)
    g["music_style"] = _closest(m.get("instruments"), list(music.INSTRUMENTS.keys()), "nes")
    g["sfx_style"] = _closest(d.get("sfx"), list(sfx.STYLES.keys()), "retro")
    g["tile_style"] = _closest(d.get("tiles"), tiles.STYLE_NAMES, None)
    g["bg_theme"] = theme_of_text(d.get("background")) if d.get("background") else None
    art = d.get("art") or {}
    g["extra"]["art"] = {"style": str(art.get("style") or ""), "background_prompt": str(art.get("background_prompt") or ""), "tile_prompt": str(art.get("tile_prompt") or "")}
    if d.get("script"):
        g["scripts"].append(str(d["script"]))
    g["extra"]["design"] = d
    return g


def apply_level_names(game):
    names = (game.get("level_settings") or {}).get("names") or []
    for i, lv in enumerate(game.get("levels") or []):
        if i < len(names) and names[i]:
            lv["name"] = names[i]
    return game


def art_prompts(game, style=None):
    """Prompts for an image model, one per asset slot (consistent style suffix)."""
    art = (game.get("extra") or {}).get("art") or {}
    style = style or art.get("style") or "16-bit pixel art game sprite, clean outlines, vibrant colors"
    theme = game.get("theme") or ""

    def actor(a, fallback):
        if not a:
            return ""
        base = a.get("art_prompt") or f"{a.get('name', '')}, {a.get('description') or a.get('kind') or fallback}"
        view = "side view facing right, full body" if game["genre"] in ("platformer", "arena", "dungeon") else "side view spaceship facing right"
        return f"{base}, {view}, single character centered, plain white background, {style}"

    enemies = game.get("enemies") or []
    out = {
        "player": actor(game.get("player"), "hero"),
        "enemy_1": actor(enemies[0] if len(enemies) > 0 else None, "monster"),
        "enemy_2": actor(enemies[1] if len(enemies) > 1 else None, "monster"),
        "enemy_3": actor(enemies[2] if len(enemies) > 2 else None, "monster"),
        "boss": actor(game.get("boss"), "giant boss monster"),
        "background": art.get("background_prompt") or f"{theme} landscape game background, wide panorama, layered parallax scenery, no characters, {style.replace('sprite', 'background')}",
        "tiles": art.get("tile_prompt") or f"seamless {game.get('tile_style') or theme} ground texture, top-down, tileable game texture, {style.replace('sprite', 'texture')}",
    }
    return out


DESIGN_SCHEMA_DOC = """{
  "title": "short catchy title (max 30 chars)",
  "tagline": "one-line hook",
  "genre": "platformer | arena | dungeon | shmup",
  "theme": "forest | mountains | desert | snow | cave | city | space | ocean | volcano | candy | jungle | castle | sky | underwater",
  "palette": "forest | pico8 | sweetie16 | desert | neon | ice | lava | candy | ocean | spooky | sunset | gameboy | noir | jungle | cyber | autumn  (or a list of 8-16 hex colors)",
  "difficulty": "easy | normal | hard",
  "lives": 3,
  "story": {"intro": "2-4 sentence opening shown before level 1", "ending": "1-3 sentence victory text"},
  "player": {"name": "...", "look": "knight | mage | ninja | robot | fox | astronaut | ranger | princess | fighter | interceptor (or a short description)",
             "hp": 3, "speed": 1.0, "jump": 1.0, "abilities": ["double_jump", "dash", "wall_jump", "shoot"], "weapon": "blaster | spread | laser | magic | sword",
             "art_prompt": "visual description for an image generator"},
  "enemies": [{"name": "...", "look": "slime | bat | ghost | eyeball | spider | mushroom | beetle | plant | imp | drone | skeleton | mutant | enemy_ship (or a description)",
               "behavior": "platformer: walker|hopper|flyer|shooter|charger|spiky; arena/dungeon: chaser|runner|orbiter|shooter|charger|tank|splitter|exploder|turret; shmup: line|weaver|turret|kamikaze|spinner|tank",
               "hp": 1, "speed": 1.0, "damage": 1, "score": 100, "art_prompt": "..."}],
  "boss": {"name": "...", "look": "...", "hp": 20, "art_prompt": "..."},
  "levels": {"count": 4, "length": 6, "features": ["spikes", "platforms", "moving", "springs", "crumble", "blocks"], "names": ["Level 1 name", "..."], "boss_at_end": true},
  "music": {"mood": "heroic | adventure | happy | chill | spooky | mysterious | intense | epic | retro", "instruments": "nes | gameboy | soft | synth"},
  "sfx": "retro | soft | crunchy | space",
  "tiles": "grass | stone | snow | sand | tech | cave | candy | brick | wood | ice | lava | jungle | dungeon",
  "art": {"style": "shared art style words for every image prompt", "background_prompt": "...", "tile_prompt": "..."},
  "script": "OPTIONAL JavaScript mod (see the scripting API) or empty string"
}"""
