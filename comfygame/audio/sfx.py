"""sfxr-style sound effects: presets with seeded variation and a few timbre styles."""
import random

import numpy as np

from . import synth as S

SR = 22050

# name: (wave, start_hz, end_hz, attack, sustain, decay, extras)
PRESETS = {
    "jump": ("pulse", 260, 620, 0.0, 0.05, 0.12, {"duty": 0.25}),
    "coin": ("pulse", 980, 980, 0.0, 0.04, 0.16, {"arp": (0.05, 1.5), "duty": 0.5}),
    "hit": ("noise", 1800, 300, 0.0, 0.02, 0.12, {"tone": 140}),
    "hurt": ("saw", 420, 90, 0.0, 0.06, 0.2, {"vib": 0.3}),
    "shoot": ("pulse", 1200, 220, 0.0, 0.02, 0.12, {"duty": 0.15}),
    "explode": ("noise", 900, 60, 0.0, 0.12, 0.55, {"tone": 55, "lp": 2500}),
    "powerup": ("pulse", 300, 900, 0.0, 0.2, 0.25, {"arp": (0.06, 1.25), "vib": 0.15, "duty": 0.3}),
    "select": ("pulse", 660, 660, 0.0, 0.03, 0.05, {"duty": 0.5}),
    "land": ("noise", 500, 120, 0.0, 0.01, 0.07, {"lp": 1500}),
    "dash": ("noise", 2400, 600, 0.0, 0.05, 0.16, {"lp": 4000}),
    "die": ("pulse", 520, 60, 0.0, 0.15, 0.55, {"vib": 0.6, "duty": 0.5}),
    "step": ("noise", 300, 200, 0.0, 0.005, 0.03, {"lp": 1200}),
}
NAMES = list(PRESETS.keys())

STYLES = {
    "retro": dict(lp=None, pitch=1.0, crush=True),
    "soft": dict(lp=3000, pitch=0.9, crush=False),
    "crunchy": dict(lp=None, pitch=0.85, crush=True, drive=2.5),
    "space": dict(lp=5000, pitch=1.15, crush=False, echo=0.08),
}


def make(name, seed=0, style="retro", sr=SR):
    wave, f0, f1, att, sus, dec, ex = PRESETS[name]
    st = STYLES.get(style, STYLES["retro"])
    rng = random.Random(seed * 131 + sum(map(ord, name)))
    v = 1 + (rng.random() - 0.5) * 0.25 if seed else 1.0
    f0, f1 = f0 * v * st["pitch"], f1 * v * st["pitch"]
    dur = att + sus + dec
    n = int(dur * sr)
    t = np.arange(n) / sr
    k = np.clip(t / dur, 0, 1)
    freq = f0 * (f1 / f0) ** k
    if "arp" in ex:
        at, mul = ex["arp"]
        freq = np.where(t > at, freq * mul, freq)
    if "vib" in ex:
        freq = freq * 2 ** (ex["vib"] * np.sin(2 * np.pi * 14 * t) / 12)
    if wave == "noise":
        y = S.osc("noise", freq, n, sr=sr, seed=seed + 5)
        if "tone" in ex:
            y = y * 0.75 + S.osc("sine", ex["tone"] * (1 - k * 0.5), n, sr=sr) * 0.5
    else:
        y = S.osc(wave, freq, n, ex.get("duty", 0.5), sr=sr)
    env = np.ones(n)
    a, s_ = int(att * sr), int(sus * sr)
    if a:
        env[:a] = np.linspace(0, 1, a)
    env[a + s_:] = np.linspace(1, 0, n - a - s_) ** 1.6
    y *= env
    lp = ex.get("lp") or st.get("lp")
    if lp:
        y = S.lowpass(y, lp, sr)
    if st.get("drive"):
        y = np.tanh(y * st["drive"])
    if st.get("crush"):
        y = np.round(y * 24) / 24
    if st.get("echo"):
        y = np.concatenate([y, np.zeros(int(st["echo"] * 3 * sr))])
        y = S.echo(y, st["echo"], 0.4, 0.35, sr)
    fade = min(len(y), int(0.004 * sr))
    y[-fade:] *= np.linspace(1, 0, fade)
    return S.normalize(y, 0.8)


def pack(seed=0, style="retro", names=None):
    return {name: make(name, seed, style) for name in (names or NAMES)}


def pack_spec(sounds, sr=SR):
    return {name: S.data_url(y, sr, compress=False) for name, y in sounds.items()}


def preview_track(sounds, sr=SR, gap=0.12):
    parts = []
    for y in sounds.values():
        parts.append(y)
        parts.append(np.zeros(int(gap * sr)))
    return np.concatenate(parts) if parts else np.zeros(sr // 10)
