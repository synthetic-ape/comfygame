"""Shared helpers for level generators: names and minimap previews."""
import numpy as np

ADJ = {
    "grass": ["Mossy", "Green", "Whispering", "Sunny", "Clover", "Breezy"],
    "forest": ["Mossy", "Shady", "Whispering", "Ancient", "Fernwood", "Hollow"],
    "stone": ["Crumbling", "Old", "Granite", "Silent", "Broken"],
    "snow": ["Frozen", "Frosty", "Glacier", "Snowy", "Icebound"],
    "ice": ["Frozen", "Crystal", "Glacial", "Shimmering"],
    "sand": ["Sunbaked", "Dusty", "Golden", "Scorched", "Mirage"],
    "desert": ["Sunbaked", "Dusty", "Golden", "Scorched", "Mirage"],
    "tech": ["Neon", "Circuit", "Chrome", "Reactor", "Signal"],
    "cyber": ["Neon", "Circuit", "Chrome", "Glitch", "Signal"],
    "cave": ["Echoing", "Crystal", "Gloomy", "Dripping", "Deep"],
    "candy": ["Sugar", "Lollipop", "Frosted", "Bubblegum", "Caramel"],
    "lava": ["Molten", "Ashen", "Burning", "Cinder", "Magma"],
    "volcano": ["Molten", "Ashen", "Burning", "Cinder", "Magma"],
    "dungeon": ["Forgotten", "Cursed", "Haunted", "Sunken", "Dread"],
    "space": ["Cosmic", "Nebula", "Starlit", "Void", "Orbital"],
    "jungle": ["Overgrown", "Tangled", "Humid", "Wild", "Emerald"],
}
NOUN = {
    "platformer": ["Meadow", "Path", "Ridge", "Hollow", "Heights", "Falls", "Bridge", "Gardens", "Peaks", "Ruins"],
    "dungeon": ["Crypt", "Halls", "Catacombs", "Vault", "Depths", "Keep", "Labyrinth", "Sanctum"],
    "arena": ["Arena", "Plaza", "Grounds", "Battlefield", "Coliseum", "Clearing", "Crater"],
    "shmup": ["Sector", "Nebula", "Belt", "Frontier", "Corridor", "Expanse", "Rift"],
}


def level_name(rng, theme, index, kind="platformer"):
    adj = ADJ.get(theme, ADJ["grass"])
    noun = NOUN.get(kind, NOUN["platformer"])
    return f"{rng.choice(adj)} {rng.choice(noun)}"


def render_grid(rows, colors, scale=3, enemy_color=(255, 90, 160), bg=(24, 22, 34), wall_chars="#", void=" "):
    h = len(rows)
    w = max(len(r) for r in rows) if rows else 1
    img = np.zeros((h * scale, w * scale, 4), dtype=np.uint8)
    img[..., :3] = bg
    img[..., 3] = 255
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c == void and void != ".":
                col = (8, 6, 12)
            elif c in colors:
                col = colors[c]
            elif "a" <= c <= "h":
                col = enemy_color
            else:
                continue
            img[y * scale:(y + 1) * scale, x * scale:(x + 1) * scale, :3] = col
    return img


def stack_previews(previews, gap=4, bg=(12, 10, 18)):
    w = max(p.shape[1] for p in previews)
    h = sum(p.shape[0] for p in previews) + gap * (len(previews) - 1)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = bg
    out[..., 3] = 255
    y = 0
    for p in previews:
        out[y:y + p.shape[0], :p.shape[1]] = p
        y += p.shape[0] + gap
    return out
