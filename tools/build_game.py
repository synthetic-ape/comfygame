"""Build a ComfyGame without ComfyUI (needs numpy + Pillow; PyAV optional for MP3 music).

    python tools/build_game.py --genre platformer --seed 7 --title "Moss Knight" --out games
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from comfygame import builder, game as G  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--genre", default="platformer", choices=G.GENRES)
    ap.add_argument("--title", default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--theme", default=None)
    ap.add_argument("--palette", default=None)
    ap.add_argument("--difficulty", default="normal")
    ap.add_argument("--levels", type=int, default=0)
    ap.add_argument("--out", default="games")
    a = ap.parse_args()
    t = time.time()
    g = G.new_game(a.title or f"{a.genre.title()} {a.seed}", a.genre, a.seed, a.difficulty, theme=a.theme, palette=a.palette)
    if a.levels:
        g["level_settings"]["count"] = a.levels
    g = G.complete(g, progress=lambda m: print("  ", m, f"{time.time() - t:.1f}s"))
    spec = G.runtime_spec(g)
    info = builder.write_game(spec, g, a.out)
    print(f"built {info['html']} ({info['meta']['size'] // 1024} KB) in {time.time() - t:.1f}s")


if __name__ == "__main__":
    main()
