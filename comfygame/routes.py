"""HTTP routes under /comfygame (also reachable as /api/comfygame) used by the ComfyGame panel and for automation."""
import asyncio
import io
import json
import os
import re
import zipfile

from aiohttp import web

import folder_paths
from server import PromptServer

from . import builder, design, ideas
from . import game as G
from .llm import prompts as llm_prompts
from .llm import providers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,80}$")


def out_root():
    return os.path.join(folder_paths.get_output_directory(), "comfygame")


def _game_dir(gid):
    if not ID_RE.match(gid or ""):
        raise web.HTTPBadRequest(text="bad id")
    d = os.path.join(out_root(), gid)
    if not os.path.isfile(os.path.join(d, "index.html")):
        raise web.HTTPNotFound(text="no such game")
    return d


def build_from_design(d, seed=None):
    g = design.to_game(d, seed)
    done = G.complete(g)
    spec = G.runtime_spec(done)
    info = builder.write_game(spec, done, out_root())
    return info["meta"]


def register():
    routes = PromptServer.instance.routes
    try:
        providers.CONFIG_PATH = os.path.join(folder_paths.get_user_directory(), "default", "comfygame", "config.json")
    except Exception:
        providers.CONFIG_PATH = os.path.join(ROOT, "config.local.json")

    @routes.get("/comfygame/games")
    async def games(request):
        return web.json_response(builder.list_games(out_root()))

    @routes.get("/comfygame/play/{gid}")
    async def play(request):
        d = _game_dir(request.match_info["gid"])
        return web.FileResponse(os.path.join(d, "index.html"), headers={"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache"})

    @routes.get("/comfygame/thumb/{gid}")
    async def thumb(request):
        d = _game_dir(request.match_info["gid"])
        return web.FileResponse(os.path.join(d, "thumb.png"), headers={"Cache-Control": "no-cache"})

    @routes.get("/comfygame/game/{gid}")
    async def game_json(request):
        d = _game_dir(request.match_info["gid"])
        with open(os.path.join(d, "game.json"), "r", encoding="utf-8") as fh:
            return web.json_response(json.load(fh))

    @routes.get("/comfygame/download/{gid}")
    async def download(request):
        gid = request.match_info["gid"]
        d = _game_dir(gid)
        if request.query.get("zip"):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                z.write(os.path.join(d, "index.html"), "index.html")
                z.write(os.path.join(d, "thumb.png"), "cover.png")
            return web.Response(body=buf.getvalue(), headers={"Content-Type": "application/zip", "Content-Disposition": f'attachment; filename="{gid}.zip"'})
        return web.FileResponse(os.path.join(d, "index.html"), headers={"Content-Type": "text/html; charset=utf-8", "Content-Disposition": f'attachment; filename="{gid}.html"'})

    @routes.delete("/comfygame/games/{gid}")
    async def delete(request):
        gid = request.match_info["gid"]
        if not ID_RE.match(gid):
            raise web.HTTPBadRequest(text="bad id")
        return web.json_response({"deleted": builder.delete_game(out_root(), gid)})

    @routes.get("/comfygame/providers")
    async def provider_status(request):
        return web.json_response(await asyncio.get_running_loop().run_in_executor(None, providers.status))

    @routes.post("/comfygame/config")
    async def set_config(request):
        body = await request.json()
        cfg = providers.load_config()
        for k in ("anthropic_api_key", "openai_base_url", "openai_model", "openai_api_key", "claude_path"):
            if k in body:
                v = str(body[k] or "").strip()
                if v:
                    cfg[k] = v
                else:
                    cfg.pop(k, None)
        providers.save_config(cfg)
        return web.json_response({"ok": True})

    @routes.get("/comfygame/system_prompt")
    async def system_prompt(request):
        code = request.query.get("code") == "1"
        return web.Response(text=llm_prompts.system_prompt(code), content_type="text/plain")

    @routes.get("/comfygame/dice")
    async def dice(request):
        seed = int(request.query.get("seed", "0") or 0)
        return web.json_response(ideas.roll(seed, request.query.get("genre", "any"), request.query.get("theme", "any")))

    @routes.post("/comfygame/design")
    async def ai_design(request):
        b = await request.json()
        base = None
        if b.get("base_id"):
            try:
                with open(os.path.join(_game_dir(b["base_id"]), "game.json"), "r", encoding="utf-8") as fh:
                    base = json.load(fh).get("design")
            except web.HTTPException:
                base = None

        def run():
            d, _ = providers.design(b.get("idea", ""), b.get("provider", "claude_code"), b.get("model", ""), b.get("effort", "medium"),
                                    bool(b.get("allow_code")), base, b.get("genre"), None, int(b.get("seed", 0) or 0))
            return d
        try:
            d = await asyncio.get_running_loop().run_in_executor(None, run)
        except providers.LLMError as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response({"design": d, "summary": G.summary(design.to_game(d))})

    @routes.post("/comfygame/build")
    async def build(request):
        b = await request.json()
        d = b.get("design")
        if not d:
            return web.json_response({"error": "missing design"}, status=400)
        try:
            meta = await asyncio.get_running_loop().run_in_executor(None, lambda: build_from_design(d, b.get("seed")))
        except Exception as e:  # report generation problems to the panel instead of a bare 500
            return web.json_response({"error": f"{type(e).__name__}: {e}"}, status=500)
        return web.json_response(meta)

    @routes.get("/comfygame/workflows")
    async def workflows(request):
        wdir = os.path.join(ROOT, "example_workflows")
        names = sorted(f[:-5] for f in os.listdir(wdir) if f.endswith(".json")) if os.path.isdir(wdir) else []
        return web.json_response(names)

    @routes.get("/comfygame/workflows/{name}")
    async def workflow(request):
        name = request.match_info["name"]
        if not re.match(r"^[\w .-]+$", name):
            raise web.HTTPBadRequest(text="bad name")
        p = os.path.join(ROOT, "example_workflows", name + ".json")
        if not os.path.isfile(p):
            raise web.HTTPNotFound()
        with open(p, "r", encoding="utf-8") as fh:
            return web.json_response(json.load(fh))
