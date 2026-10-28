"""Shmup stages: a timeline of enemy formations that tightens with difficulty, then a boss."""
import random

import numpy as np

from . import common

PATTERNS = ["line", "sine", "v", "dive", "column", "turret", "swarm", "circle"]


def generate(seed=0, index=0, total=3, length=70, difficulty=1.0, enemies=None, boss=True, density=1.0, name=None, theme="space"):
    rng = random.Random(seed * 2741 + index * 31)
    nE = max(1, len(enemies or [1]))
    ramp = difficulty * (0.8 + 0.6 * index / max(1, total - 1))
    waves = []
    t = 1.5
    i = 0
    unlocked_pats = 3 + index * 2
    while t < length - 2:
        pat = PATTERNS[i % min(len(PATTERNS), unlocked_pats)] if rng.random() < 0.6 else rng.choice(PATTERNS[:min(len(PATTERNS), unlocked_pats)])
        waves.append({"t": round(t, 2), "pattern": pat, "enemy": rng.randrange(min(nE, 1 + i // 3 + index)), "count": rng.randint(3, 5) + int(ramp), "y": round(rng.uniform(0.2, 0.8), 2)})
        if ramp > 1.1 and rng.random() < 0.3:
            waves.append({"t": round(t + 0.8, 2), "pattern": rng.choice(["swarm", "dive"]), "enemy": rng.randrange(nE), "count": 3, "y": round(rng.uniform(0.2, 0.8), 2)})
        t += rng.uniform(2.6, 4.6) / (0.75 + 0.25 * ramp * density)
        i += 1
    return {"kind": "shmup", "name": name or common.level_name(rng, theme, index, "shmup"), "length": int(length), "waves": waves,
            "boss": bool(boss), "scroll": 60 + index * 10, "bg": "main"}


def preview(level, w=300, h=90):
    img = np.zeros((h, w, 4), dtype=np.uint8)
    img[..., 3] = 255
    img[..., :3] = (10, 8, 24)
    L = max(1, level.get("length", 60))
    colors = {"line": (255, 90, 160), "sine": (120, 200, 255), "v": (255, 200, 80), "dive": (255, 80, 60), "column": (180, 120, 255),
              "turret": (255, 140, 40), "swarm": (120, 255, 160), "circle": (255, 255, 255)}
    for wv in level.get("waves", []):
        x = int(wv["t"] / L * (w - 20))
        y = int(wv.get("y", 0.5) * (h - 10)) + 5
        c = colors.get(wv["pattern"], (200, 200, 200))
        for k in range(wv.get("count", 4)):
            yy = min(h - 2, max(1, y + (k - wv.get("count", 4) // 2) * 2))
            img[yy:yy + 2, x + k * 2:x + k * 2 + 2, :3] = c
    if level.get("boss"):
        img[h // 2 - 12:h // 2 + 12, w - 16:w - 4, :3] = (255, 40, 60)
    return img
