"""Game Idea Dice: coherent, surprising game designs from a seed, no AI required."""
import random

THEMES = {
    "forest": dict(words=(["Moss", "Fern", "Acorn", "Willow", "Thistle", "Bramble"], ["Knight", "Quest", "Hollow", "Grove", "Legend", "Trail"]),
                   heroes=["knight", "fox", "ranger"], foes=["slime", "mushroom", "bat", "beetle", "plant"], boss=["slime", "mushroom", "beetle"],
                   palette="forest", tiles="grass", mood=["adventure", "heroic", "happy"],
                   story="The {place} has fallen silent. {hero} sets out to wake the ancient grove before the {foe}s swallow it whole."),
    "desert": dict(words=(["Dune", "Sun", "Mirage", "Scarab", "Sand", "Oasis"], ["Runner", "Raiders", "Crown", "Tomb", "Drifter", "Odyssey"]),
                   heroes=["ranger", "fox", "ninja"], foes=["beetle", "spider", "plant", "skeleton", "slime"], boss=["beetle", "spider", "skeleton"],
                   palette="desert", tiles="sand", mood=["adventure", "mysterious"],
                   story="Under a blazing sun, {hero} hunts for the lost oasis of {place}. The {foe}s guard every dune."),
    "snow": dict(words=(["Frost", "Glacier", "Snow", "Aurora", "Ice", "Yeti"], ["Climber", "Peak", "Patrol", "Saga", "Spirit", "Run"]),
                 heroes=["fox", "knight", "astronaut"], foes=["slime", "ghost", "bat", "beetle", "eyeball"], boss=["ghost", "slime"],
                 palette="ice", tiles="snow", mood=["chill", "adventure"],
                 story="An endless winter grips {place}. {hero} climbs toward the aurora to break the frost spell."),
    "cave": dict(words=(["Crystal", "Deep", "Echo", "Glow", "Ember", "Stone"], ["Delver", "Depths", "Miner", "Below", "Caverns", "Heart"]),
                 heroes=["ranger", "robot", "knight"], foes=["bat", "spider", "slime", "eyeball", "mutant"], boss=["spider", "eyeball", "mutant"],
                 palette="spooky", tiles="cave", mood=["mysterious", "spooky"],
                 story="Deep beneath {place}, the crystals have started to whisper. {hero} descends to find out why."),
    "city": dict(words=(["Neon", "Chrome", "Pixel", "Circuit", "Laser", "Midnight"], ["Runner", "Protocol", "Pulse", "Overdrive", "Heist", "City"]),
                 heroes=["ninja", "robot", "astronaut"], foes=["drone", "robot", "imp", "eyeball", "mutant"], boss=["drone", "eyeball", "robot"],
                 palette="cyber", tiles="tech", mood=["intense", "retro"],
                 story="{place} never sleeps, and tonight the machines woke up. {hero} has until sunrise to shut down the core."),
    "space": dict(words=(["Star", "Nova", "Void", "Comet", "Nebula", "Orbit"], ["Strike", "Raiders", "Squadron", "Drift", "Rift", "Storm"]),
                  heroes=["fighter", "interceptor"], foes=["enemy_ship", "enemy_ship", "enemy_ship", "drone", "eyeball"], boss=["boss_ship"],
                  palette="neon", tiles="tech", mood=["intense", "epic", "retro"],
                  story="The {foe} armada broke through the outer rim. One pilot, {hero}, stands between it and {place}."),
    "volcano": dict(words=(["Magma", "Cinder", "Ash", "Inferno", "Ember", "Obsidian"], ["Fury", "Forge", "Escape", "Crown", "Trial", "Core"]),
                    heroes=["knight", "robot", "ninja"], foes=["imp", "slime", "bat", "beetle", "mutant"], boss=["imp", "slime", "mutant"],
                    palette="lava", tiles="lava", mood=["intense", "epic"],
                    story="The mountain {place} is waking. {hero} must reach the core and seal the fire before it spills."),
    "candy": dict(words=(["Sugar", "Gumdrop", "Candy", "Sprinkle", "Bubble", "Jelly"], ["Rush", "Kingdom", "Pop", "Party", "Dash", "Land"]),
                  heroes=["princess", "fox", "mage"], foes=["slime", "mushroom", "bat", "imp", "mutant"], boss=["slime", "mutant"],
                  palette="candy", tiles="candy", mood=["happy", "retro"],
                  story="Someone stole every sweet in {place}! {hero} follows the trail of crumbs to get them back."),
    "castle": dict(words=(["Dread", "Crypt", "Shadow", "Raven", "Iron", "Ghost"], ["Keep", "Crawler", "Vault", "Curse", "Throne", "Halls"]),
                   heroes=["knight", "mage", "ranger"], foes=["skeleton", "ghost", "bat", "slime", "eyeball"], boss=["ghost", "skeleton", "eyeball"],
                   palette="spooky", tiles="dungeon", mood=["mysterious", "spooky", "epic"],
                   story="The crypts beneath {place} are stirring. {hero} lights a torch and steps into the dark."),
    "jungle": dict(words=(["Jungle", "Vine", "Temple", "Tiki", "Jade", "Monsoon"], ["Rumble", "Relic", "Explorer", "Idol", "Escape", "Roots"]),
                   heroes=["ranger", "fox", "ninja"], foes=["plant", "spider", "beetle", "bat", "imp"], boss=["plant", "spider"],
                   palette="jungle", tiles="jungle", mood=["adventure", "happy"],
                   story="Legends say the jade idol of {place} grants one wish. {hero} hacks through the vines to find it first."),
    "underwater": dict(words=(["Coral", "Tide", "Abyss", "Pearl", "Kelp", "Deep"], ["Diver", "Reef", "Odyssey", "Current", "Treasure", "Song"]),
                       heroes=["astronaut", "fox", "robot"], foes=["slime", "eyeball", "spider", "ghost", "mutant"], boss=["eyeball", "mutant"],
                       palette="ocean", tiles="ice", mood=["chill", "mysterious"],
                       story="The pearl of {place} keeps the tides in balance. Now it is gone, and {hero} must dive into the abyss."),
}

PLACES = ["Eldermoor", "Vel'Tari", "Sunreach", "Norrow", "Kaldera", "Brightwater", "Ashfall", "Mirelight", "Port Halcyon", "Zephyria", "Duskvale", "Glimmerholt"]
HERO_NAMES = {"knight": ["Sir Pip", "Dame Ivy", "Brannoc"], "fox": ["Rusty", "Fennel", "Kit"], "ranger": ["Wren", "Ash", "Juniper"], "mage": ["Orla", "Zephyr", "Mags"],
              "ninja": ["Kage", "Ren", "Suzu"], "robot": ["B0LT", "Unit-7", "Clank"], "astronaut": ["Cosmo", "Nova", "Major Tam"], "princess": ["Princess Lumi", "Rosalind", "Peach-ette"],
              "fighter": ["Falcon", "Vega-1", "Red Five"], "interceptor": ["Arrow", "Kestrel", "Blue Lightning"]}
FOE_NAMES = {"slime": ["Blorb", "Goo", "Jelly"], "bat": ["Flitter", "Night Wing", "Screech"], "mushroom": ["Shroomling", "Puffcap", "Spore"], "beetle": ["Shellback", "Clicker", "Scuttle"],
             "plant": ["Snapvine", "Spitter", "Bulb"], "spider": ["Creeper", "Weaver", "Skitter"], "skeleton": ["Rattler", "Bonehead", "Grim"], "ghost": ["Wisp", "Boo", "Shade"],
             "eyeball": ["Watcher", "Oculus", "Peeper"], "imp": ["Gremlin", "Hothead", "Imp"], "drone": ["Sentry", "Buzz", "Probe"], "robot": ["Mechanoid", "Trooper", "Servo"],
             "mutant": ["Glorp", "Thing", "Mutant"], "enemy_ship": ["Raider", "Interceptor", "Hornet", "Mantis", "Wasp"]}
BOSS_NAMES = ["The Hollow King", "Mother Brood", "Gorgax", "The Warden", "Queen Vexa", "Overmind", "The Devourer", "Lord Ruin"]
TAGLINES = ["Jump. Fight. Never look back.", "One hero. Too many monsters.", "How far can you go?", "The legend starts here.", "Every run tells a story.",
            "Bring snacks. It's dangerous out there.", "A tiny hero with a big problem."]
GENRE_BEHAVIORS = {
    "platformer": ["walker", "flyer", "hopper", "shooter", "charger", "spiky"],
    "arena": ["chaser", "orbiter", "runner", "tank", "shooter", "splitter", "exploder"],
    "dungeon": ["chaser", "charger", "orbiter", "shooter", "tank", "exploder"],
    "shmup": ["line", "weaver", "turret", "kamikaze", "spinner", "tank"],
}
GENRE_THEMES = {
    "platformer": ["forest", "desert", "snow", "cave", "candy", "jungle", "volcano", "city"],
    "arena": ["forest", "desert", "volcano", "city", "candy", "castle", "snow"],
    "dungeon": ["castle", "cave", "volcano", "jungle", "underwater", "snow"],
    "shmup": ["space", "city", "volcano"],
}
FEATURES = ["spikes", "platforms", "moving", "springs", "crumble", "blocks"]


def roll(seed=0, genre="any", theme="any"):
    rng = random.Random(seed * 2654435761 % (2 ** 31))
    genre = genre if genre in GENRE_THEMES else rng.choice(list(GENRE_THEMES))
    theme = theme if theme in THEMES else rng.choice(GENRE_THEMES[genre])
    T = THEMES[theme]
    a, b = T["words"]
    title = f"{rng.choice(a)} {rng.choice(b)}"
    hero_kind = rng.choice(T["heroes"]) if genre != "shmup" else rng.choice(["fighter", "interceptor"])
    hero = rng.choice(HERO_NAMES.get(hero_kind, ["Hero"]))
    foes = T["foes"][:]
    rng.shuffle(foes)
    behaviors = GENRE_BEHAVIORS[genre][:]
    n = rng.randint(3, 5)
    enemies = []
    for i in range(n):
        kind = foes[i % len(foes)] if genre != "shmup" else "enemy_ship"
        beh = behaviors[i] if i < 2 else rng.choice(behaviors)
        if genre == "platformer" and kind in ("bat", "ghost", "drone", "eyeball"):
            beh = "flyer"
        enemies.append({"name": rng.choice(FOE_NAMES.get(kind, ["Foe"])), "look": kind, "behavior": beh, "hp": 1 + (i >= 2) + (beh in ("tank", "charger")),
                        "speed": round(rng.uniform(0.8, 1.3), 2), "score": 100 * (i + 1)})
    boss_kind = rng.choice(T["boss"]) if genre != "shmup" else "boss_ship"
    place = rng.choice(PLACES)
    abilities = []
    if genre == "platformer":
        abilities = rng.sample(["double_jump", "dash", "wall_jump", "shoot"], rng.randint(1, 3))
    weapon = {"platformer": None, "arena": rng.choice(["blaster", "spread", "laser", "magic"]), "dungeon": rng.choice(["sword", "sword", "magic"]), "shmup": "blaster"}[genre]
    design = {
        "title": title, "tagline": rng.choice(TAGLINES), "genre": genre, "theme": theme, "palette": T["palette"],
        "difficulty": rng.choice(["easy", "normal", "normal", "hard"]), "lives": 3,
        "story": {"intro": T["story"].format(place=place, hero=hero, foe=enemies[0]["name"]),
                  "ending": f"Peace returns to {place}. {hero} is a legend now, and the {enemies[0]['name']}s will think twice."},
        "player": {"name": hero, "look": hero_kind, "hp": 3 if genre == "platformer" else 5, "abilities": abilities, "weapon": weapon},
        "enemies": enemies,
        "boss": {"name": rng.choice(BOSS_NAMES), "look": boss_kind, "hp": rng.randint(16, 30)},
        "levels": {"count": rng.randint(3, 5), "length": rng.randint(5, 8), "features": rng.sample(FEATURES, rng.randint(3, 6)), "boss_at_end": True},
        "music": {"mood": rng.choice(T["mood"]), "instruments": rng.choice(["nes", "nes", "gameboy", "soft", "synth"])},
        "sfx": rng.choice(["retro", "retro", "soft", "crunchy", "space"]),
        "tiles": T["tiles"], "background": theme,
        "art": {"style": rng.choice(["16-bit pixel art", "cute chibi pixel art", "SNES style pixel art", "bold outlined pixel art"]) + ", game asset"},
    }
    return design
