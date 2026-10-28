"""Procedural 16x16 tilesets (8x8 grid). Index layout is shared with the runtime:

 0-15  platformer solid autotile (bitmask of exposed sides: up=1 right=2 down=4 left=8)
 16-18 one-way platform (left, middle, right)    19 spikes
 20 ?-block   21 used block   22 crumble block   23 spring   24 spring (pressed)
 25-27 surface decorations    28 liquid surface  29 liquid body
 32-47 top-down wall autotile (same bitmask)     48-51 floor variants   52-55 floor decorations
 57 stairs   58 chest   59 open chest   60 trap (down)   61 trap (up)
"""
import random

import numpy as np

from . import palettes as P
from . import pixel as px

TS = 16
COLS = 8

STYLES = {
    #          fill        top         floor       liquid     texture  decor
    "grass": ("#7a4e2d", "#58a83e", "#5f8a3a", "#3a7ad8", "dirt", "grass"),
    "stone": ("#6a6a78", "#9a9aa8", "#55555f", "#3a7ad8", "brick", "rock"),
    "snow": ("#5a6a8a", "#f0f6ff", "#c8d8ea", "#5aa0d8", "dirt", "snow"),
    "sand": ("#c88a4a", "#f0cc80", "#e0b06a", "#3aa0c8", "dirt", "cactus"),
    "tech": ("#3a4458", "#7a8aa8", "#2a3242", "#40e0d0", "panel", "tech"),
    "cave": ("#4a3a4a", "#6a5a6a", "#3a2e3a", "#4a8ad8", "rough", "crystal"),
    "candy": ("#e88aa8", "#fff0f6", "#f4b8cc", "#ff6aa8", "dirt", "candy"),
    "brick": ("#9a4a3a", "#c87a5a", "#6a4a3a", "#3a7ad8", "brick", "rock"),
    "wood": ("#8a5a32", "#b88050", "#7a5030", "#3a7ad8", "plank", "grass"),
    "ice": ("#4a7aa8", "#dff6ff", "#a8d8f0", "#2a5ab8", "rough", "crystal"),
    "lava": ("#3a2a2e", "#6a4a40", "#2e2226", "#f05a1a", "rough", "ember"),
    "jungle": ("#5a3a22", "#3a9a3a", "#3f6a2a", "#2a8a9a", "dirt", "grass"),
    "dungeon": ("#4a4a5a", "#6e6e80", "#3a3440", "#3a6ad8", "brick", "bones"),
}
STYLE_NAMES = list(STYLES.keys())


def _rgba(c, a=255):
    return px.rgba(c, a)


class _T:
    def __init__(self, rng, pal):
        self.rng = rng
        self.pal = pal

    def c(self, color):
        return P.nearest(self.pal, color) if self.pal else color


def _texture(kind, ramp, rng, w=TS, h=TS, ox=0):
    """Fill texture for solid ground (3-color ramp dark->light)."""
    img = px.blank(w, h)
    img[...] = _rgba(ramp[1])
    if kind == "brick":
        for y in range(h):
            row = y // 4
            for x in range(w):
                off = 4 if row % 2 else 0
                if y % 4 == 3 or (x + off + ox) % 8 == 7:
                    img[y, x] = _rgba(ramp[0])
                elif y % 4 == 0 and (x + off + ox) % 8 != 6:
                    img[y, x] = _rgba(ramp[2])
    elif kind == "panel":
        img[...] = _rgba(ramp[1])
        img[0, :] = _rgba(ramp[2]); img[:, 0] = _rgba(ramp[2])
        img[h - 1, :] = _rgba(ramp[0]); img[:, w - 1] = _rgba(ramp[0])
        for (x, y) in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)):
            img[y, x] = _rgba(ramp[2])
        img[7:9, 5:11] = _rgba(ramp[0])
    elif kind == "plank":
        for y in range(h):
            for x in range(w):
                if y % 5 == 4:
                    img[y, x] = _rgba(ramp[0])
                elif (x + (y // 5) * 7 + ox) % 13 == 0:
                    img[y, x] = _rgba(ramp[0])
                elif rng.random() < 0.06:
                    img[y, x] = _rgba(ramp[2])
    else:  # dirt / rough: speckles and pebbles
        for y in range(h):
            for x in range(w):
                r = rng.random()
                if r < (0.1 if kind == "dirt" else 0.16):
                    img[y, x] = _rgba(ramp[0])
                elif r > 0.93:
                    img[y, x] = _rgba(ramp[2])
        for _ in range(2 if kind == "dirt" else 4):
            x, y = rng.randrange(1, w - 2), rng.randrange(1, h - 2)
            img[y:y + 2, x:x + 2] = _rgba(ramp[0] if kind == "rough" else ramp[2])
            img[y, x] = _rgba(ramp[2])
    return img


def _solid(mask, style, ramps, rng):
    fill_r, top_r = ramps["fill"], ramps["top"]
    kind = STYLES[style][4]
    img = _texture(kind, fill_r, rng)
    dark = ramps["outline"]
    if mask & 1:  # exposed top: surface cap with a jagged lip
        cap = 4 if style in ("grass", "jungle", "snow", "candy") else 3
        for x in range(TS):
            lip = cap + (1 if (x * 7 + rng.randrange(3)) % 5 == 0 else 0)
            img[0:lip, x] = _rgba(top_r[1])
            img[0, x] = _rgba(top_r[2])
            if style in ("grass", "jungle") and x % 3 == 1:
                img[lip, x] = _rgba(top_r[0])
            if style == "candy" and x % 4 == 0:
                img[lip, x] = _rgba(top_r[1])
        if style == "snow":
            for x in range(0, TS, 5):
                img[cap:cap + 2, x] = _rgba(top_r[1])
    if mask & 4:
        img[TS - 2:TS, :] = _rgba(fill_r[0])
    if mask & 8:
        img[:, 0] = _rgba(dark)
        img[(4 if mask & 1 else 0):, 1] = _rgba(fill_r[2])
    if mask & 2:
        img[:, TS - 1] = _rgba(dark)
        img[:, TS - 2] = _rgba(fill_r[0]) if not (mask & 1) else img[:, TS - 2]
    if mask & 1:
        img[0, :] = _rgba(dark)
        if mask & 8:
            img[0:2, 0:2] = 0; img[1, 1] = _rgba(dark); img[2, 0] = _rgba(dark); img[0, 2] = _rgba(dark)
        if mask & 2:
            img[0:2, TS - 2:TS] = 0; img[1, TS - 2] = _rgba(dark); img[2, TS - 1] = _rgba(dark); img[0, TS - 3] = _rgba(dark)
    if mask & 4:
        img[TS - 1, :] = _rgba(dark)
        if mask & 8:
            img[TS - 1, 0] = 0
        if mask & 2:
            img[TS - 1, TS - 1] = 0
    return img


def _wall_td(mask, ramps, rng, style):
    """Top-down wall in 3/4 view: lit top face, darker front face where the floor is below."""
    top_r, fill_r = ramps["top"], ramps["fill"]
    dark = ramps["outline"]
    kind = STYLES[style][4]
    face_h = 6 if mask & 4 else 0
    img = px.blank(TS, TS)
    tex = _texture("rough" if kind in ("dirt", "rough") else kind, [fill_r[0], top_r[0], top_r[1]], rng)
    img[...] = tex
    if face_h:
        front = _texture(kind if kind != "dirt" else "brick", fill_r, rng)
        img[TS - face_h:, :] = front[TS - face_h:, :]
        img[TS - face_h, :] = _rgba(top_r[2])
        img[TS - 1, :] = _rgba(dark)
    if mask & 1:
        img[0, :] = _rgba(dark); img[1, :] = _rgba(top_r[2])
    if mask & 8:
        img[:, 0] = _rgba(dark); img[:TS - face_h, 1] = _rgba(top_r[2])
    if mask & 2:
        img[:, TS - 1] = _rgba(dark)
    return img


def _floor(ramps, rng, style, variant):
    fl = ramps["floor"]
    kind = STYLES[style][4]
    img = px.blank(TS, TS)
    img[...] = _rgba(fl[1])
    for y in range(TS):
        for x in range(TS):
            r = rng.random()
            if r < 0.07:
                img[y, x] = _rgba(fl[0])
            elif r > 0.95:
                img[y, x] = _rgba(fl[2])
    if kind in ("brick", "panel", "plank") or style in ("dungeon", "tech", "stone"):
        grout = P.mix(fl[1], fl[0], 0.55)
        if kind == "plank":
            for y in (5, 10, 15):
                img[y, :] = _rgba(grout)
            img[0:5, (variant * 5 + 3) % TS] = _rgba(grout)
            img[6:10, (variant * 5 + 11) % TS] = _rgba(grout)
        else:
            img[TS - 1, :] = _rgba(grout); img[:, TS - 1] = _rgba(grout)
            if kind == "panel":
                img[0, :] = _rgba(P.mix(fl[1], fl[2], 0.5)); img[:, 0] = _rgba(P.mix(fl[1], fl[2], 0.5))
            if variant == 1:
                img[7, :] = _rgba(grout)
    if variant == 3:
        for i in range(rng.randint(3, 6)):
            x, y = rng.randrange(2, TS - 2), rng.randrange(2, TS - 2)
            img[y, x] = _rgba(fl[0])
    return img


def _decor(ramps, rng, style, i):
    img = px.blank(TS, TS)
    d = STYLES[style][5]
    acc = ramps["accent"]
    if d in ("grass", "snow", "candy"):
        g = ramps["top"]
        if i == 0:
            for x in (5, 7, 9, 10):
                h = rng.randint(2, 4)
                img[TS - h:TS, x] = _rgba(g[1]); img[TS - h, x] = _rgba(g[2])
        elif i == 1:
            img[12:16, 7] = _rgba(g[0])
            px.from_rows([".a.", "aca", ".a."], {"a": acc[1], "c": "#fff4b0"}, ox=6, oy=9, into=img)
        else:
            px.from_rows(["..22..", ".2332.", "122221"], {"1": ramps["fill"][0], "2": ramps["fill"][1], "3": ramps["fill"][2]}, ox=5, oy=13, into=img)
    elif d == "cactus":
        c = P.ramp("#4a9a3a", 3)
        if i == 0:
            px.from_rows([".2.", "232", "232", "222", "222"], {"2": c[1], "3": c[2]}, ox=7, oy=11, into=img)
        else:
            px.from_rows(["..22..", ".2332.", "122221"], {"1": ramps["fill"][0], "2": ramps["fill"][1], "3": ramps["fill"][2]}, ox=5, oy=13, into=img)
    elif d in ("crystal", "ember"):
        c = acc
        px.from_rows([".3.", "323", "232", "222"], {"2": c[0], "3": c[2]}, ox=6 + i, oy=12, into=img)
    elif d == "tech":
        if i == 0:
            img[10:16, 7] = _rgba("#8a8a98"); img[9, 6:9] = _rgba(acc[2])
        else:
            img[13:16, 4:12] = _rgba("#5a5e6a"); img[13, 5:11] = _rgba("#8a8a98"); img[14, 6] = _rgba(acc[2])
    else:  # rock / bones
        if d == "bones" and i == 1:
            px.from_rows(["w..w", ".ww.", "w..w"], {"w": "#e8e4d8"}, ox=6, oy=12, into=img)
        else:
            px.from_rows(["..22..", ".2332.", "122221"], {"1": ramps["fill"][0], "2": ramps["fill"][1], "3": ramps["fill"][2]}, ox=5, oy=13, into=img)
    return px.outline(img, ramps["outline"]) if img[..., 3].any() else img


def _platform(ramps, part):
    r = ramps["plat"]
    img = px.blank(TS, TS)
    img[0:5, :] = _rgba(r[1])
    img[0, :] = _rgba(r[2])
    img[4, :] = _rgba(r[0])
    for x in range(0, TS, 8):
        img[1:4, x] = _rgba(r[0])
    if part == 0:
        img[0:5, 0] = _rgba(ramps["outline"]); img[5:8, 3] = _rgba(r[0])
    if part == 2:
        img[0:5, TS - 1] = _rgba(ramps["outline"]); img[5:8, TS - 4] = _rgba(r[0])
    img[5, :] = 0
    return img


def _spikes(ramps):
    m = P.ramp("#c8ccd8", 3)
    img = px.blank(TS, TS)
    for i in range(4):
        cx = i * 4 + 2
        for y in range(6):
            half = y // 2
            img[9 + y, cx - half:cx + half + 1] = _rgba(m[1])
            img[9 + y, cx - half] = _rgba(m[2])
    img[15, :] = _rgba(m[0])
    return px.outline(img, ramps["outline"])


def _block(ramps, kind):
    img = px.blank(TS, TS)
    if kind == "q":
        g = ramps["gold"]
        img[1:15, 1:15] = _rgba(g[1]); img[1, 1:15] = _rgba(g[2]); img[1:15, 1] = _rgba(g[2]); img[14, 1:15] = _rgba(g[0]); img[1:15, 14] = _rgba(g[0])
        px.from_rows([".www.", "w...w", "...w.", "..w..", ".....", "..w.."], {"w": "#ffffff"}, ox=6, oy=4, into=img)
        for (x, y) in ((2, 2), (13, 2), (2, 13), (13, 13)):
            img[y, x] = _rgba(g[0])
    elif kind == "used":
        f = ramps["fill"]
        img[1:15, 1:15] = _rgba(f[0]); img[1, 1:15] = _rgba(f[1]); img[1:15, 1] = _rgba(f[1])
    else:  # crumble
        f = ramps["fill"]
        img[1:15, 1:15] = _rgba(f[1]); img[1, 1:15] = _rgba(f[2])
        for (x, y) in ((4, 3), (5, 4), (6, 5), (10, 8), (9, 9), (10, 10), (3, 11), (4, 12)):
            img[y, x] = _rgba(f[0])
    img[0, 1:15] = img[15, 1:15] = _rgba(ramps["outline"])
    img[1:15, 0] = img[1:15, 15] = _rgba(ramps["outline"])
    return img


def _spring(ramps, pressed):
    r = ramps["accent"]
    m = P.ramp("#c8ccd8", 3)
    img = px.blank(TS, TS)
    top = 9 if pressed else 4
    img[top:top + 3, 2:14] = _rgba(r[1]); img[top, 2:14] = _rgba(r[2])
    for y in range(top + 3, 14):
        img[y, 5 if y % 2 else 10] = _rgba(m[1]); img[y, 6:10] = _rgba(m[0]) if y % 2 else 0
    img[14:16, 3:13] = _rgba(m[0])
    return px.outline(img, ramps["outline"])


def _liquid(ramps, surface, rng):
    lq = ramps["liquid"]
    img = px.blank(TS, TS)
    img[...] = _rgba(lq[1])
    for y in range(TS):
        for x in range(TS):
            if (x + y * 3) % 11 == 0 and rng.random() < 0.6:
                img[y, x] = _rgba(lq[2])
    if surface:
        img[0:3, :] = 0
        for x in range(TS):
            h = 3 + (1 if (x // 3) % 2 else 0)
            img[3 - (1 if (x // 3) % 2 else 0), x] = _rgba(lq[2])
            img[h - 1:h, x] = _rgba(lq[2])
        img[:2, :] = 0
    return img


def _stairs(ramps):
    f = ramps["floor"]
    img = px.blank(TS, TS)
    img[...] = _rgba("#0a0810")
    for i in range(4):
        y = 2 + i * 3
        img[y:y + 2, 2 + i:14 - i] = _rgba(f[2] if i == 0 else f[1])
        img[y + 2, 2 + i:14 - i] = _rgba(f[0])
    img[0, :] = img[15, :] = _rgba(ramps["outline"]); img[:, 0] = img[:, 15] = _rgba(ramps["outline"])
    return img


def _chest(ramps, opened):
    w = P.ramp("#9a5a2a", 3)
    g = ramps["gold"]
    img = px.blank(TS, TS)
    if not opened:
        img[5:9, 2:14] = _rgba(w[2]); img[5, 2:14] = _rgba(g[2])
        img[9:14, 2:14] = _rgba(w[1]); img[13, 2:14] = _rgba(w[0])
        img[5:14, 2] = _rgba(g[1]); img[5:14, 13] = _rgba(g[1])
        img[8:11, 7:9] = _rgba(g[2]); img[10, 7:9] = _rgba(g[0])
    else:
        img[2:6, 2:14] = _rgba(w[0]); img[2, 2:14] = _rgba(g[1])
        img[6:9, 3:13] = _rgba("#1a1018")
        img[7, 5] = _rgba(g[2]); img[7, 9] = _rgba(g[2])
        img[9:14, 2:14] = _rgba(w[1]); img[13, 2:14] = _rgba(w[0])
        img[9:14, 2] = _rgba(g[1]); img[9:14, 13] = _rgba(g[1])
    return px.outline(img, ramps["outline"])


def _trap(ramps, up):
    f = ramps["floor"]
    m = P.ramp("#c8ccd8", 3)
    img = px.blank(TS, TS)
    img[2:14, 2:14] = _rgba(f[0])
    for y in (4, 8, 12):
        for x in (4, 8, 12):
            img[y, x] = _rgba("#000000")
            if up:
                img[y - 3:y, x] = _rgba(m[1]); img[y - 3, x] = _rgba(m[2])
    return img


def generate(style="grass", palette=None, seed=0, lock_palette=True):
    style = style if style in STYLES else "grass"
    rng = random.Random(seed * 101 + sum(map(ord, style)))
    pal = P.resolve(palette) if palette else None
    fill, top, floor, liquid = STYLES[style][:4]
    if pal and lock_palette:
        # pull the style toward the palette so tiles match the rest of the game
        fill, top, floor = P.nearest(pal, fill), P.nearest(pal, top), P.nearest(pal, floor)
        liquid = P.nearest(pal, liquid)
    outline = P.by_luma(pal)[0] if pal else "#141018"
    if P.luma(outline) > 0.25:
        outline = "#141018"
    accent = P.theme_colors(pal)["accent"] if pal else "#e84a5a"
    ramps = {
        "fill": P.ramp(fill, 3), "top": P.ramp(top, 3), "floor": P.ramp(floor, 3), "liquid": P.ramp(liquid, 3),
        "plat": P.ramp(P.mix(top, fill, 0.5), 3), "gold": P.ramp(P.nearest(pal, "#f0c040") if pal else "#f0c040", 3),
        "accent": P.ramp(accent, 3), "outline": outline,
    }
    tiles = [px.blank(TS, TS) for _ in range(64)]
    for m in range(16):
        tiles[m] = _solid(m, style, ramps, random.Random(seed * 7 + m))
        tiles[32 + m] = _wall_td(m, ramps, random.Random(seed * 11 + m), style)
    for i in range(3):
        tiles[16 + i] = _platform(ramps, i)
    tiles[19] = _spikes(ramps)
    tiles[20] = _block(ramps, "q")
    tiles[21] = _block(ramps, "used")
    tiles[22] = _block(ramps, "crumble")
    tiles[23] = _spring(ramps, False)
    tiles[24] = _spring(ramps, True)
    for i in range(3):
        tiles[25 + i] = _decor(ramps, random.Random(seed + i), style, i)
    tiles[28] = _liquid(ramps, True, rng)
    tiles[29] = _liquid(ramps, False, rng)
    for i in range(4):
        tiles[48 + i] = _floor(ramps, random.Random(seed * 13 + i), style, i)
        tiles[52 + i] = _decor(ramps, random.Random(seed * 17 + i), style, i % 3)
    tiles[57] = _stairs(ramps)
    tiles[58] = _chest(ramps, False)
    tiles[59] = _chest(ramps, True)
    tiles[60] = _trap(ramps, False)
    tiles[61] = _trap(ramps, True)
    if pal and lock_palette:
        tiles = [px.snap(t, pal + ["#141018", "#0a0810", "#ffffff"]) if t[..., 3].any() else t for t in tiles]
    sheet = px.grid(tiles, COLS)
    return {"img": sheet, "size": TS, "cols": COLS, "style": style, "liquid": "lava" if style == "lava" else "water"}


def tiles_from_texture(texture_rgba, style="grass", palette=None, seed=0):
    """Build a tileset whose fill / floor uses a texture (e.g. an AI-generated material), edges stay procedural."""
    base = generate(style, palette, seed)
    tex = px.resize(texture_rgba, TS, TS)
    tex[..., 3] = 255
    sheet = base["img"].copy()
    for idx in list(range(16)) + list(range(32, 52)):
        x0, y0 = (idx % COLS) * TS, (idx // COLS) * TS
        tile = sheet[y0:y0 + TS, x0:x0 + TS].copy()
        mixed = tile.copy()
        # keep the procedural edges / caps (outline + top rows), replace the interior texture
        interior = np.ones((TS, TS), dtype=bool)
        if idx < 16 and idx & 1:
            interior[:5, :] = False
        interior[0, :] = interior[-1, :] = False
        interior[:, 0] = interior[:, -1] = False
        if 32 <= idx < 48 and (idx - 32) & 4:
            tex2 = (tex.astype(np.int32) * 0.65).astype(np.uint8)
            tex2[..., 3] = 255
            lower = np.zeros((TS, TS), dtype=bool)
            lower[10:, :] = True
            mixed[interior & lower] = tex2[interior & lower]
            mixed[interior & ~lower] = tex[interior & ~lower]
        else:
            m = interior & (tile[..., 3] > 0)
            mixed[m] = tex[m]
        sheet[y0:y0 + TS, x0:x0 + TS] = mixed
    base["img"] = sheet
    return base


def preview(tileset, scale=4):
    return px.preview(tileset["img"], scale=scale)


def to_spec(tileset):
    return {"src": px.data_url(tileset["img"]), "size": int(tileset["size"]), "cols": int(tileset["cols"]), "liquid": tileset.get("liquid", "water")}
