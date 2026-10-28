"""LLM providers for AI mode. None of them are needed for the rest of ComfyGame.

claude_code    - your Claude subscription through the Claude Code CLI (`claude -p`), no API key needed
anthropic_api  - Claude via the official `anthropic` Python SDK (pip install anthropic) + ANTHROPIC_API_KEY
openai_compat  - any local OpenAI-compatible server: Ollama, LM Studio, llama.cpp, vLLM ...
comfy_local    - an LLM loaded inside ComfyUI itself (CLIP loader -> text model, e.g. Qwen3 / Gemma)
"""
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request

from . import prompts

PROVIDERS = ["claude_code", "anthropic_api", "openai_compat", "comfy_local"]
DEFAULT_CLAUDE_MODEL = "claude-opus-5-5"
CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
CONFIG_PATH = None  # set by routes to <ComfyUI user dir>/comfygame/config.json


class LLMError(RuntimeError):
    pass


def load_config():
    if CONFIG_PATH and os.path.isfile(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}
    return {}


def save_config(cfg):
    if not CONFIG_PATH:
        return
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)


# ------------------------------------------------------------------ Claude Code (subscription)
def find_claude():
    cfg = load_config()
    cands = [cfg.get("claude_path"), shutil.which("claude"), shutil.which("claude.cmd"),
             os.path.expanduser("~/.local/bin/claude.exe"), os.path.expanduser("~/.local/bin/claude"),
             os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def _claude_alias(model):
    m = (model or "").strip()
    if not m:
        return "opus"
    return m


def claude_code(system, user, model="", effort="medium", timeout=420):
    exe = find_claude()
    if not exe:
        raise LLMError("Claude Code CLI not found. Install it (https://claude.com/claude-code), run `claude` once to log in with your subscription, then retry.")
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as fh:
        fh.write(system)
        sys_path = fh.name
    args = [exe, "-p", "--output-format", "json", "--model", _claude_alias(model), "--tools", "", "--no-session-persistence",
            "--system-prompt-file", sys_path]
    if effort:
        args += ["--effort", effort]
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)  # allow running from inside another Claude Code session
    try:
        r = subprocess.run(args, input=user, capture_output=True, text=True, encoding="utf-8", timeout=timeout, env=env,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise LLMError(f"Claude Code timed out after {timeout}s")
    finally:
        try:
            os.unlink(sys_path)
        except OSError:
            pass
    out = (r.stdout or "").strip()
    if not out:
        raise LLMError("Claude Code failed: " + (r.stderr or "no output").strip()[-600:])
    data = None
    for cand in (out, out.splitlines()[-1]):
        try:
            data = json.loads(cand)
            break
        except ValueError:
            continue
    if not isinstance(data, dict):
        return out
    if data.get("is_error"):
        raise LLMError("Claude Code error: " + str(data.get("result") or data.get("error"))[:600])
    return data.get("result") or ""


# ------------------------------------------------------------------ Anthropic API (official SDK)
def anthropic_api(system, user, model="", effort="medium", api_key=None, max_tokens=32000):
    try:
        import anthropic
    except ImportError:
        raise LLMError("The `anthropic` package is not installed in ComfyUI's Python. Run: python -m pip install anthropic  "
                       "(or use the claude_code provider, which uses your Claude subscription).")
    key = api_key or load_config().get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    model = (model or "").strip() or DEFAULT_CLAUDE_MODEL
    params = dict(model=model, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": user}])
    if effort:
        params["output_config"] = {"effort": effort}
    try:
        # server-side refusal fallback ("default" picks the recommended model per refusal category)
        with client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params) as stream:
            msg = stream.get_final_message()
    except TypeError:
        # older SDK without the `fallbacks` parameter
        with client.messages.stream(**params) as stream:
            msg = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise LLMError("Anthropic API key missing or invalid. Set it in the ComfyGame panel (AI settings) or ANTHROPIC_API_KEY.")
    except anthropic.RateLimitError as e:
        raise LLMError(f"Anthropic rate limit: {e.message}")
    except anthropic.APIStatusError as e:
        raise LLMError(f"Anthropic API error {e.status_code}: {e.message}")
    except anthropic.APIConnectionError:
        raise LLMError("Could not reach the Anthropic API (network).")
    if msg.stop_reason == "refusal":
        raise LLMError("Claude declined this request. Try rephrasing the idea.")
    return "".join(b.text for b in msg.content if b.type == "text")


# ------------------------------------------------------------------ OpenAI-compatible local servers (Ollama, LM Studio...)
def openai_compat(system, user, model="", base_url=None, temperature=0.8, timeout=600):
    cfg = load_config()
    base = (base_url or cfg.get("openai_base_url") or "http://127.0.0.1:11434/v1").rstrip("/")
    model = model or cfg.get("openai_model") or "llama3.1"
    body = {"model": model, "temperature": temperature, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"})
    if cfg.get("openai_api_key"):
        req.add_header("Authorization", "Bearer " + cfg["openai_api_key"])
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise LLMError(f"Local LLM server not reachable at {base} ({e}). Start Ollama / LM Studio or change the URL in AI settings.")
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise LLMError("Unexpected reply from local LLM server: " + json.dumps(data)[:300])


# ------------------------------------------------------------------ LLM inside ComfyUI (TextGenerate machinery)
def comfy_local(system, user, clip, max_length=3072, temperature=0.7, seed=0):
    if clip is None:
        raise LLMError("The comfy_local provider needs a CLIP input: connect a 'Load CLIP' node with a text-generation model (e.g. Qwen3 / Gemma).")
    tokens = clip.tokenize(user, skip_template=False, min_length=1, thinking=False, system_prompt=system)
    ids = clip.generate(tokens, do_sample=temperature > 0, max_length=max_length, temperature=max(0.01, temperature), top_k=64, top_p=0.95, min_p=0.05,
                        repetition_penalty=1.05, presence_penalty=0.0, seed=seed)
    text = clip.decode(ids)
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip()


# ------------------------------------------------------------------ front door
def complete(provider, system, user, model="", effort="medium", clip=None, seed=0, api_key=None, base_url=None):
    provider = provider if provider in PROVIDERS else "claude_code"
    if provider == "claude_code":
        return claude_code(system, user, model, effort)
    if provider == "anthropic_api":
        return anthropic_api(system, user, model, effort, api_key)
    if provider == "openai_compat":
        return openai_compat(system, user, model, base_url)
    return comfy_local(system, user, clip, seed=seed)


def design(idea, provider="claude_code", model="", effort="medium", allow_code=False, base_design=None, genre=None, clip=None, seed=0, retries=1, **kw):
    """Ask an LLM for a game design dict (validated JSON). Retries once with the parse error if the JSON is broken."""
    from ..design import extract_json
    system = prompts.system_prompt(allow_code)
    user = prompts.user_prompt(idea, base_design, genre)
    last_err = None
    text = ""
    for attempt in range(retries + 1):
        text = complete(provider, system, user if attempt == 0 else user + f"\n\nYour previous reply was not valid JSON ({last_err}). Reply with the JSON object only.",
                        model, effort, clip, seed + attempt, **kw)
        try:
            return extract_json(text), text
        except (ValueError, json.JSONDecodeError) as e:
            last_err = str(e)
    raise LLMError(f"The model did not return valid JSON ({last_err}). Raw reply starts: {text[:300]}")


def write_script(request, provider="claude_code", model="", effort="medium", clip=None, seed=0, **kw):
    text = complete(provider, prompts.SCRIPT_SYSTEM, "Write a ComfyGame script that: " + request, model, effort, clip, seed, **kw)
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        t = t.rsplit("```", 1)[0]
    return t.strip()


def status():
    """What can run right now (shown in the ComfyGame panel)."""
    cfg = load_config()
    try:
        import anthropic  # noqa: F401
        sdk = True
    except ImportError:
        sdk = False
    return {
        "claude_code": {"available": bool(find_claude()), "path": find_claude()},
        "anthropic_api": {"available": sdk and bool(cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")), "sdk": sdk,
                          "key": bool(cfg.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY"))},
        "openai_compat": {"base_url": cfg.get("openai_base_url") or "http://127.0.0.1:11434/v1", "model": cfg.get("openai_model") or ""},
        "comfy_local": {"available": True, "note": "connect a Load CLIP node with a text-generation model"},
        "models": CLAUDE_MODELS,
    }
