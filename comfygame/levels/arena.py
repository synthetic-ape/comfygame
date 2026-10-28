"""Arena survivor stages: an open field with obstacle clusters plus a wave timeline."""
import random

from . import common

PATTERNS = ["ring", "edge", "cluster"]


def generate(seed=0, index=0, total=3, duration=75, difficulty=1.0, enemies=None, boss=False, size=1.0, obstacles=1.0, name=None, theme="grass"):
    rng = random.Random(seed * 6151 + index * 7)
    W, H = int(52 * size), int(38 * size)
    g = [["." for _ in range(W)] for _ in range(H)]
    for x in range(W):
        g[0][x] = g[H - 1][x] = "#"
    for y in range(H):
        g[y][0] = g[y][W - 1] = "#"
    cx, cy = W // 2, H // 2
    clusters = int(rng.uniform(8, 14) * obstacles * size)
    for _ in range(clusters):
        ox, oy = rng.randint(3, W - 5), rng.randint(3, H - 5)
        if abs(ox - cx) < 6 and abs(oy - cy) < 5:
            continue
        shape = rng.choice(["rock", "pillar", "wall_h", "wall_v", "ring"])
        cells = []
        if shape == "rock":
            cells = [(ox + dx, oy + dy) for dx in range(rng.randint(1, 3)) for dy in range(rng.randint(1, 2))]
        elif shape == "pillar":
            cells = [(ox, oy), (ox + 1, oy), (ox, oy + 1), (ox + 1, oy + 1)]
        elif shape == "wall_h":
            cells = [(ox + i, oy) for i in range(rng.randint(4, 7))]
        elif shape == "wall_v":
            cells = [(ox, oy + i) for i in range(rng.randint(3, 6))]
        else:
            cells = [(ox + dx, oy + dy) for dx in range(4) for dy in range(4) if dx in (0, 3) or dy in (0, 3)]
            cells = [c for c in cells if c not in ((ox + 1, oy + 3), (ox + 2, oy + 3), (ox, oy + 1))]
        for x, y in cells:
            if 1 <= x < W - 1 and 1 <= y < H - 1:
                g[y][x] = "#"
    g[cy][cx] = "P"
    nE = max(1, len(enemies or [1]))
    ramp = difficulty * (0.8 + 0.5 * index / max(1, total - 1))
    waves = []
    t = 1.5
    i = 0
    while t < duration - 3:
        unlocked = min(nE, 1 + int((t / duration) * nE * 1.2) + index)
        waves.append({"t": round(t, 1), "enemy": rng.randrange(unlocked), "count": int(4 + t / 9 * ramp + index * 2), "pattern": PATTERNS[i % 3] if rng.random() < 0.7 else rng.choice(PATTERNS)})
        t += rng.uniform(5, 9) / (0.8 + ramp * 0.2)
        i += 1
    return {"kind": "arena", "name": name or common.level_name(rng, theme, index, "arena"), "tiles": ["".join(r) for r in g],
            "duration": int(duration), "waves": waves, "boss": bool(boss), "bg": "main"}


COLORS = {"#": (110, 100, 120), ".": (46, 60, 44), "P": (80, 255, 120)}


def preview(level, scale=4):
    img = common.render_grid(level["tiles"], COLORS, scale)
    # wave timeline strip under the map
    import numpy as np
    w = img.shape[1]
    strip = np.zeros((14, w, 4), dtype=np.uint8)
    strip[..., 3] = 255
    strip[..., :3] = (16, 14, 22)
    dur = max(1, level.get("duration", 60))
    for wv in level.get("waves", []):
        x = int(wv["t"] / dur * (w - 4)) + 2
        hgt = min(12, 2 + wv["count"] // 2)
        strip[14 - hgt:, x:x + 2, :3] = (255, 90, 160)
    if level.get("boss"):
        strip[:, w - 5:w - 1, :3] = (255, 40, 60)
    return common.stack_previews([img, strip], gap=2)
