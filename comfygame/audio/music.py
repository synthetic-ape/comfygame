"""Procedural chiptune composer: mood -> key, progression, motif-based melody, bass, arps, pads and drums.

`compose()` returns song data; `render()` turns it into a seamless stereo loop (numpy float, SR=32000).
"""
import random

import numpy as np

from . import synth as S

SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "dorian": [0, 2, 3, 5, 7, 9, 10],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10], "harmonic": [0, 2, 3, 5, 7, 8, 11], "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
}

MOODS = {
    "heroic": dict(scales=["major"], tempo=(132, 150), progs=[[1, 5, 6, 4], [1, 4, 5, 5], [6, 4, 1, 5], [4, 5, 3, 6]], bass="octave", arp="fast", pad=False, drums="rock", density=0.7),
    "adventure": dict(scales=["major", "mixolydian"], tempo=(120, 138), progs=[[1, 4, 1, 5], [1, 6, 4, 5], [4, 5, 3, 6], [1, 7, 4, 1]], bass="walk", arp="fast", pad=False, drums="rock", density=0.6),
    "happy": dict(scales=["major", "lydian"], tempo=(128, 146), progs=[[1, 6, 4, 5], [4, 5, 1, 1], [1, 3, 4, 5]], bass="bounce", arp="fast", pad=False, drums="pop", density=0.65),
    "chill": dict(scales=["dorian", "major"], tempo=(84, 100), progs=[[1, 6, 2, 5], [4, 3, 2, 1], [1, 4, 6, 5]], bass="long", arp="slow", pad=True, drums="lofi", density=0.4, sevenths=True),
    "spooky": dict(scales=["harmonic", "minor"], tempo=(92, 112), progs=[[1, 6, 4, 5], [1, 7, 6, 5], [1, 4, 1, 5]], bass="creep", arp="slow", pad=True, drums="sparse", density=0.4),
    "mysterious": dict(scales=["dorian", "phrygian"], tempo=(96, 112), progs=[[1, 7, 4, 1], [1, 2, 7, 1], [6, 7, 1, 1]], bass="long", arp="slow", pad=True, drums="sparse", density=0.45),
    "intense": dict(scales=["minor", "harmonic"], tempo=(150, 172), progs=[[1, 7, 6, 7], [1, 6, 3, 7], [6, 7, 1, 1]], bass="drive", arp="fast", pad=False, drums="fast", density=0.75),
    "epic": dict(scales=["minor"], tempo=(126, 140), progs=[[1, 6, 3, 7], [6, 7, 1, 1], [1, 4, 6, 5]], bass="octave", arp="fast", pad=True, drums="rock", density=0.6),
    "retro": dict(scales=["major"], tempo=(138, 156), progs=[[1, 4, 5, 4], [1, 6, 2, 5], [1, 1, 4, 5]], bass="bounce", arp="fast", pad=False, drums="pop", density=0.7),
    "boss": dict(scales=["harmonic", "phrygian"], tempo=(160, 178), progs=[[1, 1, 6, 5], [1, 2, 1, 7], [6, 5, 1, 1]], bass="drive", arp="fast", pad=False, drums="fast", density=0.8),
}
MOOD_NAMES = list(MOODS.keys())

INSTRUMENTS = {
    "nes": dict(lead=("pulse", 0.25), arp=("pulse", 0.125), bass=("triangle", 0.5), pad=("pulse", 0.5), cutoff=9000, echo=0.18),
    "gameboy": dict(lead=("pulse", 0.125), arp=("pulse", 0.25), bass=("pulse", 0.5), pad=("pulse", 0.25), cutoff=6000, echo=0.12),
    "soft": dict(lead=("triangle", 0.5), arp=("sine", 0.5), bass=("sine", 0.5), pad=("triangle", 0.5), cutoff=4200, echo=0.32),
    "synth": dict(lead=("saw", 0.5), arp=("pulse", 0.25), bass=("pulse", 0.5), pad=("saw", 0.5), cutoff=3800, echo=0.28),
}

RHYTHMS = {
    "sparse": [[0, 8], [0, 6, 8], [0, 12], [0, 4, 8]],
    "medium": [[0, 4, 8, 12], [0, 4, 6, 8, 12], [0, 3, 6, 8, 12], [0, 6, 8, 12], [0, 4, 8, 10, 12], [0, 3, 6, 10, 12]],
    "busy": [[0, 2, 4, 6, 8, 10, 12, 14], [0, 2, 4, 8, 10, 12, 14], [0, 3, 6, 8, 10, 12, 14], [0, 2, 4, 6, 8, 12, 14]],
}

DRUMS = {
    "rock": ("x.......x.x.....", "....x.......x...", "x.x.x.x.x.x.x.x."),
    "pop": ("x...x...x...x...", "....x.......x...", "..x...x...x...x."),
    "fast": ("x..x..x.x..x..x.", "....x.......x...", "xxxxxxxxxxxxxxxx"),
    "lofi": ("x......x..x.....", "....x.......x...", "x.x.x.x.x.x.x.x."),
    "sparse": ("x.......x.......", "............x...", "....x.......x..."),
}


def _chord(scale, root, degree, sevenths=False):
    idx = degree - 1
    tones = []
    for k in (0, 2, 4) + ((6,) if sevenths else ()):
        i = idx + k
        tones.append(root + scale[i % 7] + 12 * (i // 7))
    return tones


def compose(mood="adventure", seed=0, tempo=0, bars=16, key=None, instruments="nes"):
    mood = mood if mood in MOODS else "adventure"
    M = MOODS[mood]
    rng = random.Random(seed * 7 + sum(map(ord, mood)))
    scale_name = rng.choice(M["scales"])
    scale = SCALES[scale_name]
    root = 48 + (key if key is not None else rng.choice([0, 2, 3, 5, 7, 9, 10]))
    bpm = tempo or rng.randint(*M["tempo"])
    bars = max(8, int(bars) // 8 * 8)
    progA = rng.choice(M["progs"])
    progB = rng.choice([p for p in M["progs"] if p != progA] or M["progs"])
    chords = []
    for b in range(bars):
        section = (b // 8) % 2
        prog = progA if section == 0 else progB
        chords.append(prog[b % 4])
    dens = M["density"]
    rhythm_pool = RHYTHMS["busy"] if dens > 0.68 else RHYTHMS["medium"] if dens > 0.42 else RHYTHMS["sparse"] + RHYTHMS["medium"][:2]

    def make_motif():
        motif = []
        for bar in range(2):
            rh = rng.choice(rhythm_pool)
            notes = []
            for i, s in enumerate(rh):
                if rng.random() < 0.12 and i > 0:
                    continue
                step = rng.choice([-2, -1, -1, 1, 1, 2, 0, 3, -3])
                notes.append((s, step))
            motif.append(notes)
        return motif

    lead_lo, lead_hi = root + 12, root + 26
    melody = []  # (bar, step, midi, length_steps)
    pitch = root + 12 + scale[2]
    motifs = [make_motif(), make_motif()]

    def scale_snap(p):
        best = None
        for o in range(-1, 4):
            for iv in scale:
                q = root + iv + 12 * o
                if best is None or abs(q - p) < abs(best - p):
                    best = q
        return best

    for b in range(bars):
        section = (b // 8) % 2
        phrase_bar = b % 8
        motif = motifs[section]
        notes = motif[phrase_bar % 2]
        chord = _chord(scale, root + 12, chords[b], M.get("sevenths"))
        lift = 2 if phrase_bar in (4, 5) and section == 0 else 0
        last_bar = phrase_bar == 7
        if last_bar:
            notes = [(0, 0), (4, 0), (8, 0)]
        for i, (s, step) in enumerate(notes):
            target = pitch
            if s in (0, 8):
                cands = [c + 12 * o for c in chord for o in (-1, 0, 1)]
                cands = [c for c in cands if lead_lo <= c <= lead_hi] or chord
                target = min(cands, key=lambda c: abs(c - (pitch + step * 2 + lift)))
            else:
                target = scale_snap(pitch + step * 2 + lift)
            if target > lead_hi:
                target -= 12
            if target < lead_lo:
                target += 12
            if last_bar and i == len(notes) - 1:
                target = min([c for c in [root + 12, root + 24] if lead_lo <= c <= lead_hi] or [root + 12])
            nxt = notes[i + 1][0] if i + 1 < len(notes) else 16
            length = (nxt - s) if not (last_bar and i == len(notes) - 1) else 8
            melody.append((b, s, int(target), max(1, length)))
            pitch = target
    return {"mood": mood, "bpm": bpm, "bars": bars, "root": root, "scale": scale_name, "chords": chords, "melody": melody,
            "bass": M["bass"], "arp": M["arp"], "pad": M["pad"], "drums": M["drums"], "sevenths": bool(M.get("sevenths")),
            "instruments": instruments if instruments in INSTRUMENTS else "nes", "seed": seed}


def render(song, sr=S.SR):
    bpm = song["bpm"]
    step = 60.0 / bpm / 4
    bars = song["bars"]
    total = int(round(bars * 16 * step * sr))
    tail = int(2.0 * sr)
    n = total + tail
    L = np.zeros(n)
    R = np.zeros(n)
    ins = INSTRUMENTS[song["instruments"]]
    scale = SCALES[song["scale"]]
    root = song["root"]
    rng = random.Random(song["seed"])

    def place(y, t, pan=0.5, gain=1.0):
        i = int(t * sr)
        if i >= n:
            return
        y = y[: n - i]
        L[i:i + len(y)] += y * gain * (1 - pan) * 2 * 0.5
        R[i:i + len(y)] += y * gain * pan * 2 * 0.5

    # lead
    lead = np.zeros(n)
    for b, s, midi, ln in song["melody"]:
        t = (b * 16 + s) * step
        dur = ln * step * 0.92
        y = S.note(ins["lead"][0], midi, dur, 0.33, ins["lead"][1], env=(0.004, 0.06, 0.7, min(0.08, dur * 0.3)), vibrato=0.25 if dur > 0.2 else 0, cutoff=ins["cutoff"])
        i = int(t * sr)
        lead[i:i + len(y)] += y[: max(0, n - i)]
    lead = S.echo(lead, step * 3, 0.35, ins["echo"])
    L += lead * 0.95
    R += lead * 0.8
    # bass
    bass_kind = song["bass"]
    for b in range(bars):
        deg = song["chords"][b]
        r = root - 12 + scale[(deg - 1) % 7] + 12 * ((deg - 1) // 7)
        fifth = r + 7
        if bass_kind == "octave":
            pat = [(s, r if (s // 2) % 2 == 0 else r + 12, 2) for s in range(0, 16, 2)]
        elif bass_kind == "walk":
            nxt = song["chords"][(b + 1) % bars]
            nr = root - 12 + scale[(nxt - 1) % 7]
            pat = [(0, r, 4), (4, fifth, 4), (8, r + 12, 4), (12, nr + (1 if nr < r + 12 else -1), 4)]
        elif bass_kind == "bounce":
            pat = [(0, r, 3), (4, fifth, 3), (8, r + 12, 3), (12, fifth, 3)]
        elif bass_kind == "long":
            pat = [(0, r, 10), (10, fifth, 6)]
        elif bass_kind == "drive":
            pat = [(s, r if s != 14 else r + 12, 2) for s in range(0, 16, 2)]
        else:  # creep
            pat = [(0, r, 7), (8, r + (1 if b % 2 else -1), 7)]
        for s, midi, ln in pat:
            y = S.note(ins["bass"][0], midi, ln * step * 0.9, 0.42, ins["bass"][1], env=(0.003, 0.05, 0.8, 0.03), cutoff=2400)
            place(y, (b * 16 + s) * step, 0.5)
    # arp / pad
    for b in range(bars):
        chord = _chord(scale, root + 12, song["chords"][b], song["sevenths"])
        if song["arp"] == "fast":
            seq = chord + [chord[0] + 12]
            for s in range(16):
                y = S.note(ins["arp"][0], seq[s % len(seq)], step * 0.6, 0.11, ins["arp"][1], env=(0.002, 0.03, 0.4, 0.02), cutoff=ins["cutoff"])
                place(y, (b * 16 + s) * step, 0.72)
        elif song["arp"] == "slow":
            seq = chord + [chord[1] + 12]
            for s in range(0, 16, 2):
                y = S.note(ins["arp"][0], seq[(s // 2) % len(seq)] + 12, step * 1.6, 0.09, ins["arp"][1], env=(0.004, 0.1, 0.3, 0.1), cutoff=ins["cutoff"])
                place(y, (b * 16 + s) * step, 0.7)
        if song["pad"]:
            for midi in chord:
                y = S.note(ins["pad"][0], midi - 12, 16 * step, 0.06, ins["pad"][1], env=(0.3, 0.2, 0.8, 0.3), cutoff=1600, vibrato=0.08)
                place(y, b * 16 * step, 0.3 + 0.4 * rng.random())
    # drums
    kp, sp, hp = DRUMS[song["drums"]]
    K, SN = S.kick(), S.snare()
    HT, HO = S.hat(), S.hat(open_=True)
    for b in range(bars):
        fill = (b % 8) == 7
        for s in range(16):
            t = (b * 16 + s) * step
            if kp[s] == "x" and not (fill and s >= 12):
                place(K, t, 0.5, 0.55)
            if sp[s] == "x" or (fill and s >= 12 and (s % 2 == 0 or song["drums"] == "fast")):
                place(SN, t, 0.48, 0.35 if not fill else 0.28 + 0.04 * (s - 11))
            if hp[s] == "x":
                place(HO if (s == 14 and song["drums"] == "rock") else HT, t, 0.62, 0.22 if s % 4 else 0.3)
    # wrap the tail into the start so the loop is seamless
    L[:tail] += L[total:total + tail]
    R[:tail] += R[total:total + tail]
    mix = np.stack([L[:total], R[:total]], axis=1)
    mix = S.softclip(mix * 1.1, 1.2)
    return S.normalize(mix, 0.88)


def loop_spec(audio, sr=S.SR, compress=True):
    """Encode a loop so it repeats seamlessly even after codec padding: [song][first 2s], loop window offset 0.25s."""
    pad = int(2.0 * sr)
    ext = np.concatenate([audio, audio[:pad]], axis=0)
    off = 0.25
    return {"src": S.data_url(ext, sr, compress), "loopStart": off, "loopEnd": off + len(audio) / sr, "duration": len(audio) / sr}


def jingle(kind="win", seed=0, root=60, sr=S.SR):
    if kind == "win":
        seq = [(0, 0.09), (4, 0.09), (7, 0.09), (12, 0.09), (16, 0.09), (19, 0.09), (24, 0.5)]
    else:
        seq = [(7, 0.22), (6, 0.22), (5, 0.22), (0, 0.9)]
    out = []
    for semi, dur in seq:
        y = S.note("pulse", root + semi, dur, 0.4, 0.25, env=(0.003, 0.05, 0.7, 0.05 if dur < 0.3 else 0.4), vibrato=0.2 if dur > 0.3 else 0)
        b = S.note("triangle", root - 12 + (semi % 12), dur, 0.35)
        out.append(y + b[: len(y)])
    x = np.concatenate(out)
    x = S.echo(x, 0.12, 0.3, 0.25)
    return S.normalize(x, 0.8)
