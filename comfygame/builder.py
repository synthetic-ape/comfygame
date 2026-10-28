"""Bundle the JavaScript runtime with a game spec into one self-contained HTML file, plus thumbnails and a library."""
import json
import os
import shutil
import time

import numpy as np
from PIL import Image

from . import backgrounds
from . import pixel as px

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_DIR = os.path.join(ROOT, "runtime")
RUNTIME_FILES = [
    "core/base.js", "core/input.js", "core/audio.js", "core/gfx.js", "core/fx.js", "core/game.js",
    "genres/platformer.js", "genres/topdown.js", "genres/arena.js", "genres/dungeon.js", "genres/shmup.js",
]

_bundle_cache = {"key": None, "js": ""}


def bundle_js():
    paths = [os.path.join(RUNTIME_DIR, f) for f in RUNTIME_FILES]
    key = tuple(os.path.getmtime(p) for p in paths)
    if _bundle_cache["key"] != key:
        parts = []
        for f, p in zip(RUNTIME_FILES, paths):
            with open(p, "r", encoding="utf-8") as fh:
                parts.append(f"/* ---- {f} ---- */\n" + fh.read())
        _bundle_cache["js"] = "\n".join(parts)
        _bundle_cache["key"] = key
    return _bundle_cache["js"]


def _script_json(obj):
    s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return s.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def html(spec):
    title = str(spec.get("title", "ComfyGame")).replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="generator" content="ComfyGame">
<title>{title}</title>
<style>
html,body{{margin:0;height:100%;background:#05050a;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}}
canvas{{display:block;image-rendering:pixelated;image-rendering:crisp-edges;outline:none}}
#cg-loading{{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#8a86a0;font:14px monospace;letter-spacing:2px}}
</style>
</head>
<body>
<div id="cg-loading">LOADING...</div>
<script>
{bundle_js()}
</script>
<script>window.CG_GAME = {_script_json(spec)};</script>
<script>CG.boot(window.CG_GAME);</script>
</body>
</html>
"""


# ---------------------------------------------------------------- thumbnail (uses the same 5x7 font as the runtime)
FONT5x7 = (
    "0000000000" "00005f0000" "0007000700" "147f147f14" "242a7f2a12" "2313086462" "3649552250" "0005030000"
    "001c224100" "0041221c00" "082a1c2a08" "08083e0808" "0050300000" "0808080808" "0060600000" "2010080402"
    "3e5149453e" "00427f4000" "4261514946" "2141454b31" "1814127f10" "2745454539" "3c4a494930" "0171090503"
    "3649494936" "064949291e" "0036360000" "0056360000" "0008142241" "1414141414" "4122140800" "0201510906"
    "324979413e" "7e1111117e" "7f49494936" "3e41414122" "7f4141221c" "7f49494941" "7f09090101" "3e41415132"
    "7f0808087f" "00417f4100" "2040413f01" "7f08142241" "7f40404040" "7f0204027f" "7f0408107f" "3e4141413e"
    "7f09090906" "3e4151215e" "7f09192946" "4649494931" "01017f0101" "3f4040403f" "1f2040201f" "7f2018207f"
    "6314081463" "0304780403" "6151494543" "007f414100" "0204081020" "0041417f00" "0402010204" "4040404040"
    "0001020400" "2054545478" "7f48444438" "3844444420" "384444487f" "3854545418" "087e090102" "081454543c"
    "7f08040478" "00447d4000" "2040443d00" "007f102844" "00417f4000" "7c04180478" "7c08040478" "3844444438"
    "7c14141408" "081414187c" "7c08040408" "4854545420" "043f444020" "3c4040207c" "1c2040201c" "3c4030403c"
    "4428102844" "0c5050503c" "4464544c44" "0008364100" "00007f0000" "0041360800" "08082a1c08"
)


def draw_text(img, text, x, y, color, scale=1, shadow=None):
    rgba = px.rgba(color)
    for dx, dy, col in ([(scale, scale, px.rgba(shadow))] if shadow else []) + [(0, 0, rgba)]:
        cx = x + dx
        for ch in str(text):
            code = ord(ch)
            if code < 32 or code > 126:
                code = 63
            i = code - 32
            for c in range(5):
                bits = int(FONT5x7[i * 10 + c * 2:i * 10 + c * 2 + 2], 16)
                for r in range(8):
                    if bits & (1 << r):
                        y0, x0 = y + dy + r * scale, cx + c * scale
                        img[max(0, y0):max(0, y0 + scale), max(0, x0):max(0, x0 + scale)] = col
            cx += 6 * scale
    return img


def text_width(text, scale=1):
    return max(0, len(str(text)) * 6 - 1) * scale


def thumbnail(game, w=480, h=270):
    bg = game["backgrounds"].get("main")
    img = backgrounds.composite(bg, w, h, 60) if bg else px.blank(w, h)
    img[..., 3] = 255
    dim = img.astype(np.float32)
    dim[..., :3] *= 0.8
    img = dim.astype(np.uint8)
    pal = game["palette"]
    from . import palettes as P
    tc = P.theme_colors(pal)
    title = str(game["title"]).upper()
    scale = 4
    while scale > 1 and text_width(title, scale) > w - 24:
        scale -= 1
    draw_text(img, title, (w - text_width(title, scale)) // 2, int(h * 0.2), P.mix(tc["accent"], "#ffffff", 0.3), scale, shadow="#000000")
    if game.get("tagline"):
        t = str(game["tagline"])[:70]
        draw_text(img, t, (w - text_width(t)) // 2, int(h * 0.2) + scale * 8 + 10, "#e8e4f0", 1, shadow="#000000")
    spr = game["player"]["sprite"]
    f0 = spr["img"][:, :spr["fw"]]
    big = px.upscale(f0, 4)
    px.blit(img, big, w // 2 - big.shape[1] // 2 - 60, int(h * 0.62) - big.shape[0] // 2)
    if game.get("enemies"):
        e = game["enemies"][0]["sprite"]
        eb = px.upscale(np.ascontiguousarray(e["img"][:, :e["fw"]][:, ::-1]), 4)
        px.blit(img, eb, w // 2 - eb.shape[1] // 2 + 60, int(h * 0.62) - eb.shape[0] // 2)
    if game.get("boss"):
        bs = game["boss"]["sprite"]
        bb = px.upscale(np.ascontiguousarray(bs["img"][:, :bs["fw"]][:, ::-1]), 2)
        px.blit(img, bb, w - bb.shape[1] - 20, h - bb.shape[0] - 14)
    label = game["genre"].upper()
    draw_text(img, label, 8, h - 14, tc["accent"], 1, shadow="#000000")
    return img


# ---------------------------------------------------------------- writing & library
def write_game(spec, game, out_root, name=None):
    slug = name or spec["id"]
    folder = os.path.join(out_root, slug)
    os.makedirs(folder, exist_ok=True)
    page = html(spec)
    with open(os.path.join(folder, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(page)
    thumb = thumbnail(game)
    Image.fromarray(thumb[..., :3]).save(os.path.join(folder, "thumb.png"))
    meta = {
        "id": slug, "title": spec["title"], "tagline": spec.get("tagline", ""), "genre": spec["genre"], "seed": spec["seed"],
        "levels": len(spec["levels"]), "created": time.time(), "size": len(page.encode("utf-8")),
    }
    with open(os.path.join(folder, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    with open(os.path.join(folder, "game.json"), "w", encoding="utf-8") as fh:
        json.dump(strip_assets(spec), fh, indent=1)
    return {"id": slug, "folder": folder, "html": os.path.join(folder, "index.html"), "thumb": thumb, "meta": meta}


def strip_assets(spec):
    """The spec without embedded binary assets (readable design JSON, used for AI refinement)."""
    s = dict(spec)
    s.pop("assets", None)
    s["audio"] = {"music": list((spec.get("audio") or {}).get("music", {}).keys()), "sfx": list((spec.get("audio") or {}).get("sfx", {}).keys())}
    return s


def list_games(out_root):
    games = []
    if not os.path.isdir(out_root):
        return games
    for name in os.listdir(out_root):
        mp = os.path.join(out_root, name, "meta.json")
        if os.path.isfile(mp):
            try:
                with open(mp, "r", encoding="utf-8") as fh:
                    games.append(json.load(fh))
            except (OSError, ValueError):
                continue
    games.sort(key=lambda m: -m.get("created", 0))
    return games


def delete_game(out_root, game_id):
    folder = os.path.join(out_root, game_id)
    if os.path.isdir(folder) and os.path.isfile(os.path.join(folder, "meta.json")):
        shutil.rmtree(folder)
        return True
    return False
