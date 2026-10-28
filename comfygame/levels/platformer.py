"""Chunk-based platformer level generator with a difficulty ramp and jump-reachability limits.

Legend: # solid  = one-way  ^ spikes  o coin  * gem  H heart  P start  G goal  C checkpoint
        a-h enemy type  B boss  S spring  M/V moving platform  X crumble  ? bonus block  L lava
"""
import random

from . import common

H = 18
FLYERS = {"flyer", "orbiter", "ghost", "weaver"}


class Builder:
    def __init__(self, width, rng, diff, enemies, liquid=False):
        self.w = width
        self.g = [["." for _ in range(width)] for _ in range(H)]
        self.rng = rng
        self.diff = diff
        self.x = 0
        self.ground = H - 4
        self.enemies = enemies or [{"behavior": "walker"}]
        self.liquid = liquid
        self.gems = 0

    def set(self, x, y, c, force=False):
        if 0 <= x < self.w and 0 <= y < H and (force or self.g[y][x] == "."):
            self.g[y][x] = c

    def column(self, x, top):
        for y in range(max(0, top), H):
            self.g[y][x] = "#"

    def enemy_letter(self, flying=None):
        idx = [i for i, e in enumerate(self.enemies) if (str(e.get("behavior", "")).lower() in FLYERS) == flying] if flying is not None else []
        if not idx:
            idx = list(range(len(self.enemies)))
        # bias toward later (tougher) enemies as difficulty climbs
        weights = [1 + i * self.diff * 0.4 for i in idx]
        return chr(97 + self.rng.choices(idx, weights)[0] % 8)

    def flat(self, n, enemies=0, coins=True):
        start = self.x
        for i in range(n):
            if self.x >= self.w:
                return
            self.column(self.x, self.ground)
            self.x += 1
        if coins and n >= 5 and self.rng.random() < 0.55:
            y = self.ground - (2 if self.rng.random() < 0.6 else 4)
            for cx in range(start + 1, start + n - 1, 1):
                if self.rng.random() < 0.8:
                    self.set(cx, y, "o")
        for _ in range(enemies):
            ex = self.rng.randint(start + 1, max(start + 1, self.x - 2))
            flying = self.rng.random() < 0.3
            letter = self.enemy_letter(flying)
            self.set(ex, self.ground - (self.rng.randint(3, 4) if flying else 1), letter)

    def gap(self, n):
        n = max(1, min(n, 4))
        lava = self.liquid and self.rng.random() < 0.5
        for i in range(n):
            if self.x >= self.w:
                return
            if lava:
                self.set(self.x, H - 2, "L", True)
                self.set(self.x, H - 1, "L", True)
            self.x += 1
        # coin arc over the gap
        for i in range(n + 2):
            cx = self.x - n - 1 + i
            arc = int(2 + 2 * (1 - abs((i - (n + 1) / 2) / ((n + 1) / 2 + 0.01)) ** 2))
            if self.rng.random() < 0.6:
                self.set(cx, self.ground - arc - 1, "o")

    def step(self, dh):
        self.ground = max(7, min(H - 2, self.ground + dh))

    def spikes(self, n=None):
        n = max(1, min(n or self.rng.randint(1, 2 if self.diff < 1 else 3), 3))
        self.flat(2, coins=False)
        for i in range(n):
            self.column(self.x, self.ground)
            self.set(self.x, self.ground - 1, "^")
            self.x += 1
        self.flat(2, coins=False)

    def platform_pit(self, n=None):
        n = max(5, min(n or self.rng.randint(6, 10), 11))
        start = self.x
        self.x += n
        y = self.ground - self.rng.randint(1, 3)
        px = start + 1
        while px < start + n - 2:
            w = self.rng.randint(2, 4)
            for i in range(w):
                self.set(px + i, y, "=")
                if self.rng.random() < 0.5:
                    self.set(px + i, y - 1, "o")
            if self.rng.random() < 0.25 * self.diff:
                self.set(px + w // 2, y - 1, self.enemy_letter(False))
            px += w + self.rng.randint(1, 3)
            y = max(5, min(self.ground, y + self.rng.choice([-1, 0, 1])))
        if self.liquid and self.rng.random() < 0.5:
            for x in range(start, start + n):
                self.set(x, H - 1, "L", True)

    def blocks(self):
        self.flat(3, coins=False)
        y = self.ground - 4
        n = self.rng.randint(3, 5)
        for i in range(n):
            self.column(self.x, self.ground)
            self.set(self.x, y, "?" if self.rng.random() < 0.5 else "#")
            self.x += 1
        if self.rng.random() < 0.5:
            self.set(self.x - n // 2 - 1, y - 3, "o")
            self.set(self.x - n // 2, y - 3, "o")
        self.flat(3, enemies=1 if self.rng.random() < 0.5 * self.diff else 0, coins=False)

    def climb(self):
        """Stairs of one-way platforms up to a high ledge holding a gem."""
        self.flat(2, coins=False)
        start = self.x
        n = min(self.rng.randint(3, 4), max(1, (self.ground - 4) // 3))
        y = self.ground
        for i in range(n):
            y -= 3
            for k in range(3):
                self.set(start + i * 3 + k, y, "=")
            self.column(start + i * 3, self.ground)
            self.column(start + i * 3 + 1, self.ground)
            self.column(start + i * 3 + 2, self.ground)
        top_y = y
        if self.gems < 3 and self.rng.random() < 0.7:
            self.set(start + n * 3 - 2, top_y - 2, "*")
            self.gems += 1
        else:
            self.set(start + n * 3 - 2, top_y - 1, "H" if self.rng.random() < 0.3 else "o")
        self.x = start + n * 3
        self.flat(3, enemies=1)

    def moving(self):
        n = self.rng.randint(7, 10)
        start = self.x
        self.x += n
        kind = "M" if self.rng.random() < 0.65 else "V"
        mx = start + n // 2
        self.set(mx, self.ground - (1 if kind == "M" else 3), kind, True)
        for i in range(1, n - 1, 2):
            self.set(start + i, self.ground - 4, "o")
        if self.liquid:
            for x in range(start, start + n):
                self.set(x, H - 1, "L", True)

    def spring_wall(self):
        self.flat(3, coins=False)
        self.set(self.x - 2, self.ground - 1, "S", True)
        hgt = self.rng.randint(5, 6)
        new_top = max(4, self.ground - hgt)
        self.ground = new_top
        for i in range(3):
            self.column(self.x, self.ground)
            self.x += 1
        self.set(self.x - 2, self.ground - 2, "o")
        self.set(self.x - 1, self.ground - 2, "o")

    def crumble_bridge(self):
        n = self.rng.randint(4, 7)
        y = self.ground
        for i in range(n):
            self.set(self.x, y, "X", True)
            self.set(self.x, y - 2, "o")
            self.x += 1

    def tunnel(self):
        n = self.rng.randint(8, 14)
        start = self.x
        self.flat(n, enemies=1, coins=False)
        roof = self.ground - 4
        for x in range(start + 1, start + n - 1):
            for y in range(max(0, roof - 3), roof):
                self.set(x, y, "#", True)
            if x % 2:
                self.set(x, self.ground - 1, "o")

    def hill(self):
        up = self.rng.randint(1, 3)
        self.flat(2, coins=False)
        self.step(-up)
        self.flat(self.rng.randint(4, 7), enemies=1)
        self.step(up + self.rng.choice([-1, 0, 0, 1]))
        self.flat(2, coins=False)

    def gem_alcove(self):
        """A floating gem over a short hazard, reachable with a good jump."""
        self.flat(2, coins=False)
        if self.gems < 3:
            self.set(self.x + 1, self.ground - 5, "*")
            self.gems += 1
        for i in range(3):
            self.column(self.x, self.ground)
            self.set(self.x, self.ground - 1, "^" if i == 1 and self.diff > 0.8 else ".")
            self.x += 1
        self.flat(2, coins=False)


def generate(seed=0, index=0, total=5, length=6, difficulty=1.0, enemies=None, boss=False, features=None, liquid=False, name=None, theme="grass"):
    rng = random.Random(seed * 1009 + index * 7919)
    features = set(features or ["spikes", "platforms", "moving", "springs", "crumble", "blocks"])
    ramp = difficulty * (0.6 + 0.8 * (index / max(1, total - 1)))
    width = 30 * max(3, int(length)) + (34 if boss else 0)
    b = Builder(width, rng, ramp, enemies, liquid)
    b.flat(8, coins=False)
    b.set(2, b.ground - 1, "P", True)
    menu = [("flat", 3), ("gap", 3), ("hill", 2), ("blocks", 1.5), ("climb", 1.2), ("gem_alcove", 1)]
    if "spikes" in features:
        menu.append(("spikes", 1.5 * ramp))
    if "platforms" in features:
        menu.append(("platform_pit", 1.6))
    if "moving" in features:
        menu.append(("moving", 1.0))
    if "springs" in features:
        menu.append(("spring_wall", 0.8))
    if "crumble" in features:
        menu.append(("crumble_bridge", 0.6 * ramp))
    menu.append(("tunnel", 0.7))
    end = width - (40 if boss else 12)
    checkpoint_done = False
    last = None
    b.flat(rng.randint(4, 8), enemies=1 if index > 0 else 0)  # a safe warm-up stretch before the first hazard
    while b.x < end:
        names, weights = zip(*[(n, w) for n, w in menu if n != last])
        choice = rng.choices(names, weights)[0]
        last = choice
        if choice == "flat":
            b.flat(rng.randint(4, 9), enemies=1 if rng.random() < 0.45 * ramp + 0.2 else 0)
        elif choice == "gap":
            b.gap(rng.randint(2, 3 if ramp < 1.2 else 4))
            b.step(rng.choice([-1, 0, 0, 1]))
            b.flat(3, coins=False)
        else:
            getattr(b, choice)()
        if not checkpoint_done and b.x > width * 0.48:
            b.flat(3, coins=False)
            b.set(b.x - 2, b.ground - 1, "C", True)
            checkpoint_done = True
    # remaining gems go above the final stretch
    while b.gems < 3:
        gx = rng.randint(12, max(13, end - 5))
        for y in range(2, H - 2):
            if b.g[y + 1][gx] in "#=" and b.g[y][gx] == ".":
                b.set(gx, max(1, y - 4), "*")
                break
        b.gems += 1
    if boss:
        b.flat(4, coins=False)
        arena_start = b.x
        b.step(0)
        b.flat(width - b.x - 1, coins=False)
        for y in range(0, b.ground):
            b.set(width - 1, y, "#", True)
        for y in range(3, b.ground - 5):
            pass
        b.set(arena_start + 18, b.ground - 1, "B", True)
        for x in (arena_start + 6, arena_start + 24):
            for k in range(3):
                b.set(x + k, b.ground - 4, "=")
        b.set(arena_start + 2, b.ground - 1, "H")
    else:
        b.flat(width - b.x, coins=False)
        b.set(width - 5, b.ground - 1, "G", True)
    rows = ["".join(r) for r in b.g]
    return {
        "kind": "platformer", "name": name or common.level_name(rng, theme, index), "tiles": rows, "gems": 3,
        "boss": bool(boss), "par": int(width * 0.32), "bg": "main",
    }


def from_text(text, name="Custom Level", boss=None):
    rows = [r.rstrip("\n") for r in str(text).strip("\n").splitlines() if r.strip()]
    w = max(len(r) for r in rows)
    rows = [r.ljust(w, ".").replace(" ", ".") for r in rows]
    if not any("P" in r for r in rows):
        for y in range(len(rows) - 1, 0, -1):
            if rows[y][2] == "#" and rows[y - 1][2] == ".":
                rows[y - 1] = rows[y - 1][:2] + "P" + rows[y - 1][3:]
                break
    has_boss = any("B" in r for r in rows)
    return {"kind": "platformer", "name": name, "tiles": rows, "gems": sum(r.count("*") for r in rows) or 3, "boss": has_boss if boss is None else boss, "bg": "main"}


COLORS = {"#": (110, 90, 70), "=": (190, 160, 90), "^": (230, 230, 240), "o": (255, 210, 60), "*": (80, 220, 255), "H": (255, 80, 100),
          "P": (80, 255, 120), "G": (255, 255, 255), "C": (120, 255, 180), "B": (255, 40, 60), "S": (255, 120, 60), "M": (200, 170, 255),
          "V": (200, 170, 255), "X": (150, 110, 80), "?": (255, 190, 40), "L": (255, 100, 20)}


def preview(level, scale=3):
    return common.render_grid(level["tiles"], COLORS, scale, enemy_color=(255, 90, 160), bg=(24, 22, 34))
