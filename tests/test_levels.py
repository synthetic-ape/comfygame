"""Generated levels must be completable: the goal / stairs / key must be reachable from the start."""
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from comfygame.levels import arena, dungeon, platformer, shmup  # noqa: E402

SOLID = set("#?UX")
ENEMIES = [{"behavior": b} for b in ("walker", "flyer", "hopper", "shooter")]


def standable(rows, x, y):
    h, w = len(rows), len(rows[0])
    if not (0 <= x < w and 0 <= y < h - 1):
        return False
    here, below = rows[y][x], rows[y + 1][x]
    free = here not in SOLID and here not in "^L"
    head = y == 0 or rows[y - 1][x] not in SOLID
    return free and head and (below in SOLID or below in "=SMV")


def platforms(rows):
    """Cells a moving platform can carry the player to (approximate its path)."""
    cells = set()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == "M":
                for dx in range(-4, 5):
                    cells.add((x + dx, y - 1))
            elif c == "V":
                for dy in range(-4, 4):
                    for dx in (-1, 0, 1):
                        cells.add((x + dx, y + dy - 1))
    return cells


def jump_reach(dy):
    """Max horizontal tiles between standing spots for a height change dy (tiles, +down), from the runtime's
    physics (jump 395 px/s, gravity 1500 with apex hang, run 125 px/s, 10 px hitbox), single jump."""
    import math
    if dy < -3:
        return -1
    rise = 53.0
    t = 0.368 + math.sqrt(max(0.0, 2 * (rise + 16 * dy)) / 1500)
    return int((125 * t + 10) / 16)


def reachable_platformer(level):
    rows = level["tiles"]
    h, w = len(rows), len(rows[0])
    start = goal = None
    springs = set()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == "P":
                start = (x, y)
            elif c in "GB":
                goal = (x, y)
            elif c == "S":
                springs.add((x, y))
    assert start and goal, "level needs P and G/B"
    extra = platforms(rows)
    stand = lambda x, y: standable(rows, x, y) or (x, y) in extra or (x, y) in springs  # noqa: E731
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        if abs(x - goal[0]) <= 1 and abs(y - goal[1]) <= 2:
            return True
        spring = (x, y) in springs or (x, y + 1) in springs
        for dy in range(-7 if spring else -3, h):
            reach = 4 if spring and dy < -3 else jump_reach(dy)
            for dx in range(-reach, reach + 1):
                nx, ny = x + dx, y + dy
                if (nx, ny) not in seen and 0 <= nx < w and 0 <= ny < h and stand(nx, ny):
                    seen.add((nx, ny))
                    q.append((nx, ny))
    return False


def test_platformer_levels_are_completable():
    failures = []
    for seed in range(1, 41):
        for diff in (0.7, 1.0, 1.35):
            for i in range(4):
                lv = platformer.generate(seed, i, 4, 6, diff, ENEMIES, boss=(i == 3), liquid=seed % 5 == 0)
                if not reachable_platformer(lv):
                    failures.append((seed, diff, i))
    assert not failures, f"{len(failures)} unreachable levels, e.g. {failures[:5]}"


def test_platformer_has_hazards_and_collectibles():
    lv = platformer.generate(3, 1, 4, 6, 1.0, ENEMIES, False)
    text = "".join(lv["tiles"])
    assert text.count("o") > 15
    assert text.count("*") >= 3
    assert any(ch in text for ch in "abcd")
    assert "C" in text and "G" in text


def test_dungeon_key_and_stairs_reachable():
    for seed in range(1, 31):
        for i in range(3):
            lv = dungeon.generate(seed, i, 3, 1.0, 1.0, [1, 2, 3], boss=(i == 2))
            rows = lv["tiles"]
            start = next((x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == "<")
            seen = {start}
            q = deque([start])
            while q:
                x, y = q.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if (nx, ny) not in seen and 0 <= ny < len(rows) and 0 <= nx < len(rows[0]) and rows[ny][nx] not in "# t":
                        seen.add((nx, ny))
                        q.append((nx, ny))
            targets = [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c in ">kB"]
            assert targets and all(t in seen for t in targets), f"seed {seed} floor {i}: unreachable {[t for t in targets if t not in seen]}"


def test_arena_and_shmup_timelines():
    a = arena.generate(1, 0, 3, 60, 1.0, ENEMIES, False)
    assert a["waves"] and a["waves"][0]["t"] < 5 and all(w["t"] < 60 for w in a["waves"])
    assert sum(r.count("P") for r in a["tiles"]) == 1
    s = shmup.generate(1, 2, 3, 60, 1.2, ENEMIES, True)
    assert len(s["waves"]) > 10 and s["boss"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
