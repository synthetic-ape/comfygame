"""Tiny numpy chiptune synthesizer: oscillators, envelopes, drums, effects and audio encoding."""
import base64
import io
import wave

import numpy as np

SR = 32000


def midi_hz(n):
    return 440.0 * 2 ** ((np.asarray(n, dtype=np.float64) - 69) / 12.0)


def phase(freq, n, sr=SR):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.cumsum(f / sr)


def osc(kind, freq, n, duty=0.5, sr=SR, seed=0):
    ph = phase(freq, n, sr)
    frac = ph % 1.0
    if kind == "pulse" or kind == "square":
        return np.where(frac < duty, 1.0, -1.0)
    if kind == "triangle":
        tri = 2 * np.abs(2 * frac - 1) - 1
        return np.round(tri * 7.5) / 7.5  # 4-bit stepped triangle, NES style
    if kind == "saw":
        return 2 * frac - 1
    if kind == "sine":
        return np.sin(2 * np.pi * ph)
    if kind == "noise":
        rng = np.random.default_rng(seed)
        steps = np.floor(ph * 2).astype(np.int64)
        vals = rng.uniform(-1, 1, int(steps.max()) + 2 if n else 1)
        return vals[steps]
    raise ValueError(kind)


def adsr(n, a=0.005, d=0.05, s=0.7, r=0.05, sr=SR, gate=None):
    """Envelope for n samples; release starts at `gate` samples (default n - release)."""
    env = np.zeros(n, dtype=np.float64)
    A, D, R = int(a * sr), int(d * sr), int(r * sr)
    gate = n - R if gate is None else min(gate, n)
    i = 0
    if A > 0:
        k = min(A, gate)
        env[:k] = np.linspace(0, 1, A, endpoint=False)[:k]
        i = k
    if i < gate and D > 0:
        k = min(D, gate - i)
        env[i:i + k] = np.linspace(1, s, D, endpoint=False)[:k]
        i += k
    if i < gate:
        env[i:gate] = s
    level = env[gate - 1] if gate > 0 else 0
    if gate < n:
        env[gate:] = level * np.linspace(1, 0, n - gate)
    return env


def lowpass(x, cutoff, sr=SR):
    """One-pole lowpass (vectorized via exponential smoothing in chunks for speed)."""
    if cutoff >= sr / 2:
        return x
    a = np.exp(-2 * np.pi * cutoff / sr)
    try:
        from scipy.signal import lfilter
        return lfilter([1 - a], [1, -a], x)
    except Exception:  # pragma: no cover - scipy missing
        y = np.empty_like(x)
        acc = 0.0
        for i, v in enumerate(x):
            acc = (1 - a) * v + a * acc
            y[i] = acc
        return y


def highpass(x, cutoff, sr=SR):
    return x - lowpass(x, cutoff, sr)


def note(kind, midi, dur, vel=1.0, duty=0.5, env=(0.005, 0.08, 0.6, 0.06), vibrato=0.0, vib_delay=0.12, slide=0.0, sr=SR, cutoff=None, seed=0):
    n = max(1, int(dur * sr))
    t = np.arange(n) / sr
    f = midi_hz(midi) * np.ones(n)
    if slide:
        f *= 2 ** (slide * np.minimum(1, t / max(dur, 1e-3)) / 12)
    if vibrato:
        depth = np.clip((t - vib_delay) / 0.1, 0, 1) * vibrato
        f *= 2 ** (depth * np.sin(2 * np.pi * 5.5 * t) / 12)
    y = osc(kind, f, n, duty, sr, seed)
    y *= adsr(n, *env, sr=sr)
    if cutoff:
        y = lowpass(y, cutoff, sr)
    return y * vel


def kick(sr=SR, vel=1.0):
    n = int(0.16 * sr)
    t = np.arange(n) / sr
    f = 48 + 120 * np.exp(-t * 38)
    y = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-t * 18)
    y[: int(0.004 * sr)] += np.random.default_rng(1).uniform(-0.4, 0.4, int(0.004 * sr))
    return np.tanh(y * 1.6) * vel


def snare(sr=SR, vel=1.0, seed=2):
    n = int(0.17 * sr)
    t = np.arange(n) / sr
    noise = np.random.default_rng(seed).uniform(-1, 1, n)
    noise = highpass(noise, 1200, sr) * np.exp(-t * 22)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30) * 0.6
    return (noise * 0.9 + tone) * vel


def hat(sr=SR, vel=1.0, open_=False, seed=3):
    n = int((0.12 if open_ else 0.04) * sr)
    t = np.arange(n) / sr
    noise = np.random.default_rng(seed).uniform(-1, 1, n)
    return highpass(noise, 6000, sr) * np.exp(-t * (18 if open_ else 80)) * vel * 0.6


def echo(x, delay_s, feedback=0.35, mix=0.3, sr=SR, wrap=False):
    d = int(delay_s * sr)
    if d <= 0:
        return x
    out = x.copy()
    tap = x.copy()
    for _ in range(4):
        tap = np.concatenate([np.zeros(d), tap[:-d]]) if not wrap else np.roll(tap, d)
        tap = tap * feedback
        out += tap * (mix / feedback)
    return out


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def normalize(x, peak=0.89):
    m = np.max(np.abs(x)) if x.size else 0
    return x * (peak / m) if m > 1e-6 else x


def to_pcm16(x):
    return (np.clip(x, -1, 1) * 32767).astype(np.int16)


def wav_bytes(x, sr=SR):
    """x: (n,) mono or (n, 2) stereo float."""
    pcm = to_pcm16(x)
    ch = 1 if pcm.ndim == 1 else pcm.shape[1]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(ch)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def mp3_bytes(x, sr=SR, bitrate=96000):
    """Encode with PyAV (bundled with ComfyUI). Returns None if unavailable."""
    try:
        import av
    except Exception:
        return None
    try:
        stereo = x.ndim == 2
        buf = io.BytesIO()
        container = av.open(buf, mode="w", format="mp3")
        stream = container.add_stream("libmp3lame" if "libmp3lame" in av.codecs_available else "mp3", rate=sr)
        stream.bit_rate = bitrate
        stream.layout = "stereo" if stereo else "mono"
        data = to_pcm16(x)
        planar = data.T.copy() if stereo else data[None, :].copy()
        frame_size = 1152
        for i in range(0, planar.shape[1], frame_size):
            chunk = np.ascontiguousarray(planar[:, i:i + frame_size])
            frame = av.AudioFrame.from_ndarray(chunk, format="s16p", layout="stereo" if stereo else "mono")
            frame.sample_rate = sr
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
        container.close()
        return buf.getvalue()
    except Exception as e:  # pragma: no cover - codec quirks
        print("[ComfyGame] mp3 encode failed, using wav:", e)
        return None


def data_url(x, sr=SR, compress=True):
    if compress:
        b = mp3_bytes(x, sr)
        if b:
            return "data:audio/mpeg;base64," + base64.b64encode(b).decode("ascii")
    return "data:audio/wav;base64," + base64.b64encode(wav_bytes(x, sr)).decode("ascii")


def to_comfy_audio(x, sr=SR):
    """ComfyUI AUDIO dict: {"waveform": [1, C, N] float tensor, "sample_rate": sr}."""
    import torch
    arr = x.T if x.ndim == 2 else x[None, :]
    return {"waveform": torch.from_numpy(np.ascontiguousarray(arr, dtype=np.float32)).unsqueeze(0), "sample_rate": int(sr)}


def from_comfy_audio(audio):
    wf = audio["waveform"]
    sr = int(audio["sample_rate"])
    arr = wf[0].detach().cpu().float().numpy() if hasattr(wf, "detach") else np.asarray(wf)[0]
    x = arr.T if arr.shape[0] <= 2 else arr
    if x.ndim == 2 and x.shape[1] == 1:
        x = x[:, 0]
    return x.astype(np.float64), sr
