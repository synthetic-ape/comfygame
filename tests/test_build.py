"""Building games end to end without ComfyUI: every genre, designs, the JS bundle."""
import json
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from comfygame import builder, design, ideas  # noqa: E402
from comfygame import game as G  # noqa: E402


def test_every_genre_builds():
    out = tempfile.mkdtemp()
    try:
        for genre in G.GENRES:
            g = G.complete(G.new_game(f"Test {genre}", genre, 5))
            spec = G.runtime_spec(g, compress_audio=False)
            assert spec["genre"] == genre and spec["levels"] and spec["assets"]["sprites"]["player"]["src"].startswith("data:image/png")
            assert spec["player"]["hp"] >= 3
            info = builder.write_game(spec, g, out)
            html = open(info["html"], encoding="utf-8").read()
            assert "CG.boot(window.CG_GAME)" in html and "</script>" in html
            assert os.path.isfile(os.path.join(info["folder"], "thumb.png"))
        assert len(builder.list_games(out)) == len(G.GENRES)
    finally:
        shutil.rmtree(out, ignore_errors=True)


def test_runtime_bundle_is_valid_javascript():
    node = shutil.which("node")
    if not node:
        return
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(builder.bundle_js())
        path = fh.name
    try:
        r = subprocess.run([node, "--check", path], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    finally:
        os.unlink(path)


def test_design_json_is_forgiving():
    messy = 'Sure! Here is your game:\n```json\n{"title": "Goo Raid", "genre": "Arena", "theme": "icy kitchen", "enemies": [{"name": "Blob", "look": "a green jelly", "behavior": "chase"},],\n "player": {"look": "penguin", "weapon": "lasers"}}\n```\nHave fun!'
    g = design.to_game(messy)
    assert g["genre"] == "arena" and g["theme"] == "snow"
    assert g["enemies"][0]["kind"] == "slime" and g["enemies"][0]["behavior"] == "chaser"
    assert g["player"]["kind"] == "fox" and g["player"]["weapon"] == "laser"
    truncated = '{"title": "Half", "genre": "shmup", "enemies": [{"name": "A", "behavior": "line"}'
    assert design.extract_json(truncated)["title"] == "Half"


def test_bad_palettes_never_leak_magenta():
    from comfygame import palettes
    assert palettes.resolve(["light blue", "#zzz", "#12345", "white"]) == palettes.PALETTES["forest"]
    g = design.to_game({"title": "X", "genre": "platformer", "theme": "ice", "palette": ["#ffffff", "#cccccc", "pale pink", "#000"]})
    assert "#ff00ff" not in g["palette"] and len(g["palette"]) >= 8


def test_idea_dice_designs_are_valid():
    for seed in range(30):
        d = ideas.roll(seed)
        g = design.to_game(d, seed)
        assert g["genre"] in G.GENRES and g["enemies"] and g["boss"]
        assert json.loads(json.dumps(d))


def test_art_prompts_cover_every_slot():
    g = design.to_game(ideas.roll(3, "platformer"), 3)
    p = design.art_prompts(g)
    assert all(p[k] for k in ("player", "enemy_1", "boss", "background", "tiles"))


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
