"""Procedural pixel-art sprites: heroes, creatures, ships, bosses and items, with animation frames.

Templates are drawn facing RIGHT without outlines; outlines and palette snapping are applied after
composition. Every generator returns a sprite dict understood by the runtime:
    {"img": RGBA array (sheet), "fw", "fh", "frames", "anims": {name: {"frames": [...], "fps": n}}}
"""
import random

import numpy as np

from . import palettes as P
from . import pixel as px

# ----------------------------------------------------------------------------- humanoid parts
# Upper body rows 0..11 (16 wide). Legs (rows 12..14) are shared animation frames.
HEROES = {
    "knight": [
        "................",
        "....aa..........",
        "...aAmmmmmm.....",
        "...Ammmmmmmmm...",
        "...mmmmmmmmmmn..",
        "...mmmmnnnnnnn..",
        "...mmmmnwnnwnn..",
        "...nmmmmmmmmmn..",
        "....nnnnnnnnn...",
        "..44422322mm....",
        "..4442333mmm....",
        "..44.12221......",
    ],
    "mage": [
        "........AA......",
        ".......Aaa......",
        "......Aaaaa.....",
        ".....Aaa3aaa....",
        "...AAaaaaaaaaA..",
        "....hhssssst....",
        "....hssewsset...",
        "....hhsssssst...",
        ".....hhhtttt....",
        "....1223322.m...",
        "...11233332sm...",
        "...112222221m...",
    ],
    "ninja": [
        "................",
        ".....1111111....",
        "....122222221...",
        "....122222222...",
        "..aa12ssssss2...",
        ".aAa1sweswe12...",
        "..A.12222222....",
        "....12222222....",
        ".....112221.....",
        "....1aaaaa2s....",
        "....122332.s....",
        "....1122221.....",
    ],
    "robot": [
        ".........a......",
        ".........n......",
        "....mmmmmmmmm...",
        "...mmmmmmmmmmn..",
        "...mm1111111mn..",
        "...mm1a1a111mn..",
        "...mm1111111mn..",
        "...nmmmmmmmmmn..",
        ".....nnnnnnn....",
        "...n2223322n....",
        "..nm2333332mm...",
        "...n2222222n....",
    ],
    "fox": [
        "................",
        "....1.....1.....",
        "....21...12.....",
        "....2222222.....",
        "...222222222....",
        "...2223we232....",
        "..2223333333ee..",
        "...22233333.....",
        "....222223......",
        ".11.455554......",
        "1221455654s.....",
        ".12.444444......",
    ],
    "astronaut": [
        "................",
        ".....mmmmmm.....",
        "....mmmmmmmmm...",
        "...mmm111111mn..",
        "...mm1a11111mn..",
        "...mm11sse11mn..",
        "...mm111111mmn..",
        "...nmmmmmmmmmn..",
        "....nnmmmmmnn...",
        "..44mm3a3mm.....",
        "..44mmm33mmm....",
        "..44.mmmmmm.....",
    ],
    "ranger": [
        "................",
        ".....44444......",
        "....4555554.....",
        "...455555554....",
        "...45hhsssss4...",
        "...45hssewss4...",
        "...454sssssst...",
        "...4454tttt.....",
        "...44455........",
        "...4422322..A...",
        "..44123332sA....",
        "..44.12221.A....",
    ],
    "princess": [
        "......a.a.a.....",
        "......aaaaa.....",
        ".....hhhhhhh....",
        "....hhhhhhhhh...",
        "...hhhsssssss...",
        "...hhssewssew...",
        "...hhssssssst...",
        "...hhhsssstt....",
        "...hhh.sss......",
        "...hh.2232......",
        "..hh.233332s....",
        "....22233322....",
    ],
}

# Each hero: default ramps (main, secondary), skin, hair, metal, accent, pants, boots.
HERO_COLORS = {
    "knight": dict(main="#4a6fd0", sec="#c03a3a", skin="#f2c89a", hair="#6b4a2a", metal="#c8ccd8", accent="#e84040", pants="#3a3f5a", boots="#5a3a2a"),
    "mage": dict(main="#6a3ab0", sec="#3a2a6a", skin="#f0c49a", hair="#e8e8f0", metal="#a07a40", accent="#5a46c8", pants="#3a2a5a", boots="#4a2a2a"),
    "ninja": dict(main="#2a2a3a", sec="#c03a3a", skin="#f0c49a", hair="#1a1a24", metal="#a0a8b8", accent="#d83a3a", pants="#2a2a3a", boots="#1a1a24"),
    "robot": dict(main="#d8a83a", sec="#8a8a9a", skin="#9ad8ff", hair="#333333", metal="#b8bcc8", accent="#40e8ff", pants="#5a5e6a", boots="#3a3e48"),
    "fox": dict(main="#e8782a", sec="#4a8a4a", skin="#f8e8d0", hair="#e8782a", metal="#c8c8c8", accent="#2a2a2a", pants="#5a3a2a", boots="#3a2a1a"),
    "astronaut": dict(main="#e8e8ee", sec="#d85a3a", skin="#3a6ab0", hair="#333333", metal="#e8e8f0", accent="#f0c040", pants="#c8c8d0", boots="#8a8a98"),
    "ranger": dict(main="#6a8a3a", sec="#3f6a3a", skin="#f0c49a", hair="#8a5a2a", metal="#a8a8a8", accent="#a87a3a", pants="#5a4a3a", boots="#4a3020"),
    "princess": dict(main="#e86aa8", sec="#a83a78", skin="#f8d4b0", hair="#f0c048", metal="#f0d060", accent="#f0d060", pants="#e86aa8", boots="#a83a78"),
}

LEGS = {
    "stand": ["......pp.pp.....", "......pp.pp.....", "......ff.fff...."],
    "walk0": [".....PP...pp....", "....PP.....pp...", "...ff......fff.."],
    "walk1": [".......Ppp......", "......PP.pp.....", "......ff..ff...."],
    "walk2": [".....pp...PP....", "....pp.....PP...", "...ff......ff..."],
    "walk3": [".......pPP......", "......pp.PP.....", "......ff..ff...."],
    "jump": ["......PPpp......", ".....PP..pp.....", ".........ff....."],
    "fall": ["......pp.pp.....", ".....pp...pp....", "....ff.....ff..."],
    "dress": ["....22233322....", "...2233333322...", "....ff....ff...."],
    "dress_w": ["....222333222...", "...223333332....", "...ff......ff..."],
}


def _hero_colormap(kind, seed, overrides=None):
    base = dict(HERO_COLORS[kind])
    rng = random.Random(seed)
    if seed:
        # tasteful variation: rotate main/secondary hues, keep skin believable
        dh = rng.uniform(-0.5, 0.5) if kind not in ("fox",) else rng.uniform(-0.04, 0.04)
        base["main"] = P.shift(base["main"], dh, rng.uniform(-0.1, 0.1), rng.uniform(-0.08, 0.08))
        base["sec"] = P.shift(base["sec"], rng.uniform(-0.5, 0.5))
        base["accent"] = P.shift(base["accent"], rng.uniform(-0.5, 0.5))
        if kind in ("mage", "ranger", "princess", "knight"):
            base["hair"] = rng.choice(["#2a1a12", "#6b4a2a", "#c08040", "#e8c860", "#e8e8f0", "#a03a2a", "#3a3a6a"])
        if kind in ("mage", "ninja", "ranger", "knight", "princess"):
            base["skin"] = rng.choice(["#f8d8b8", "#f0c49a", "#d8a070", "#a8704a", "#7a4a30"])
    if overrides:
        base.update({k: v for k, v in overrides.items() if v})
    m = P.ramp(base["main"], 3)
    s = P.ramp(base["sec"], 3)
    sk = P.ramp(base["skin"], 2)
    hr = P.ramp(base["hair"], 2)
    mt = P.ramp(base["metal"], 2)
    ac = P.ramp(base["accent"], 2)
    pa = P.ramp(base["pants"], 2)
    return {
        "1": m[0], "2": m[1], "3": m[2], "4": s[0], "5": s[1], "6": s[2],
        "s": sk[1], "t": sk[0], "h": hr[1], "H": hr[0], "e": "#141018", "w": "#ffffff",
        "m": mt[1], "n": mt[0], "a": ac[1], "A": ac[0], "p": pa[1], "P": pa[0], "f": P.ramp(base["boots"], 2)[0],
    }


def _finish(frames, palette=None, outline_color=None, lock=True):
    pal = P.resolve(palette) if palette else None
    out = []
    for f in frames:
        if pal and lock:
            f = px.snap(f, pal)
        oc = outline_color or (P.by_luma(pal)[0] if pal else "#141018")
        if P.luma(oc) > 0.25:
            oc = "#141018"
        out.append(px.outline(f, oc))
    return out


def _sheet(frames, anims):
    return {"img": px.hstack(frames), "fw": frames[0].shape[1], "fh": frames[0].shape[0], "frames": len(frames), "anims": anims}


def hero(kind="knight", seed=0, palette=None, lock_palette=True, colors=None):
    kind = kind if kind in HEROES else "knight"
    cmap = _hero_colormap(kind, seed, colors)
    upper = HEROES[kind]
    dress = kind == "princess"
    leg_seq = {
        "idle0": "dress" if dress else "stand", "idle1": "dress" if dress else "stand",
        "run0": "dress_w" if dress else "walk0", "run1": "dress" if dress else "walk1",
        "run2": "dress_w" if dress else "walk2", "run3": "dress" if dress else "walk3",
        "jump": "dress_w" if dress else "jump", "fall": "dress" if dress else "fall",
    }
    bob = {"idle0": 0, "idle1": 1, "run0": 0, "run1": -1, "run2": 0, "run3": -1, "jump": -1, "fall": 0}
    order = ["idle0", "idle1", "run0", "run1", "run2", "run3", "jump", "fall"]
    frames = []
    for name in order:
        img = px.blank(16, 16)
        b = bob[name]
        px.from_rows(upper, cmap, ox=0, oy=b + (1 if b >= 0 else 0), into=img)
        px.from_rows(LEGS[leg_seq[name]], cmap, ox=0, oy=13 if b >= 0 else 12, into=img)
        if name == "idle1":
            pass
        frames.append(img)
    # scarf/cape flutter on run frames for ninja / knight
    frames = _finish(frames, palette, lock=lock_palette)
    anims = {
        "idle": {"frames": [0, 1], "fps": 2.5}, "run": {"frames": [2, 3, 4, 5], "fps": 11}, "walk": {"frames": [2, 3, 4, 5], "fps": 8},
        "jump": {"frames": [6], "fps": 1}, "fall": {"frames": [7], "fps": 1}, "hurt": {"frames": [7], "fps": 1}, "move": {"frames": [2, 3, 4, 5], "fps": 10},
    }
    return _sheet(frames, anims)


# ----------------------------------------------------------------------------- creatures
CREATURES = {
    "slime": {
        "frames": [
            ["................", "................", "................", "................", "................", "................",
             "......3333......", "....33332223....", "...3322222222...", "..332w22w22222..", "..32ee22ee22222.", "..222222222222..",
             "..122222222221..", "...1111111111...", "................", "................"],
            ["................", "................", "................", "................", "................", "................",
             "................", "......3333......", "...333322223....", "..332w22w222222.", ".322ee22ee222222", ".22222222222222.",
             ".11222222222211.", "..111111111111..", "................", "................"],
            ["................", "................", "................", "................", ".......33.......", ".....333223.....",
             "....33222222....", "...332w22w223...", "...32ee22ee222..", "...2222222222...", "...1222222221...", "....12222221....",
             ".....111111.....", "................", "................", "................"],
        ],
        "anims": {"idle": [0, 1], "walk": [0, 1], "jump": [2], "fall": [2], "fly": [0, 1]},
        "colors": dict(main="#4ac04a", sec="#2a6a2a"), "fps": 4,
    },
    "bat": {
        "frames": [
            ["................", "................", "................", "1..........1....", "11........11....", "121..1.1.121....",
             "1221.1111.1221..", "12221w11w12221..", "1222.e11e..2221.", ".12..1111...21..", "......11........", "................",
             "................", "................", "................", "................"],
            ["................", "................", "................", "................", "................", ".....1.1........",
             ".....1111.......", "...1.w11w1......", "..111e11e111....", ".122111111221...", "1222.1111.2221..", "122.......221...",
             "12.........21...", "1...........1...", "................", "................"],
        ],
        "anims": {"idle": [0, 1], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#6a4a8a", sec="#e04a6a"), "fps": 8,
    },
    "ghost": {
        "frames": [
            ["................", "................", ".....333333.....", "....33333333....", "...3322222223...", "...32ee22ee23...",
             "...32ee22ee22...", "...3222222222...", "...32224422222..", "...22224422222..", "...2222222222...", "...22222222222..",
             "...2.22.22.222..", "...2..2..2..2...", "................", "................"],
            ["................", "................", ".....333333.....", "....33333333....", "...3322222223...", "...32ee22ee23...",
             "...32ee22ee22...", "...3222222222...", "...32224422222..", "...22224422222..", "...2222222222...", "...22222222222..",
             "....222.222.22..", "....2...2...2...", "................", "................"],
        ],
        "anims": {"idle": [0, 1], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#d8e0f0", sec="#3a3a5a"), "fps": 4,
    },
    "eyeball": {
        "frames": [
            ["................", "................", ".......1........", "......1.........", ".....33333......", "...3333333333...",
             "..333333333333..", "..33333www3333..", "..3333weew3333..", "..3333weew3333..", "..33333www3333..", "..333333333333..",
             "...3333a3a333...", ".....33333......", "................", "................"],
            ["................", "................", ".......1........", "........1.......", ".....33333......", "...3333333333...",
             "..333333333333..", "..333333333333..", "..33222222223...", "..3222222222233.", "..333333333333..", "..333333333333..",
             "...3333a3a333...", ".....33333......", "................", "................"],
        ],
        "anims": {"idle": [0, 0, 0, 0, 1], "walk": [0], "fly": [0, 0, 0, 1]},
        "colors": dict(main="#f0e0e0", sec="#c03a3a"), "fps": 4,
    },
    "spider": {
        "frames": [
            ["................", "................", "................", "................", "................", "......2222......",
             ".....222222.....", "..1.22222222.1..", ".1.1222ee2221.1.", "1...22222222...1", "1..1.222222.1..1", "..1..1....1..1..",
             ".1..1......1..1.", "................", "................", "................"],
            ["................", "................", "................", "................", "................", "......2222......",
             ".....222222.....", "...122222222.1..", "..1.222ee222.1..", ".1..22222222..1.", "1...1222222.1..1", "...1..1..1...1..",
             "..1..1....1.1...", "................", "................", "................"],
        ],
        "anims": {"idle": [0], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#4a3a5a", sec="#d03a3a"), "fps": 9,
    },
    "mushroom": {
        "frames": [
            ["................", "................", "......4444......", "....44444444....", "...4466444664...", "..446644444664..",
             "..444444444444..", "...5555555555...", ".....ssssss.....", ".....sewsew.....", ".....ssssss.....", "......tttt......",
             ".....pp..pp.....", ".....ff..ff.....", "................", "................"],
            ["................", "................", "................", "......4444......", "....44444444....", "...4466444664...",
             "..446644444664..", "..444444444444..", "...5555555555...", ".....sewsew.....", ".....ssssss.....", "......tttt......",
             "......pp.pp.....", "......ff.ff.....", "................", "................"],
        ],
        "anims": {"idle": [0, 1], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#d84a3a", sec="#f0e8d8"), "fps": 6, "cap": True,
    },
    "beetle": {
        "frames": [
            ["................", "................", "................", "................", "................", ".....33333......",
             "...333222233....", "..33222222223...", "..322222222232e.", "..222222222222e.", "..112222222111..", "...1.1..1.1.....",
             "..1..1..1..1....", "................", "................", "................"],
            ["................", "................", "................", "................", "................", ".....33333......",
             "...333222233....", "..33222222223...", "..322222222232e.", "..222222222222e.", "..112222222111..", "....1.1..1.1....",
             "....1..1..1..1..", "................", "................", "................"],
        ],
        "anims": {"idle": [0], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#3a8ac8", sec="#f0c040"), "fps": 8,
    },
    "plant": {
        "frames": [
            ["................", "................", "....2222........", "...222222.......", "..2222222a......", "..222ew22aa.....",
             "..22222222a.....", "...2222222......", "....22222.......", ".......5........", "......55.55.....", ".....5.55..5....",
             "......5555......", ".....444444.....", ".....444444.....", "......4444......"],
            ["................", "................", "....2222........", "...222222.......", "..222ew222......", "..2222222aaaa...",
             "..22222222......", "..2222222aaaa...", "...22222........", ".......5........", "......55.55.....", ".....5.55..5....",
             "......5555......", ".....444444.....", ".....444444.....", "......4444......"],
        ],
        "anims": {"idle": [0, 0, 1], "walk": [0, 1], "fly": [0, 1], "attack": [1]},
        "colors": dict(main="#4aa83a", sec="#a85a3a"), "fps": 3,
    },
    "imp": {
        "frames": [
            ["................", "....1......1....", "....21....12....", ".....222222.....", "....22222222....", "....22w22w22....",
             "....22e22e22....", "....22222222....", ".....2aaaa2.....", "....12222221....", "...1.122221.1...", "......2..2......",
             ".....22..22.....", "................", "................", "................"],
            ["................", "....1......1....", "....21....12....", ".....222222.....", "....22222222....", "....22w22w22....",
             "....22e22e22....", "....22222222....", ".....2aaaa2.....", "...112222221....", "......22221.1...", ".....2....2.....",
             "....22....22....", "................", "................", "................"],
        ],
        "anims": {"idle": [0, 1], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#c83a3a", sec="#f0d040"), "fps": 6,
    },
    "drone": {
        "frames": [
            ["................", "................", "..mmm......mmm..", "....n......n....", "....nnnnnnnn....", "...n22222222n...",
             "...n2aa22222n...", "...n2aa22222n...", "...n22222222n...", "....nnnnnnnn....", ".....n....n.....", "................",
             "................", "................", "................", "................"],
            ["................", "................", "...mmm....mmm...", "....n......n....", "....nnnnnnnn....", "...n22222222n...",
             "...n22aa2222n...", "...n22aa2222n...", "...n22222222n...", "....nnnnnnnn....", ".....n....n.....", "................",
             "................", "................", "................", "................"],
        ],
        "anims": {"idle": [0, 1], "walk": [0, 1], "fly": [0, 1]},
        "colors": dict(main="#5a6a7a", sec="#ff4040"), "fps": 12,
    },
}


def _creature_cmap(main, sec, seed, kind):
    m = P.ramp(main, 3)
    s = P.ramp(sec, 3)
    return {
        "1": m[0], "2": m[1], "3": m[2], "4": s[1], "5": s[0], "6": s[2],
        "e": "#141018", "w": "#ffffff", "a": s[2] if kind != "eyeball" else s[1],
        "s": "#f0e0c8", "t": "#c8b090", "p": "#f0e0c8", "f": "#8a6a4a", "m": "#c8ccd8", "n": "#5a5e6a",
    }


def creature(kind="slime", seed=0, palette=None, lock_palette=True, main=None, sec=None):
    if kind == "skeleton":
        return hero("knight", seed, palette, lock_palette, colors=dict(main="#e8e4d8", sec="#5a4a3a", skin="#e8e4d8", hair="#e8e4d8", metal="#e8e4d8", accent="#c03a3a", pants="#d8d4c8", boots="#a8a498"))
    if kind == "mutant" or kind not in CREATURES:
        return mutant(seed, palette, lock_palette)
    spec = CREATURES[kind]
    rng = random.Random(seed)
    c_main = main or spec["colors"]["main"]
    c_sec = sec or spec["colors"]["sec"]
    if seed and not main:
        c_main = P.shift(c_main, rng.uniform(-0.5, 0.5), rng.uniform(-0.1, 0.1))
    if seed and not sec:
        c_sec = P.shift(c_sec, rng.uniform(-0.5, 0.5))
    cmap = _creature_cmap(c_main, c_sec, seed, kind)
    frames = [px.from_rows(rows, cmap, 16, 16) for rows in spec["frames"]]
    frames = _finish(frames, palette, lock=lock_palette)
    fps = spec.get("fps", 6)
    anims = {k: {"frames": v, "fps": fps} for k, v in spec["anims"].items()}
    anims.setdefault("attack", anims.get("idle"))
    return _sheet(frames, anims)


def _ca_mask(rng, w, h, fill, steps=2, center_bias=0.55):
    """Symmetric rounded blob: noisy ellipse smoothed with cellular automata, mirrored left/right."""
    half = (w + 1) // 2
    rx, ry = rng.uniform(0.55, 0.95) * half, rng.uniform(0.3, 0.46) * h
    cy = h * center_bias
    m = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(half):
            d = ((half - 0.5 - x) / rx) ** 2 + ((y - cy) / ry) ** 2
            m[y, x] = d < 0.75 or (d < 1.25 and rng.random() < fill - (d - 0.75))
    if rng.random() < 0.7:  # horns / ears
        hx = int(half - rx * rng.uniform(0.3, 0.8))
        top = int(cy - ry)
        for i in range(rng.randint(2, 4)):
            if 0 <= top - i < h and 0 <= hx - (i // 2) < half:
                m[top - i, hx - (i // 2)] = True
    m[:, half:] = m[:, :w - half][:, ::-1]
    for _ in range(steps):
        p = np.pad(m, 1)
        n = sum(np.roll(np.roll(p, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)[1:-1, 1:-1]
        m = (m & (n >= 2)) | (~m & (n >= 6))
        m[0, :] = m[-1, :] = False
        m[:, 0] = m[:, -1] = False
    return m


def mutant(seed=0, palette=None, lock_palette=True, size=16):
    """Random symmetric creature: smoothed blob body, shading, eyes, little feet, 2-frame wobble."""
    rng = random.Random(seed * 7919 + 13)
    pal = P.resolve(palette) if palette else list(P.PALETTES["sweetie16"])
    body = rng.choice([c for c in pal if 0.3 < P.luma(c) < 0.8 and P.saturation(c) > 0.25] or pal)
    spot = rng.choice([c for c in pal if c != body] or pal)
    ramp = P.ramp(body, 3)
    m = None
    for _ in range(12):
        m = _ca_mask(rng, size, size - 3, rng.uniform(0.45, 0.75))
        if 40 < m.sum() < size * size * 0.6:
            break
    ys, xs = np.where(m)
    top, bot = (ys.min(), ys.max()) if len(ys) else (2, size - 4)
    frames = []
    for f in range(2):
        img = px.blank(size, size)
        for y, x in zip(ys, xs):
            yy = y + 1 + (1 if f and y > (top + bot) / 2 else 0)
            k = (y - top) / max(1, bot - top)
            col = ramp[2] if k < 0.3 else ramp[1] if k < 0.78 else ramp[0]
            if (x * 7 + y * 13 + seed) % 11 == 0 and 0.2 < k < 0.8:
                col = spot
            if yy < size:
                img[yy, x] = px.rgba(col)
        cx = size // 2
        ey = int(top + (bot - top) * 0.38) + 1
        for ex in (cx - 3, cx + 1):
            if img[ey, ex, 3] or img[ey, ex + 1, 3]:
                img[ey:ey + 2, ex:ex + 2] = px.rgba("#ffffff")
                img[ey + 1, ex + 1] = px.rgba("#141018")
        fy = min(size - 1, bot + 2 + (0 if f else 0))
        for fx in ((cx - 3, cx - 2), (cx + 1, cx + 2)) if f == 0 else ((cx - 4, cx - 3), (cx + 2, cx + 3)):
            for x in fx:
                if 0 <= x < size and fy < size:
                    img[fy, x] = px.rgba(ramp[0])
        frames.append(img)
    frames = _finish(frames, palette, lock=lock_palette)
    return _sheet(frames, {"idle": {"frames": [0, 1], "fps": 4}, "walk": {"frames": [0, 1], "fps": 6}, "fly": {"frames": [0, 1], "fps": 6}})


def boss(kind="slime", seed=0, palette=None, lock_palette=True, scale=2):
    """A big version of a creature (or hero) with a crown/horns, re-outlined at the larger size."""
    base = creature(kind, seed, palette, lock_palette) if kind not in HEROES else hero(kind, seed, palette, lock_palette)
    fw, fh, n = base["fw"], base["fh"], base["frames"]
    sheet = base["img"]
    frames = []
    rng = random.Random(seed)
    crown = P.nearest(P.resolve(palette), "#f0c040") if palette else "#f0c040"
    crown_kind = ["a.a.a.a", "aaaaaaa", "aAaaaAa"] if rng.random() < 0.6 else ["A.....A", "AA...AA", ".AA.AA."]
    for i in range(n):
        f = sheet[:, i * fw:(i + 1) * fw]
        big = px.upscale(f, scale)
        # strip the upscaled 2px outline and redo a crisp 1px one so it reads as hand-drawn
        dark = big[..., :3].astype(int).sum(-1) < 90
        big = big.copy()
        canvas = px.blank(fw * scale + 4, fh * scale + 8)
        px.blit(canvas, big, 2, 8)
        x0, y0, x1, y1 = px.bbox(canvas)
        cx = (x0 + x1) // 2
        top = y0
        crown_rows = crown_kind
        px.from_rows(crown_rows, {"a": crown, "A": P.shift(crown, 0, 0, -0.25)}, ox=cx - 3, oy=max(0, top - 2), into=canvas)
        canvas = px.outline(canvas, "#141018")
        frames.append(canvas)
        del dark
    return _sheet(frames, base["anims"])


# ----------------------------------------------------------------------------- ships
PLAYER_SHIPS = {
    "fighter": [
        "................",
        "..11............",
        "..122...........",
        "..12233.........",
        ".mm22223333.....",
        "..n2222aa3333...",
        "nnn22222aa22222.",
        "..n2222222222...",
        ".mm222223333....",
        "..12233.........",
        "..122...........",
        "..11............",
    ],
    "interceptor": [
        "................",
        "................",
        "...111..........",
        "....1222........",
        "..nn12222333....",
        ".nnn122aa333333.",
        "nnnn1222aa22222a",
        ".nnn12222222222.",
        "..nn12222333....",
        "....1222........",
        "...111..........",
        "................",
    ],
}


def ship(kind="fighter", seed=0, palette=None, lock_palette=True, main=None):
    rng = random.Random(seed)
    c_main = main or P.shift("#4a7ad8", rng.uniform(-0.5, 0.5) if seed else 0)
    m = P.ramp(c_main, 3)
    cmap = {"1": m[0], "2": m[1], "3": m[2], "a": "#9af0ff", "n": "#5a5e6a", "m": "#c8ccd8"}
    rows = PLAYER_SHIPS.get(kind, PLAYER_SHIPS["fighter"])
    frames = []
    for f in range(2):
        img = px.from_rows(rows, cmap, 16, 14, oy=1)
        if f:
            img[7, 0] = px.rgba("#f0c040")
        frames.append(img)
    frames = _finish(frames, palette, lock=lock_palette)
    return _sheet(frames, {"idle": {"frames": [0, 1], "fps": 10}, "fly": {"frames": [0, 1], "fps": 10}})


def enemy_ship(seed=0, palette=None, lock_palette=True, size=16):
    """Structured random side-view ship facing RIGHT: tapered hull, mirrored fins, cockpit, engine."""
    rng = random.Random(seed * 31 + 7)
    pal = P.resolve(palette) if palette else list(P.PALETTES["neon"])
    body = rng.choice([c for c in pal if 0.3 < P.luma(c) < 0.85 and P.saturation(c) > 0.2] or pal)
    ramp = P.ramp(body, 3)
    trim = P.ramp(rng.choice([c for c in pal if c != body] or pal), 3)
    cockpit = "#9af0ff"
    cy = size // 2
    L = size - 2
    hull = rng.uniform(0.18, 0.32) * size
    nose = rng.uniform(0.45, 0.8)
    img = px.blank(size, size)
    taper = rng.choice([0.6, 0.8, 1.0])
    prof = []
    for x in range(L):
        t = x / (L - 1)
        if t > 1 - nose:
            hh = hull * max(0.0, 1 - (t - (1 - nose)) / nose) ** taper
        else:
            hh = hull * (0.75 + 0.25 * t / max(0.01, 1 - nose))
        prof.append(max(0.6, hh))
    for x, hh in enumerate(prof):
        for y in range(int(cy - hh), int(cy + hh) + 1):
            if 0 <= y < size:
                img[y, x + 1] = px.rgba(ramp[2] if y < cy - hh * 0.35 else ramp[1] if y <= cy + hh * 0.3 else ramp[0])
    # fins: a swept triangle above and below, mirrored
    fx0 = rng.randint(1, max(2, L // 3))
    flen = rng.randint(3, max(4, L // 2))
    fh = rng.uniform(0.25, 0.45) * size
    sweep = rng.choice([-1, 1])
    for i in range(flen):
        t = i / max(1, flen - 1)
        reach = fh * (1 - t) if sweep > 0 else fh * t
        for d in range(int(reach) + 1):
            for sgn in (-1, 1):
                y = int(cy + sgn * (prof[min(L - 1, fx0 + i)] + d))
                x = fx0 + i + 1
                if 0 <= y < size and 0 <= x < size:
                    img[y, x] = px.rgba(trim[1] if d < reach - 1 else trim[2])
    # cockpit and engine
    cx = int(L * rng.uniform(0.55, 0.72))
    img[cy - 1:cy + 1, cx:cx + 2] = px.rgba(cockpit)
    img[cy - 1, cx] = px.rgba("#ffffff")
    frames = [img, img.copy()]
    frames[0][cy, 0] = px.rgba("#f0c040")
    frames[1][cy - 1:cy + 1, 0] = px.rgba("#ffdf7a")
    frames = _finish(frames, palette, lock=lock_palette)
    return _sheet(frames, {"idle": {"frames": [0, 1], "fps": 10}, "fly": {"frames": [0, 1], "fps": 10}})


def boss_ship(seed=0, palette=None, lock_palette=True):
    base = enemy_ship(seed, palette, lock_palette, size=24)
    fw = base["fw"]
    frames = []
    for i in range(base["frames"]):
        f = base["img"][:, i * fw:(i + 1) * fw]
        frames.append(px.upscale(f, 2))
    return _sheet(frames, base["anims"])


# ----------------------------------------------------------------------------- items
def coin(palette=None, color="#f2c14e"):
    c = P.nearest(P.resolve(palette), color) if palette else color
    r = P.ramp(c, 3)
    cmap = {"1": r[0], "2": r[1], "3": r[2], "w": "#ffffff"}
    shapes = [
        [".1111.", "122221", "123w21", "123321", "122221", ".1111."],
        ["..11..", ".1221.", ".13w1.", ".1331.", ".1221.", "..11.."],
        ["..1...", "..1...", "..2...", "..2...", "..1...", "..1..."],
        ["..11..", ".1221.", ".1w31.", ".1331.", ".1221.", "..11.."],
    ]
    frames = []
    for s in shapes:
        img = px.blank(8, 8)
        px.from_rows(s, cmap, ox=1, oy=1, into=img)
        frames.append(img)
    return _sheet(frames, {"spin": {"frames": [0, 1, 2, 3], "fps": 8}, "idle": {"frames": [0, 1, 2, 3], "fps": 8}})


def gem(palette=None, color="#3fc7e0"):
    c = P.nearest(P.resolve(palette), color) if palette else color
    r = P.ramp(c, 3)
    cmap = {"1": r[0], "2": r[1], "3": r[2], "w": "#ffffff"}
    base = ["...22...", "..2332..", ".23w332.", "2333w332", "12233221", ".122221.", "..1221..", "...11..."]
    frames = []
    for i in range(4):
        img = px.from_rows(base, cmap, 10, 10, ox=1, oy=1)
        if i == 1:
            img[2, 4] = px.rgba("#ffffff")
            img[1, 4] = px.rgba("#ffffff")
        frames.append(px.outline(img, "#141018"))
    return _sheet(frames, {"idle": {"frames": [0, 0, 1, 0], "fps": 5}})


def heart(palette=None, color="#e84a5a"):
    c = P.nearest(P.resolve(palette), color) if palette else color
    r = P.ramp(c, 3)
    rows = [".22.22.", "2w33332", "2333332", ".23332.", "..232..", "...2..."]
    img = px.from_rows(rows, {"2": r[1], "3": r[2], "w": "#ffffff"}, 9, 8, ox=1, oy=1)
    return _sheet([px.outline(img, "#141018")], {"idle": {"frames": [0], "fps": 1}})


def potion(palette=None, color="#e84a5a"):
    c = P.nearest(P.resolve(palette), color) if palette else color
    r = P.ramp(c, 3)
    rows = ["..mm..", "..gg..", ".g22g.", "g2w332", "g23332", "g22332", ".gggg."]
    img = px.from_rows(rows, {"m": "#a87a4a", "g": "#c8e0f0", "2": r[1], "3": r[2], "w": "#ffffff"}, 8, 9, ox=1, oy=1)
    return _sheet([px.outline(img, "#141018")], {"idle": {"frames": [0], "fps": 1}})


def flag(palette=None, color="#e84a5a"):
    c = P.nearest(P.resolve(palette), color) if palette else color
    r = P.ramp(c, 3)
    frames = []
    for f in range(2):
        img = px.blank(16, 48)
        img[2:47, 3] = px.rgba("#d8d8e0")
        img[2:47, 4] = px.rgba("#a8a8b8")
        img[0:3, 2:6] = px.rgba("#f0c040")
        rows = ["2222222....", "23333332222", "2333333333.", "2333333322..", "22222222...."] if f == 0 else ["222222.....", "2333332222.", "23333333332", "233333322...", "2222222....."]
        px.from_rows(rows, {"2": r[1], "3": r[2]}, ox=5, oy=4, into=img)
        img[44:48, 1:7] = px.rgba("#6a6a7a")
        frames.append(px.outline(img, "#141018"))
    return _sheet(frames, {"idle": {"frames": [0, 1], "fps": 3}})


# ----------------------------------------------------------------------------- registry
HERO_KINDS = list(HEROES.keys())
CREATURE_KINDS = list(CREATURES.keys()) + ["skeleton", "mutant"]
SHIP_KINDS = list(PLAYER_SHIPS.keys())


def make(kind, seed=0, palette=None, lock_palette=True):
    """Generate any sprite by kind name (hero, creature, ship or item)."""
    k = (kind or "").lower()
    if k in HEROES:
        return hero(k, seed, palette, lock_palette)
    if k in CREATURES or k in ("skeleton", "mutant"):
        return creature(k, seed, palette, lock_palette)
    if k in PLAYER_SHIPS:
        return ship(k, seed, palette, lock_palette)
    if k in ("enemy_ship", "ufo", "saucer"):
        return enemy_ship(seed, palette, lock_palette)
    if k == "boss_ship":
        return boss_ship(seed, palette, lock_palette)
    return {"coin": coin, "gem": gem, "heart": heart, "potion": potion, "flag": flag}.get(k, lambda palette=None: mutant(seed, palette, lock_palette))(palette=palette)


def sprite_to_spec(sprite):
    """Runtime asset dict (PNG data URL) from a sprite dict."""
    return {"src": px.data_url(sprite["img"]), "fw": int(sprite["fw"]), "fh": int(sprite["fh"]), "frames": int(sprite["frames"]),
            "cols": int(sprite.get("cols", sprite["frames"])), "anims": sprite.get("anims", {})}


def sheet_preview(sprite, scale=8):
    return px.preview(sprite["img"], scale=scale)
