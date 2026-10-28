"""Procedural, horizontally tileable parallax backgrounds in a dithered pixel-art style."""
import math
import random

import numpy as np

from . import palettes as P
from . import pixel as px

BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) / 16.0

THEMES = {
    # sky stops (top -> horizon), far color, mid color, near color, features
    "forest": (["#3a6ab0", "#7ab0e0", "#cfe8f0"], "#7a9ab8", "#3f6a4a", "#22402e", ["clouds", "mountains", "pines", "bushes"]),
    "mountains": (["#2a4a8a", "#6a9ad8", "#f0d8c0"], "#8a9ac8", "#5a6aa0", "#2e3a5a", ["sun", "clouds", "mountains", "hills"]),
    "desert": (["#d86a3a", "#f0a85a", "#f8e0a0"], "#d8905a", "#b0603a", "#7a3a2a", ["sun", "mesas", "dunes"]),
    "snow": (["#5a7ab8", "#a8c8e8", "#f0f6ff"], "#b8c8e0", "#4a6a8a", "#dde8f5", ["snowfall", "mountains", "pines"]),
    "cave": (["#0e0a14", "#1e1626", "#2e2438"], "#3a3048", "#4e4060", "#1a141f", ["stalactites", "crystals"]),
    "city": (["#0e0e2a", "#2a1a4a", "#7a3a6a"], "#3a2a5a", "#241a40", "#120e24", ["stars", "moon", "skyline", "skyline_near"]),
    "space": (["#05040e", "#0e0a24", "#1a1038"], "#3a2a6a", "#5a3a8a", "#2a1a4a", ["stars", "nebula", "planet"]),
    "ocean": (["#3a2a6a", "#d8607a", "#f8c070"], "#8a5a8a", "#3a5a8a", "#1a3a5a", ["sun", "clouds", "sea"]),
    "volcano": (["#1a0a0a", "#5a1a12", "#d8501c"], "#4a1e1a", "#2e1210", "#160a0a", ["embers", "volcano", "hills"]),
    "candy": (["#f8a8d0", "#fcd8e8", "#fff4f8"], "#f0b8d8", "#e888b8", "#c06a98", ["clouds", "hills", "lollipops"]),
    "jungle": (["#2a8a9a", "#8ad0b0", "#e0f0c0"], "#4a8a6a", "#2a6a3a", "#173a20", ["clouds", "hills", "palms", "bushes"]),
    "castle": (["#1a1a3a", "#3a3a6a", "#8a6a8a"], "#4a4a6a", "#2e2e48", "#1a1a2e", ["stars", "moon", "towers", "hills"]),
    "sky": (["#4a8ae8", "#8ac0f8", "#e8f4ff"], "#ffffff", "#c8e0f8", "#6a9ad8", ["sun", "clouds", "islands", "clouds_near"]),
    "underwater": (["#0a2a4a", "#14507a", "#2a8aa8"], "#1a4a6a", "#2a6a4a", "#0a2a3a", ["rays", "kelp", "hills"]),
}
THEME_NAMES = list(THEMES.keys())


class Layer:
    def __init__(self, w, h):
        self.img = px.blank(w, h)
        self.w, self.h = w, h

    def put(self, x, y, c):
        y = int(y)
        if 0 <= y < self.h:
            self.img[y, int(x) % self.w] = px.rgba(c)

    def vline(self, x, y0, y1, c):
        y0, y1 = max(0, int(y0)), min(self.h, int(y1))
        if y1 > y0:
            self.img[y0:y1, int(x) % self.w] = px.rgba(c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry), int(cy + ry) + 1):
            if not 0 <= y < self.h:
                continue
            dy = (y - cy) / max(ry, 0.5)
            if abs(dy) > 1:
                continue
            dx = rx * math.sqrt(1 - dy * dy)
            for x in range(int(cx - dx), int(cx + dx) + 1):
                self.img[y, x % self.w] = px.rgba(c)


def _periodic(w, rng, terms=5, amp=1.0, base_freq=1):
    """Tileable 1D height profile: sum of sines with integer frequencies."""
    xs = np.arange(w)
    out = np.zeros(w, dtype=np.float32)
    a = amp
    for k in range(terms):
        f = base_freq * (k + 1) + rng.randint(0, 2)
        out += a * np.sin(2 * math.pi * f * xs / w + rng.uniform(0, 2 * math.pi))
        a *= 0.55
    return out


def _sky(w, h, stops):
    stops = [px.rgba(c)[:3].astype(np.float32) for c in stops]
    img = px.blank(w, h)
    n = len(stops) - 1
    ys = np.arange(h, dtype=np.float32) / max(1, h - 1) * n
    yy, xx = np.mgrid[0:h, 0:w]
    th = BAYER4[yy % 4, xx % 4]
    # quantize the gradient into bands with ordered dithering between neighbours
    bands = 6 * n
    t = ys[:, None] * bands / n + th * 0.999
    idx = np.clip(np.floor(t) / bands * n, 0, n - 1e-6)
    i0 = np.floor(idx).astype(int)
    f = (idx - i0)[..., None]
    a = np.stack([stops[i] for i in range(n + 1)])
    col = a[i0] * (1 - f) + a[np.minimum(i0 + 1, n)] * f
    img[..., :3] = np.clip(col, 0, 255).astype(np.uint8)
    img[..., 3] = 255
    return img


def _fill_profile(layer, heights, color, shade=None, top_light=None):
    for x in range(layer.w):
        top = int(heights[x])
        layer.vline(x, top, layer.h, color)
        if top_light and 0 <= top < layer.h:
            layer.put(x, top, top_light)
        if shade and x % 2 == 0 and top + 3 < layer.h:
            layer.put(x, top + 3, shade)


def _pine(layer, x, base, hgt, c, light):
    for i in range(hgt):
        half = int((i / hgt) * hgt * 0.32) + (1 if i % 3 == 2 else 0)
        y = base - hgt + i
        for dx in range(-half, half + 1):
            layer.put(x + dx, y, light if dx < 0 and i % 3 == 0 else c)
    layer.vline(x, base, base + 3, c)


def _round_tree(layer, x, base, r, c, light):
    layer.vline(x, base - r, base + 2, c)
    layer.ellipse(x, base - r * 1.4, r, r * 0.9, c)
    layer.ellipse(x - r * 0.3, base - r * 1.6, r * 0.5, r * 0.4, light)


def _cloud(layer, x, y, s, c, shade):
    for i in range(4):
        layer.ellipse(x + (i - 1.5) * s * 0.9, y - (s * 0.35 if i in (1, 2) else 0), s * (0.8 if i in (1, 2) else 0.6), s * 0.55, c)
    for dx in range(int(-s * 2.2), int(s * 2.2)):
        layer.put(x + dx, int(y + s * 0.45), shade)


def generate(theme="forest", palette=None, seed=0, w=512, h=270, lock_palette=True):
    theme = theme if theme in THEMES else "forest"
    rng = random.Random(seed * 977 + sum(map(ord, theme)))
    sky_stops, far_c, mid_c, near_c, feats = THEMES[theme]
    pal = P.resolve(palette) if palette else None
    if pal and lock_palette:
        sky_stops = [P.nearest(pal, c) for c in sky_stops]
        if len(set(sky_stops)) < 2:  # palette too small for a gradient: blend toward its extremes
            srt = P.by_luma(pal)
            sky_stops = [srt[min(1, len(srt) - 1)], P.mix(srt[len(srt) // 2], srt[-1], 0.3), srt[-1]]
        far_c, mid_c, near_c = P.mix(P.nearest(pal, far_c), sky_stops[-1], 0.25), P.nearest(pal, mid_c), P.nearest(pal, near_c)
    horizon = sky_stops[-1]
    layers = []
    sky = _sky(w, h, sky_stops)
    skyL = Layer(w, h)
    skyL.img = sky
    if "stars" in feats or theme == "space":
        for _ in range(int(w * h / 260)):
            x, y = rng.randrange(w), rng.randrange(int(h * 0.75))
            b = rng.random()
            skyL.put(x, y, "#ffffff" if b > 0.85 else P.mix("#ffffff", sky_stops[0], 0.5))
            if b > 0.97:
                for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    skyL.put(x + d[0], y + d[1], P.mix("#ffffff", sky_stops[0], 0.6))
    if "nebula" in feats:
        n = px.noise2(w, h, 4, seed, 4)
        tint = np.array(px.rgba(P.nearest(pal, "#c04a9a") if pal else "#c04a9a")[:3], dtype=np.float32)
        tint2 = np.array(px.rgba(P.nearest(pal, "#3a6ad8") if pal else "#3a6ad8")[:3], dtype=np.float32)
        yy, xx = np.mgrid[0:h, 0:w]
        th = BAYER4[yy % 4, xx % 4]
        m1 = (n > 0.6 + th * 0.08)
        m2 = (n < 0.3 - th * 0.05)
        sky[m1, :3] = (sky[m1, :3] * 0.62 + tint * 0.38).astype(np.uint8)
        sky[m2, :3] = (sky[m2, :3] * 0.7 + tint2 * 0.3).astype(np.uint8)
    if "sun" in feats or "moon" in feats:
        sx, sy = rng.randrange(w // 5, w * 4 // 5), int(h * rng.uniform(0.18, 0.35))
        sun_c = "#fff4c0" if "sun" in feats else "#f0f0e0"
        if pal:
            sun_c = P.mix(P.nearest(pal, sun_c), "#ffffff", 0.4)
        r = 18 if "sun" in feats else 12
        skyL.ellipse(sx, sy, r + 5, r + 5, P.mix(sun_c, sky_stops[1], 0.6))
        skyL.ellipse(sx, sy, r, r, sun_c)
        if "moon" in feats:
            skyL.ellipse(sx + 5, sy - 3, r * 0.75, r * 0.75, P.mix(sun_c, sky_stops[0], 0.15))
            skyL.ellipse(sx - 3, sy + 3, 2, 2, P.mix(sun_c, "#000000", 0.12))
    if "rays" in feats:
        ray = P.mix(sky_stops[1], "#ffffff", 0.18)
        yy, xx = np.mgrid[0:h, 0:w]
        th = BAYER4[yy % 4, xx % 4]
        for i in range(5):
            x0, bw = rng.randrange(w), rng.randint(8, 22)
            for y in range(int(h * 0.85)):
                fade = 1 - y / (h * 0.85)
                for k in range(bw):
                    x = int(x0 + y * 0.3 + k) % w
                    if th[y, x] < 0.5 * fade * (1 - abs(k - bw / 2) / (bw / 2)):
                        skyL.put(x, y, ray)
    layers.append({"img": skyL.img, "parallax": 0.0, "fill": True})

    def add(img, parallax, scroll=0.0):
        layers.append({"img": img, "parallax": parallax, "scroll": scroll})

    if "clouds" in feats:
        L = Layer(w, int(h * 0.6))
        cc = P.mix("#ffffff", horizon, 0.15)
        for _ in range(7):
            _cloud(L, rng.randrange(w), rng.randrange(20, int(h * 0.45)), rng.randint(6, 14), cc, P.mix(cc, sky_stops[1], 0.5))
        add(L.img, 0.05, 6)
    if "mountains" in feats or "volcano" in feats or "mesas" in feats:
        L = Layer(w, h)
        if "mesas" in feats:
            hts = np.full(w, h * 0.6)
            x = 0
            while x < w:
                bw = rng.randint(30, 90)
                top = h * rng.uniform(0.38, 0.6)
                for i in range(bw):
                    hts[(x + i) % w] = top + (0 if 3 < i < bw - 4 else (4 - min(i, bw - i - 1)) * 3)
                x += bw + rng.randint(20, 70)
            _fill_profile(L, hts, far_c, top_light=P.mix(far_c, "#ffffff", 0.25))
        else:
            hts = h * 0.5 + _periodic(w, rng, 6, h * 0.12, 2)
            if "volcano" in feats:
                cx = rng.randrange(w)
                for x in range(w):
                    d = min(abs(x - cx), w - abs(x - cx))
                    hts[x] = min(hts[x], h * 0.3 + d * 0.9 if d > 10 else h * 0.3 + 3)
            snow = P.mix(far_c, "#ffffff", 0.7)
            for x in range(w):
                top = int(hts[x])
                L.vline(x, top, h, far_c)
                peak = hts[x] < np.min(hts) + h * 0.08
                if theme in ("snow", "mountains") and peak:
                    L.vline(x, top, top + 3 + (x % 3), snow)
                if "volcano" in feats and hts[x] < h * 0.3 + 6:
                    L.vline(x, top, top + 2, "#f08a2a")
                if (x // 3) % 2 == 0 and x % 7 == 0:
                    L.vline(x, top + 4, top + 12, P.mix(far_c, sky_stops[0], 0.2))
        add(L.img, 0.12)
    if "skyline" in feats or "towers" in feats:
        L = Layer(w, h)
        x = 0
        win = P.nearest(pal, "#f8d870") if pal else "#f8d870"
        while x < w:
            bw = rng.randint(14, 36)
            bh = rng.randint(int(h * 0.2), int(h * 0.5)) if "skyline" in feats else rng.randint(int(h * 0.25), int(h * 0.45))
            top = h - bh - int(h * 0.15)
            for i in range(bw):
                L.vline(x + i, top, h, far_c)
            if "towers" in feats:
                for i in range(-3, bw + 3):
                    hh = int(abs(i - bw / 2) * 1.2)
                    L.vline(x + i, top - 14 + hh, top, far_c)
                for i in range(0, bw, 4):
                    L.vline(x + i, top - 2, top, sky_stops[1])
            for wy in range(top + 4, h - 10, 6):
                for wx in range(x + 3, x + bw - 3, 5):
                    if rng.random() < 0.35:
                        L.put(wx, wy, win)
                        L.put(wx + 1, wy, win)
            x += bw + rng.randint(2, 10)
        add(L.img, 0.18)
    if "planet" in feats:
        L = Layer(w, h)
        pc = P.nearest(pal, "#d86a4a") if pal else "#d86a4a"
        cx, cy, r = rng.randrange(w), int(h * 0.35), rng.randint(22, 40)
        r3 = P.ramp(pc, 3)
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                d = (x - cx) ** 2 + (y - cy) ** 2
                if d <= r * r:
                    lit = (x - cx + r * 0.4) ** 2 + (y - cy + r * 0.4) ** 2 < (r * 0.9) ** 2
                    band = ((y - cy) // 5) % 2 == 0
                    L.put(x, y, r3[2] if lit and band else r3[1] if lit else r3[0])
        for t in range(int(r * 3.4)):
            x = cx - r * 1.7 + t
            y = cy + (t - r * 1.7) * 0.25
            if (x - cx) ** 2 + (y - cy) ** 2 > r * r * 0.85 or y > cy:
                L.put(x, int(y), P.mix(r3[2], "#ffffff", 0.3))
        layers.append({"img": L.img, "parallax": 0.05, "scroll": 2, "nosnap": True})
    if "islands" in feats:
        L = Layer(w, h)
        for _ in range(5):
            cx, cy, s = rng.randrange(w), rng.randint(int(h * 0.3), int(h * 0.6)), rng.randint(14, 30)
            for i in range(-s, s):
                d = s - abs(i)
                L.vline(cx + i, cy, cy + d * 0.7, mid_c)
                L.vline(cx + i, cy - 2, cy, P.nearest(pal, "#5ab03a") if pal else "#5ab03a")
        add(L.img, 0.2)
    # mid layer
    if any(f in feats for f in ("hills", "pines", "dunes", "palms", "lollipops", "kelp")):
        L = Layer(w, h)
        base = h * (0.62 if "dunes" not in feats else 0.66)
        hts = base + _periodic(w, rng, 4, h * 0.05, 3)
        light = P.mix(mid_c, horizon, 0.3)
        _fill_profile(L, hts, mid_c, top_light=light)
        if "pines" in feats:
            x = 0
            while x < w:
                _pine(L, x, int(hts[x % w]) + 2, rng.randint(16, 32), mid_c, light)
                x += rng.randint(7, 16)
        if "palms" in feats:
            for _ in range(6):
                x = rng.randrange(w)
                base_y = int(hts[x])
                hh = rng.randint(24, 40)
                for i in range(hh):
                    L.put(x + int(math.sin(i / hh * 1.5) * 5), base_y - i, mid_c)
                tx, ty = x + int(math.sin(1.5) * 5), base_y - hh
                for a in range(6):
                    ang = a / 6 * math.pi * 2
                    for k in range(12):
                        L.put(tx + math.cos(ang) * k, ty + math.sin(ang) * k * 0.5 + k * k * 0.04, mid_c)
        if "lollipops" in feats:
            for _ in range(7):
                x = rng.randrange(w)
                by = int(hts[x])
                hh = rng.randint(14, 30)
                L.vline(x, by - hh, by, "#f8f0f0")
                c = rng.choice(pal) if pal else rng.choice(["#e84a8a", "#4ac0e8", "#f0c040"])
                L.ellipse(x, by - hh - 6, 7, 7, c)
                L.ellipse(x - 2, by - hh - 8, 2, 2, "#ffffff")
        if "kelp" in feats:
            for _ in range(14):
                x = rng.randrange(w)
                hh = rng.randint(30, 90)
                for i in range(hh):
                    L.put(x + int(math.sin(i * 0.15 + x) * 3), h - i, mid_c)
                    if i % 6 == 0:
                        L.put(x + int(math.sin(i * 0.15 + x) * 3) + 2, h - i, light)
        add(L.img, 0.35)
    if "sea" in feats:
        L = Layer(w, h)
        top = int(h * 0.62)
        sea = P.ramp(mid_c, 3)
        for y in range(top, h):
            for x in range(w):
                k = (y - top) / (h - top)
                c = sea[2] if k < 0.15 else sea[1] if k < 0.55 else sea[0]
                L.put(x, y, c)
                if (x * 5 + y * 11) % 97 == 0 and rng.random() < 0.7:
                    L.put(x, y, P.mix(horizon, "#ffffff", 0.3))
        add(L.img, 0.25)
    if "skyline_near" in feats:
        L = Layer(w, h)
        x = 0
        neon = [P.nearest(pal, c) if pal else c for c in ("#ff3d7f", "#55d4f0", "#ffb03b")]
        while x < w:
            bw = rng.randint(24, 54)
            bh = rng.randint(int(h * 0.25), int(h * 0.55))
            top = h - bh
            for i in range(bw):
                L.vline(x + i, top, h, near_c)
            if rng.random() < 0.6:
                sc = rng.choice(neon)
                for i in range(3, min(bw - 3, 20)):
                    L.put(x + i, top + 6, sc)
                    L.put(x + i, top + 7, sc)
            for wy in range(top + 12, h, 7):
                for wx in range(x + 4, x + bw - 4, 6):
                    if rng.random() < 0.25:
                        L.put(wx, wy, P.mix(neon[1], near_c, 0.5))
            x += bw + rng.randint(4, 16)
        add(L.img, 0.5)
    if "stalactites" in feats:
        L = Layer(w, h)
        top = 12 + _periodic(w, rng, 5, 8, 5)
        bot = h * 0.8 + _periodic(w, rng, 5, 10, 4)
        for x in range(w):
            L.vline(x, 0, top[x], mid_c)
            L.vline(x, bot[x], h, mid_c)
        for _ in range(26):
            x = rng.randrange(w)
            ln = rng.randint(8, 40)
            for i in range(ln):
                half = int((1 - i / ln) * 3)
                for dx in range(-half, half + 1):
                    L.put(x + dx, int(top[x]) + i, mid_c)
        if "crystals" in feats:
            cc = P.nearest(pal, "#6ad8f0") if pal else "#6ad8f0"
            for _ in range(10):
                x = rng.randrange(w)
                by = int(bot[x])
                for i in range(rng.randint(4, 10)):
                    L.put(x, by - i, cc)
                    L.put(x + 1, by - i, P.mix(cc, "#ffffff", 0.5))
        add(L.img, 0.3)
    if "bushes" in feats or "dunes" in feats or "hills" in feats:
        L = Layer(w, int(h * 0.4))
        hts = L.h * 0.55 + _periodic(w, rng, 5, L.h * 0.12, 4)
        light = P.mix(near_c, mid_c, 0.5)
        _fill_profile(L, hts, near_c, top_light=light)
        if "bushes" in feats:
            for _ in range(int(w / 26)):
                x = rng.randrange(w)
                _round_tree(L, x, int(hts[x]) + 4, rng.randint(5, 9), near_c, light)
        add(L.img, 0.6)
    if "clouds_near" in feats:
        L = Layer(w, int(h * 0.5))
        for _ in range(4):
            _cloud(L, rng.randrange(w), rng.randrange(int(L.h * 0.5), L.h - 8), rng.randint(14, 22), "#ffffff", P.mix("#ffffff", sky_stops[1], 0.4))
        add(L.img, 0.7, 10)
    if pal and lock_palette:
        for L in layers[1:]:
            if not L.pop("nosnap", False):
                L["img"] = px.snap(L["img"], pal + [far_c] + sky_stops)
    return {"theme": theme, "layers": layers, "w": w, "h": h, "dark": theme in ("cave", "underwater")}


def from_image(rgba, h=270, w=None, pixelate=True, palette=None, colors=0, darken=0.0):
    """Turn any image into a tileable far layer (mirror-blended seam), optionally pixelated / palette-locked."""
    src_h, src_w = rgba.shape[:2]
    w = w or int(round(src_w * h / src_h))
    w = max(64, min(w, 1024))
    img = px.resize(rgba, w, h)
    img[..., 3] = 255
    # blend the right edge into the left so it tiles
    band = max(8, w // 10)
    left = img[:, :band].astype(np.float32)
    right = img[:, w - band:].astype(np.float32)
    k = np.linspace(0, 1, band, dtype=np.float32)[None, :, None]
    img[:, w - band:] = (right * (1 - k) + left[:, ::-1] * k).clip(0, 255).astype(np.uint8)
    if colors and colors > 1:
        img = px.quantize(img, colors)
    if palette:
        img = px.snap(img, palette)
    if darken:
        img[..., :3] = (img[..., :3].astype(np.float32) * (1 - darken)).astype(np.uint8)
    return {"theme": "image", "layers": [{"img": img, "parallax": 0.0, "fill": True}], "w": w, "h": h}


def composite(bg, w=480, h=270, cam_x=0.0):
    """Flatten layers into one RGBA image (for previews / thumbnails)."""
    out = px.blank(w, h)
    for L in bg["layers"]:
        img = L["img"]
        if L.get("fill"):
            out = px.blit(out, px.resize(img, w, h, smooth=False), 0, 0)
            continue
        iw, ih = img.shape[1], img.shape[0]
        ox = -int(cam_x * L.get("parallax", 0.5)) % iw
        y = h - ih
        x = -ox
        while x < w:
            out = px.blit(out, img, x, y)
            x += iw
    return out


def to_spec(bg):
    return [{"src": px.data_url(L["img"]), "parallax": float(L.get("parallax", 0.5)), "scroll": float(L.get("scroll", 0.0)), "fill": bool(L.get("fill", False))} for L in bg["layers"]]
