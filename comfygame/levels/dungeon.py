"""Dungeon floors: rooms + corridors, key chest in a far room, stairs in the farthest, torches, traps, loot.

Legend: # wall  ' ' void  . floor  < start  > stairs  k key chest  c chest  H potion  o gold
        t torch (wall)  ^ trap  a-h enemy  B boss
"""
import random
from collections import deque

from . import common


def _carve_room(g, r):
    x, y, w, h = r
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            g[yy][xx] = "."


def _corridor(g, rng, a, b):
    (x0, y0), (x1, y1) = a, b
    if rng.random() < 0.5:
        for x in range(min(x0, x1), max(x0, x1) + 1):
            g[y0][x] = "."
        for y in range(min(y0, y1), max(y0, y1) + 1):
            g[y][x1] = "."
    else:
        for y in range(min(y0, y1), max(y0, y1) + 1):
            g[y][x0] = "."
        for x in range(min(x0, x1), max(x0, x1) + 1):
            g[y1][x] = "."


def _bfs(g, start):
    h, w = len(g), len(g[0])
    dist = [[-1] * w for _ in range(h)]
    q = deque([start])
    dist[start[1]][start[0]] = 0
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and dist[ny][nx] < 0 and g[ny][nx] not in "# ":
                dist[ny][nx] = dist[y][x] + 1
                q.append((nx, ny))
    return dist


def generate(seed=0, index=0, total=4, size=1.0, difficulty=1.0, enemies=None, boss=False, rooms=None, traps=True, dark=True, name=None, theme="dungeon"):
    rng = random.Random(seed * 3571 + index * 104729)
    W, H = int(44 * size + index * 2), int(32 * size + index)
    g = [[" "] * W for _ in range(H)]
    n_rooms = rooms or rng.randint(7, 10) + index
    placed = []
    tries = 0
    while len(placed) < n_rooms and tries < 400:
        tries += 1
        w, h = rng.randint(5, 10), rng.randint(4, 8)
        if boss and not placed:
            w, h = 14, 10
        x, y = rng.randint(1, W - w - 2), rng.randint(1, H - h - 2)
        if any(x < px + pw + 2 and x + w + 2 > px and y < py + ph + 2 and y + h + 2 > py for px, py, pw, ph in placed):
            continue
        placed.append((x, y, w, h))
    for r in placed:
        _carve_room(g, r)
    centers = [(x + w // 2, y + h // 2) for x, y, w, h in placed]
    # connect with a minimum spanning tree plus a couple of loops
    connected = {0}
    while len(connected) < len(centers):
        best = None
        for i in connected:
            for j in range(len(centers)):
                if j in connected:
                    continue
                d = abs(centers[i][0] - centers[j][0]) + abs(centers[i][1] - centers[j][1])
                if best is None or d < best[0]:
                    best = (d, i, j)
        _corridor(g, rng, centers[best[1]], centers[best[2]])
        connected.add(best[2])
    for _ in range(2):
        a, b = rng.sample(range(len(centers)), 2)
        _corridor(g, rng, centers[a], centers[b])
    # walls around floors
    for y in range(H):
        for x in range(W):
            if g[y][x] == " " and any(0 <= y + dy < H and 0 <= x + dx < W and g[y + dy][x + dx] == "." for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                g[y][x] = "#"
    boss_room = 0 if boss else None
    start_room = 1 if boss else 0
    sx, sy = centers[start_room]
    g[sy][sx] = "<"
    dist = _bfs(g, (sx, sy))
    room_d = [dist[cy][cx] for cx, cy in centers]
    order = sorted(range(len(centers)), key=lambda i: -room_d[i])
    if boss:
        stairs_room = boss_room
        bx, by = centers[boss_room]
        g[by][bx] = "B"
        x, y, w, h = placed[boss_room]
        g[y + 1][x + w - 2] = ">"
        key_room = None
    else:
        stairs_room = order[0]
        cx, cy = centers[stairs_room]
        g[cy][cx] = ">"
        key_room = next((i for i in order[1:] if i != start_room and abs(centers[i][0] - cx) + abs(centers[i][1] - cy) > 8), order[1] if len(order) > 1 else stairs_room)
        kx, ky = centers[key_room]
        if g[ky][kx] == ">":
            ky += 1
        g[ky][kx] = "k"
    # chests, loot, enemies
    ramp = difficulty * (0.7 + 0.6 * index / max(1, total - 1))
    nE = len(enemies or [1])
    for i, (x, y, w, h) in enumerate(placed):
        if i == start_room:
            continue
        free = [(xx, yy) for yy in range(y + 1, y + h - 1) for xx in range(x + 1, x + w - 1) if g[yy][xx] == "."]
        rng.shuffle(free)
        if i not in (stairs_room, key_room) and rng.random() < 0.35 and free:
            cx, cy = free.pop()
            g[cy][cx] = "c"
        for _ in range(rng.randint(0, 2)):
            if free:
                cx, cy = free.pop()
                g[cy][cx] = "o" if rng.random() < 0.8 else "H"
        if i == boss_room:
            continue
        count = int(rng.uniform(1, 2.5) * ramp + (w * h) / 30)
        for _ in range(count):
            if free:
                cx, cy = free.pop()
                idx = min(nE - 1, int(rng.random() ** (1.4 - min(1.0, ramp * 0.3)) * nE))
                g[cy][cx] = chr(97 + idx % 8)
    # torches on north walls of rooms
    for x, y, w, h in placed:
        for xx in range(x + 1, x + w - 1, 3):
            if g[y - 1][xx] == "#" and rng.random() < 0.7:
                g[y - 1][xx] = "t"
    # traps in corridors
    if traps:
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                if g[y][x] == "." and not any(rx <= x < rx + rw and ry <= y < ry + rh for rx, ry, rw, rh in placed):
                    if rng.random() < 0.035 * ramp:
                        g[y][x] = "^"
    rows = ["".join(r) for r in g]
    return {"kind": "dungeon", "name": name or common.level_name(rng, theme, index, "dungeon"), "tiles": rows, "boss": bool(boss), "dark": bool(dark), "bg": "main"}


def from_text(text, name="Custom Floor", dark=True):
    rows = [r for r in str(text).strip("\n").splitlines() if r.strip()]
    w = max(len(r) for r in rows)
    rows = [r.ljust(w, " ") for r in rows]
    return {"kind": "dungeon", "name": name, "tiles": rows, "boss": any("B" in r for r in rows), "dark": dark, "bg": "main"}


COLORS = {"#": (90, 84, 110), "t": (255, 160, 60), ".": (40, 36, 52), "<": (80, 255, 120), ">": (255, 255, 255), "k": (255, 210, 60),
          "c": (200, 140, 60), "H": (255, 80, 100), "o": (230, 190, 60), "^": (200, 200, 210), "B": (255, 40, 60), "+": (60, 50, 70)}


def preview(level, scale=4):
    return common.render_grid(level["tiles"], COLORS, scale, bg=(8, 6, 12), void=" ")
