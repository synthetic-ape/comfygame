"""Curated palettes and color helpers. Everything here is plain Python (no numpy needed)."""
import colorsys
import math
import re

PALETTES = {
    "forest": ["#141b1e", "#22313a", "#2f4f3a", "#3f7a3f", "#7ab04a", "#c7e07a", "#f2efc8", "#6e4a30", "#a9733f", "#e2b073", "#4b7bb0", "#9fd3ea", "#d95a4a", "#f2c14e"],
    "pico8": ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
    "sweetie16": ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"],
    "desert": ["#22160f", "#4a2a1c", "#7d4428", "#b8673a", "#de9a52", "#f2cd8a", "#faf0d2", "#5b7c8c", "#9cc6d0", "#2f4858", "#c8463a", "#7f9a52"],
    "neon": ["#0d0221", "#1b0a3c", "#3a0f6b", "#7a1c8c", "#c4248f", "#ff2a6d", "#ff8f5f", "#fdd85d", "#05d9e8", "#01ffc3", "#d1f7ff", "#ffffff"],
    "ice": ["#0a1424", "#16304f", "#245580", "#3f86b4", "#7cc0e0", "#bfe7f6", "#f2fbff", "#6a5acd", "#b8a8ff", "#2e3a56", "#e05a7a", "#ffd27a"],
    "lava": ["#110808", "#2e0f0f", "#5c1613", "#9b2a17", "#d8501c", "#f68b2c", "#ffc94a", "#fff1b8", "#3a3640", "#6a6476", "#a7a0b4", "#59c2d9"],
    "candy": ["#2b1838", "#5a2a6d", "#9e468e", "#e76fa6", "#ffadc8", "#ffe0ec", "#7ad6c1", "#c4f2e2", "#ffd36b", "#fff6d8", "#6a7fdb", "#ff7a5c"],
    "ocean": ["#08131f", "#0f2d45", "#16506d", "#20798f", "#3fb0b4", "#97e6dc", "#effff6", "#f6c56f", "#e2785c", "#3a3d5a", "#ff9fb2", "#7ad36a"],
    "spooky": ["#0c0a14", "#1c1430", "#341e4c", "#5e2a66", "#93447f", "#d8853a", "#f2cf63", "#c4e19a", "#62a46a", "#2b5546", "#e6e0d4", "#9e1f3a"],
    "sunset": ["#190e30", "#381747", "#702657", "#b83f5a", "#ec7348", "#f9ad55", "#ffdf88", "#fff5d6", "#4462a0", "#86aed8", "#3d2a2a", "#7ab36a"],
    "gameboy": ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
    "noir": ["#0a0a0d", "#202028", "#3c3c48", "#64646f", "#9a9aa6", "#d0d0d8", "#ffffff", "#c0392b", "#e6b450"],
    "jungle": ["#0e1a12", "#173322", "#22502c", "#2f7a35", "#58a83e", "#a7d65a", "#f1f5b0", "#7a4a26", "#c07a3a", "#f0b45a", "#e04848", "#4ab0d0", "#a060c0"],
    "cyber": ["#070b12", "#121e2e", "#1c3554", "#265a86", "#2f8fbf", "#55d4f0", "#c6f8ff", "#ff3d7f", "#ffb03b", "#7cff6b", "#8a5cff", "#f4f4f8"],
    "autumn": ["#1c120e", "#3a2318", "#6a3a22", "#a8582c", "#d88438", "#f0b84e", "#f8e3a0", "#7a8a3a", "#4a5a2a", "#8a3a3a", "#4e6a8a", "#f2f0e6"],
}

DEFAULT_PALETTE = "forest"


def hex_to_rgb(h):
    h = str(h).strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except (ValueError, IndexError):
        return (255, 0, 255)


def rgb_to_hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb[:3])


def luma(c):
    r, g, b = hex_to_rgb(c) if isinstance(c, str) else c
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def _lab(rgb):
    # sRGB -> CIELAB (D65), good enough for nearest-color matching
    def lin(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


_lab_cache = {}


def lab(c):
    key = c if isinstance(c, str) else tuple(c)
    if key not in _lab_cache:
        _lab_cache[key] = _lab(hex_to_rgb(c) if isinstance(c, str) else tuple(c[:3]))
    return _lab_cache[key]


def nearest(palette, color):
    """Closest palette color (perceptual) to `color` (hex or rgb)."""
    target = lab(color)
    return min(palette, key=lambda p: sum((a - b) ** 2 for a, b in zip(lab(p), target)))


def shift(color, dh=0.0, ds=0.0, dv=0.0):
    r, g, b = (v / 255.0 for v in (hex_to_rgb(color) if isinstance(color, str) else color))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h = (h + dh) % 1.0
    s = max(0.0, min(1.0, s + ds))
    v = max(0.0, min(1.0, v + dv))
    return rgb_to_hex(tuple(c * 255 for c in colorsys.hsv_to_rgb(h, s, v)))


def mix(a, b, t):
    ra, rb = hex_to_rgb(a), hex_to_rgb(b)
    return rgb_to_hex(tuple(x + (y - x) * t for x, y in zip(ra, rb)))


def ramp(base, n=3):
    """Pixel-art shading ramp dark -> light with hue shifting (cool shadows, warm highlights)."""
    r, g, b = (v / 255.0 for v in hex_to_rgb(base))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    out = []
    for i in range(n):
        k = (i - (n - 1) / 2) / max(1, (n - 1) / 2)  # -1 .. 1
        hh = h + (-0.035 * k if 0.08 < h < 0.6 else 0.035 * k)  # toward blue in shadow, toward yellow in light
        ss = s * (1 + 0.15 * (-k)) if s > 0.05 else s
        vv = v * (1 + 0.32 * k) if k > 0 else v * (1 + 0.42 * k)
        out.append(rgb_to_hex(tuple(c * 255 for c in colorsys.hsv_to_rgb(hh % 1, max(0, min(1, ss)), max(0.04, min(1, vv))))))
    return out


_HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def valid_color(c):
    if isinstance(c, (list, tuple)) and len(c) >= 3:
        return all(isinstance(v, (int, float)) and 0 <= v <= 255 for v in c[:3])
    return isinstance(c, str) and bool(_HEX.match(c.strip()))


def resolve(palette):
    """Accept a preset name, a list of colors, or a comma/space separated string. Invalid entries are dropped."""
    if palette is None:
        return list(PALETTES[DEFAULT_PALETTE])
    if isinstance(palette, dict) and "colors" in palette:
        palette = palette["colors"]
    if isinstance(palette, (list, tuple)):
        if len(palette) == 1 and isinstance(palette[0], str) and palette[0].strip().lower() in PALETTES:
            return list(PALETTES[palette[0].strip().lower()])
        cols = [rgb_to_hex(c) if isinstance(c, (list, tuple)) else rgb_to_hex(hex_to_rgb(c)) for c in palette if valid_color(c)]
        return list(dict.fromkeys(cols)) if len(cols) >= 3 else list(PALETTES[DEFAULT_PALETTE])
    s = str(palette).strip()
    if s.lower() in PALETTES:
        return list(PALETTES[s.lower()])
    cols = [rgb_to_hex(hex_to_rgb(p)) for p in s.replace(",", " ").replace(";", " ").split() if valid_color(p)]
    return list(dict.fromkeys(cols)) if len(cols) >= 3 else list(PALETTES[DEFAULT_PALETTE])


def by_luma(palette):
    return sorted(palette, key=luma)


def saturation(c):
    r, g, b = hex_to_rgb(c)
    return (max(r, g, b) - min(r, g, b)) / 255.0


def pick(palette, target, min_luma=None, max_luma=None):
    cands = [c for c in palette if (min_luma is None or luma(c) >= min_luma) and (max_luma is None or luma(c) <= max_luma)]
    return nearest(cands or palette, target)


def theme_colors(palette):
    """Roles used by the runtime theme + generators."""
    pal = resolve(palette)
    srt = by_luma(pal)
    vivid = sorted(pal, key=lambda c: -saturation(c) * (0.4 + luma(c)))
    return {
        "dark": srt[0], "light": srt[-1], "mid": srt[len(srt) // 2],
        "accent": vivid[0], "accent2": vivid[1] if len(vivid) > 1 else vivid[0],
    }


def hue_distance(a, b):
    ha = colorsys.rgb_to_hsv(*(v / 255 for v in hex_to_rgb(a)))[0]
    hb = colorsys.rgb_to_hsv(*(v / 255 for v in hex_to_rgb(b)))[0]
    d = abs(ha - hb)
    return min(d, 1 - d)


def distinct(palette, n, seed_color=None):
    """Pick n mutually distinct, saturated colors from the palette."""
    pool = sorted(resolve(palette), key=lambda c: -saturation(c))
    out = [seed_color] if seed_color else []
    for c in pool:
        if len(out) >= n:
            break
        if all(math.sqrt(sum((x - y) ** 2 for x, y in zip(lab(c), lab(o)))) > 28 for o in out):
            out.append(c)
    while len(out) < n:
        out.append(pool[len(out) % len(pool)])
    return out[:n]
