# Design JSON

A *design* is the short JSON description of a game that the Idea Dice, the AI Game Designer and the *Game From Design JSON* node all speak. You can write one by hand, ask any chatbot for one (panel → AI Studio → *Copy designer prompt*), or POST it to `/api/comfygame/build`.

Every field is optional. Unknown or misspelled values are matched to the closest supported value ("icy kitchen" becomes the `snow` theme, "penguin" a furry hero, "lasers" the `laser` weapon), so free-form answers from small local models still work.

```json
{
  "title": "Penguin Chef",
  "tagline": "Slide through icy kitchens, defeat vegetable villains.",
  "genre": "platformer",
  "theme": "snow",
  "palette": "ice",
  "difficulty": "normal",
  "lives": 3,
  "story": {
    "intro": "The royal kitchen froze overnight and the vegetables have risen up. Only one chef can slide fast enough.",
    "ending": "Dinner is served. The vegetables are... in the soup."
  },
  "player": { "name": "Chef Pip", "look": "penguin chef", "hp": 3, "speed": 1.1, "jump": 1.0,
              "abilities": ["double_jump", "dash"], "art_prompt": "chubby penguin in a chef hat holding a ladle" },
  "enemies": [
    { "name": "Angry Carrot", "look": "carrot monster", "behavior": "walker", "hp": 1, "speed": 1.0 },
    { "name": "Flying Pea", "look": "bat", "behavior": "flyer", "hp": 1, "speed": 1.2 },
    { "name": "Tomato Cannon", "look": "plant", "behavior": "shooter", "hp": 2 }
  ],
  "boss": { "name": "Mega Broccoli", "look": "giant broccoli", "hp": 24 },
  "levels": { "count": 4, "length": 6, "features": ["spikes", "moving", "springs"], "names": ["Pantry", "Freezer", "Oven Run", "Chef's Table"] },
  "music": { "mood": "happy", "instruments": "nes" },
  "sfx": "retro",
  "tiles": "snow",
  "background": "snow",
  "art": { "style": "cute 16-bit pixel art, game asset" },
  "script": ""
}
```

## Fields

| Field | Values |
|---|---|
| `genre` | `platformer`, `arena`, `dungeon`, `shmup` |
| `theme` / `background` | `forest mountains desert snow cave city space ocean volcano candy jungle castle sky underwater` |
| `palette` | `forest pico8 sweetie16 desert neon ice lava candy ocean spooky sunset gameboy noir jungle cyber autumn`, or a list of hex colours |
| `difficulty` | `easy normal hard brutal` |
| `player.look` | `knight mage ninja robot fox astronaut ranger princess` (ships: `fighter interceptor`) or a description |
| `player.abilities` | platformer: `double_jump dash wall_jump shoot` |
| `player.weapon` | arena / dungeon / shmup: `blaster spread laser magic sword` |
| `enemies[].look` | `slime bat ghost eyeball spider mushroom beetle plant imp drone skeleton mutant enemy_ship` or a description |
| `enemies[].behavior` | platformer `walker hopper flyer shooter charger spiky`; arena/dungeon `chaser runner orbiter shooter charger tank splitter exploder turret`; shmup `line weaver turret kamikaze spinner tank` (behaviours are translated between genres) |
| `levels` | `count`, `length` (screens, platformer), `duration` (seconds, arena), `size` (dungeon), `features`, `names`, `boss_at_end` |
| `music.mood` | `heroic adventure happy chill spooky mysterious intense epic retro` |
| `music.instruments` | `nes gameboy soft synth` |
| `sfx` | `retro soft crunchy space` |
| `tiles` | `grass stone snow sand tech cave candy brick wood ice lava jungle dungeon` |
| `art_prompt`, `art.*` | text for image models (used by the AI art templates) |
| `script` | a JavaScript mod, see [SCRIPTING.md](SCRIPTING.md) |
