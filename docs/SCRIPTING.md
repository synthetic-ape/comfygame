# Scripting game mechanics

The **Game Script** node (or a design's `"script"` field, or the AI Script node) adds JavaScript that runs inside the exported game. A script is the *body* of a function `(CG, game, api) => { ...; return hooks; }`.

```js
// Combo counter: chain kills quickly for bonus points.
let combo = 0, timer = 0;
return {
  onEnemyKilled(e) {
    combo++; timer = 2;
    if (combo > 1) api.float("COMBO x" + combo, e.x, e.y - 8, api.theme.gold);
    api.addScore(combo * 25);
  },
  onUpdate(dt) { timer -= dt; if (timer <= 0) combo = 0; },
  draw() {
    if (combo > 1) api.text("COMBO x" + combo, api.W / 2, 22, { align: "center", color: api.theme.gold, outline: "#000" });
  },
};
```

## Hooks

| Hook | When |
|---|---|
| `onLevelStart(levelIndex, world)` | a level begins |
| `onUpdate(dt, world)` | every frame of play (`dt` in seconds, 1/60) |
| `draw(gfx, world)` | after the world is drawn, before the HUD (screen coordinates) |
| `onEnemyKilled(enemy, world)` | an enemy dies |
| `onPlayerHit(damage, world)` | the player takes damage |
| `onPlayerDeath(world)` | the player loses a life |
| `onLevelComplete(levelIndex, world)` | level cleared |
| `onVictory()` | the final level is cleared |

A hook that throws is disabled and its error is shown as a small in-game toast, so a broken script never crashes the game.

## The `api` object

| Member | Description |
|---|---|
| `api.player` | `{x, y, w, h, vx, vy, hp, maxHp, face}` (world pixels) |
| `api.enemies` | array of enemies `{x, y, w, h, hp, def: {name, behavior}}` |
| `api.world`, `api.level`, `api.time` | current world, level index, seconds in this level |
| `api.W`, `api.H` | screen size in game pixels (480 x 270 by default) |
| `api.addScore(n, x?, y?)` | add points (optionally with a floating number) |
| `api.damage(enemy, n)`, `api.kill(enemy)` | hurt or kill an enemy properly (never change `hp` directly) |
| `api.hurtPlayer(n)`, `api.win()` | damage the player / finish the level |
| `api.spawnEnemy(indexOrId, x, y)` | spawn an enemy from the roster |
| `api.shake(0..1)`, `api.flash(color, alpha)` | screen shake and flash |
| `api.sound(name)` | `jump coin hit hurt shoot explode powerup select dash die land step` |
| `api.float(text, x, y, color)` | floating text in world space |
| `api.burst(x, y, count, {colors, speed, life, g})` | particles in world space |
| `api.text(str, x, y, {color, scale, align, outline})` | pixel-font text (screen space, inside `draw`) |
| `api.rect / api.bar / api.circle` | simple drawing (screen space, inside `draw`) |
| `api.toast(msg)` | short message at the bottom of the screen |
| `api.after(sec, fn)`, `api.every(sec, fn)` | timers that pause with the game |
| `api.rand(a, b)`, `api.theme` | random numbers; theme colours `{text, accent, accent2, gold, danger, good, shadow}` |

World to screen: `screenX = worldX - world.cam.vx`, `screenY = worldY - world.cam.vy`.

## More examples

**Coin rain every 15 seconds (platformer)**

```js
let rain = 0;
api.every(15, () => { rain = 4; api.toast("COIN RAIN!"); api.sound("powerup"); });
return {
  onUpdate(dt, w) {
    if (rain <= 0 || !w.items) return;
    rain -= dt;
    if (Math.random() < 0.25) {
      const x = w.cam.x + Math.random() * api.W, y = w.cam.y;
      w.items.push({ kind: "coin", x, y, w: 8, h: 8, by: y });
    }
    for (const it of w.items) if (it.kind === "coin" && rain > 0) it.by += 60 * dt;
  },
};
```

**Enraged enemies below half health (any genre)**

```js
return {
  onUpdate() {
    for (const e of api.enemies) {
      if (!e.raged && e.maxHp && e.hp < e.maxHp / 2) { e.raged = true; e.speed *= 1.6; api.float("!", e.x, e.y - 8, api.theme.danger); }
    }
  },
};
```

**A survival timer with a bonus**

```js
return {
  draw() { api.text("TIME " + Math.floor(api.time), api.W - 8, 20, { align: "right", color: api.theme.text, outline: "#000" }); },
  onLevelComplete() { api.addScore(Math.max(0, 120 - Math.floor(api.time)) * 50); },
};
```

## Whole new game types

A design or spec can also carry `"code"`: JavaScript that runs before boot and may call `CG.defineGenre("mygenre", { create(game, levelIndex, opts) { return world; }, controls: [...] })`. A world implements `update(dt)`, `draw(gfx)`, optional `hud(gfx)`, and calls `game.levelComplete()` / `game.playerDied()`. The built-in genres in `runtime/genres/` are complete examples of the engine API (sprites, particles, camera, audio, input).
