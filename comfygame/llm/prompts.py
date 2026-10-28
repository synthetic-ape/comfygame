"""Prompts for LLM game design. The model writes a design JSON (see design.DESIGN_SCHEMA_DOC)."""
from ..design import DESIGN_SCHEMA_DOC

SCRIPTING_DOC = """A script is the BODY of a JavaScript function `(CG, game, api) => { ...; return hooks; }`.
Return an object with any of these hooks:
  onLevelStart(levelIndex, world)   onUpdate(dt, world)   draw(gfx, world)   onVictory()
  onEnemyKilled(enemy, world)       onPlayerHit(damage, world)   onPlayerDeath(world)   onLevelComplete(levelIndex, world)
`api` (stable helpers):
  api.player {x,y,w,h,vx,vy,hp,maxHp,face}   api.enemies [ {x,y,w,h,hp,def:{name,behavior}} ]   api.world   api.time (s in level)   api.level (index)
  api.W / api.H (screen px)   api.addScore(n, x?, y?)   api.shake(0..1)   api.flash(color, alpha)   api.sound("jump|coin|hit|hurt|shoot|explode|powerup|select|dash|die")
  api.text(str, x, y, {color, scale, align:"left|center|right", outline})   (screen coords, call it inside draw)
  api.float(str, worldX, worldY, color)   api.burst(worldX, worldY, count, {colors:[...], speed, life, g})
  api.spawnEnemy(indexOrId, worldX, worldY)   api.toast(msg)   api.after(sec, fn)   api.every(sec, fn)   api.rand(a, b)
  api.damage(enemy, n)   api.kill(enemy)   api.win()   api.hurtPlayer(n)   api.theme {text, accent, accent2, gold, danger, good, shadow}
  Drawing inside draw() (screen coords): api.rect(x, y, w, h, color)   api.bar(x, y, w, h, fraction, color)   api.circle(x, y, r, color)
  Never modify enemy.hp directly - use api.damage / api.kill.
World coordinates: world.cam.vx / world.cam.vy is the top-left of the view (screen = world - cam).
Keep scripts short (under 60 lines), defensive (check objects exist), and fun. Example:
  let combo = 0, timer = 0;
  return {
    onEnemyKilled(e) { combo++; timer = 2; if (combo > 1) api.float("COMBO x" + combo, e.x, e.y - 8, api.theme.gold); api.addScore(combo * 10); },
    onUpdate(dt) { timer -= dt; if (timer <= 0) combo = 0; },
    draw() { if (combo > 1) api.text("COMBO x" + combo, api.W / 2, 22, { align: "center", color: api.theme.gold, outline: "#000" }); },
  };"""

SYSTEM = """You are the lead designer for ComfyGame, an engine that turns a compact JSON design into a polished retro game.
Design a complete, fun, coherent game from the user's idea. Pick the genre that fits best:
- platformer: side-scrolling jumping, stomping enemies, gems, checkpoints, boss at the end
- arena: top-down survivor; endless waves, auto-fire, level-up upgrades, boss
- dungeon: top-down crawler; torch-lit floors, melee/magic, keys, chests, traps, boss floor
- shmup: horizontal space shooter; formations, bullet patterns, power-ups, bombs, boss
Rules:
- Reply with ONE JSON object only (no prose, no markdown fences) following this schema:
{schema}
- 3 to 5 enemies with clearly different behaviours valid for the genre. Escalate challenge across levels.
- Names, story and art prompts must match the user's theme and tone. Keep text short; it is shown in-game.
- art_prompt values describe ONE subject for an image generator (appearance, colours, mood), no background.
{code_rule}"""

CODE_RULE_ON = """- Add a "script" that gives the game ONE signature mechanic that fits the idea. Scripting API:
""" + SCRIPTING_DOC
CODE_RULE_OFF = "- Set \"script\" to an empty string."


def system_prompt(allow_code=False):
    return SYSTEM.format(schema=DESIGN_SCHEMA_DOC, code_rule=CODE_RULE_ON if allow_code else CODE_RULE_OFF)


def user_prompt(idea, base_design=None, genre_hint=None):
    parts = []
    if base_design:
        import json
        parts.append("Current design (revise it according to the request, keep what still fits):\n" + json.dumps(base_design, indent=1)[:12000])
        parts.append("Change request: " + idea)
    else:
        parts.append("Game idea: " + (idea or "surprise me with something original"))
    if genre_hint and genre_hint != "auto":
        parts.append(f"Use the genre: {genre_hint}.")
    parts.append("Return the JSON design now.")
    return "\n\n".join(parts)


SCRIPT_SYSTEM = """You write small JavaScript gameplay mods for ComfyGame.
""" + SCRIPTING_DOC + """
Reply with the script body only (no markdown fences, no explanation)."""
