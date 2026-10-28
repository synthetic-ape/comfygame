"""Pixel-art image helpers on RGBA numpy arrays (H, W, 4, uint8)."""
import base64
import io

import numpy as np
from PIL import Image

from . import palettes as P


def blank(w, h):
    return np.zeros((h, w, 4), dtype=np.uint8)


def rgba(color, a=255):
    r, g, b = P.hex_to_rgb(color) if isinstance(color, str) else color[:3]
    return np.array([r, g, b, a], dtype=np.uint8)


def from_rows(rows, colors, w=None, h=None, ox=0, oy=0, into=None):
    """Paint an ASCII template. `colors` maps symbol -> hex; '.' and ' ' are transparent."""
    h = h or len(rows)
    w = w or max(len(r) for r in rows)
    img = into if into is not None else blank(w, h)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in ". " or ch not in colors or colors[ch] is None:
                continue
            px, py = x + ox, y + oy
            if 0 <= px < img.shape[1] and 0 <= py < img.shape[0]:
                img[py, px] = rgba(colors[ch])
    return img


def blit(dst, src, x, y):
    """Alpha-over composite src onto dst at (x, y), clipped."""
    h, w = src.shape[:2]
    H, W = dst.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return dst
    s = src[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.float32)
    d = dst[y0:y1, x0:x1].astype(np.float32)
    a = s[..., 3:4] / 255.0
    out = d.copy()
    out[..., :3] = s[..., :3] * a + d[..., :3] * (1 - a)
    out[..., 3:4] = np.maximum(d[..., 3:4], s[..., 3:4])
    dst[y0:y1, x0:x1] = out.astype(np.uint8)
    return dst


def outline(img, color, diagonal=False, alpha_threshold=128):
    """1px outline outside the opaque silhouette."""
    solid = img[..., 3] >= alpha_threshold
    padded = np.pad(solid, 1)
    grow = np.zeros_like(padded)
    shifts = [(0, 1), (0, -1), (1, 0), (-1, 0)]
    if diagonal:
        shifts += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    for dy, dx in shifts:
        grow |= np.roll(np.roll(padded, dy, axis=0), dx, axis=1)
    edge = grow[1:-1, 1:-1] & ~solid
    out = img.copy()
    out[edge] = rgba(color)
    return out


def inner_shadow(img, color, side="right"):
    """Darken the silhouette edge pixels on one side (cheap volume)."""
    solid = img[..., 3] >= 128
    if side == "right":
        nb = np.roll(solid, -1, axis=1)
    else:
        nb = np.roll(solid, -1, axis=0)
    edge = solid & ~nb
    out = img.copy()
    c = rgba(color)
    out[edge, :3] = ((out[edge, :3].astype(np.int32) + c[:3].astype(np.int32)) // 2).astype(np.uint8)
    return out


def snap(img, palette):
    """Map every opaque pixel to its nearest palette color."""
    pal = P.resolve(palette)
    out = img.copy()
    mask = out[..., 3] > 0
    if not mask.any():
        return out
    cols = out[mask][:, :3]
    uniq, inv = np.unique(cols, axis=0, return_inverse=True)
    mapped = np.array([P.hex_to_rgb(P.nearest(pal, tuple(int(v) for v in u))) for u in uniq], dtype=np.uint8)
    out_cols = mapped[inv.reshape(-1)]
    sub = out[mask]
    sub[:, :3] = out_cols
    out[mask] = sub
    return out


def quantize(img, n_colors):
    """Reduce colors with PIL median cut, keeping alpha binary."""
    rgb = Image.fromarray(img[..., :3])
    q = rgb.quantize(colors=max(2, int(n_colors)), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    out = img.copy()
    out[..., :3] = np.array(q)
    return out


def binarize_alpha(img, threshold=110):
    out = img.copy()
    out[..., 3] = np.where(out[..., 3] >= threshold, 255, 0).astype(np.uint8)
    return out


def bbox(img, threshold=16):
    ys, xs = np.where(img[..., 3] > threshold)
    if len(xs) == 0:
        return 0, 0, img.shape[1], img.shape[0]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def crop(img, box):
    x0, y0, x1, y1 = box
    return img[y0:y1, x0:x1].copy()


def flip_h(img):
    return img[:, ::-1].copy()


def resize(img, w, h, smooth=True):
    pil = Image.fromarray(img, "RGBA")
    if smooth:
        # premultiply so transparent edges do not bleed dark fringes
        arr = img.astype(np.float32)
        a = arr[..., 3:4] / 255.0
        pre = np.concatenate([arr[..., :3] * a, arr[..., 3:4]], axis=-1).astype(np.uint8)
        pil = Image.fromarray(pre, "RGBA").resize((w, h), Image.Resampling.BOX if w < img.shape[1] else Image.Resampling.LANCZOS)
        out = np.array(pil).astype(np.float32)
        a2 = np.clip(out[..., 3:4] / 255.0, 1e-4, 1)
        out[..., :3] = np.clip(out[..., :3] / a2, 0, 255)
        return out.astype(np.uint8)
    return np.array(pil.resize((w, h), Image.Resampling.NEAREST))


def mode_downscale(img, w, h, colors=24, alpha_cut=0.45):
    """Shrink to w x h taking the most common colour of each source block (crisp pixel art, no muddy blends)."""
    from PIL import Image as _I
    H, W = img.shape[:2]
    alpha = img[..., 3].astype(np.float32) / 255.0
    rgb = _I.fromarray(img[..., :3])
    q = rgb.quantize(colors=max(2, int(colors)), method=_I.Quantize.MEDIANCUT, dither=_I.Dither.NONE)
    idx = np.array(q, dtype=np.int32)
    pal = np.array(q.getpalette()[: 3 * 256], dtype=np.uint8).reshape(-1, 3)
    ys = np.linspace(0, H, h + 1).astype(int)
    xs = np.linspace(0, W, w + 1).astype(int)
    out = blank(w, h)
    for ty in range(h):
        for tx in range(w):
            a = alpha[ys[ty]:max(ys[ty] + 1, ys[ty + 1]), xs[tx]:max(xs[tx] + 1, xs[tx + 1])]
            if a.mean() < alpha_cut:
                continue
            block = idx[ys[ty]:max(ys[ty] + 1, ys[ty + 1]), xs[tx]:max(xs[tx] + 1, xs[tx + 1])][a > 0.5]
            if block.size == 0:
                continue
            c = np.bincount(block.ravel()).argmax()
            out[ty, tx, :3] = pal[c]
            out[ty, tx, 3] = 255
    return out


def has_outline(img, dark=0.28):
    """True when the silhouette edge is already mostly dark (art with its own outline)."""
    solid = img[..., 3] > 127
    if solid.sum() < 8:
        return False
    padded = np.pad(solid, 1)
    inner = padded[1:-1, 1:-1] & padded[:-2, 1:-1] & padded[2:, 1:-1] & padded[1:-1, :-2] & padded[1:-1, 2:]
    edge = solid & ~inner
    lum = (img[..., 0] * 0.299 + img[..., 1] * 0.587 + img[..., 2] * 0.114) / 255.0
    return float((lum[edge] < dark).mean()) > 0.55


def upscale(img, k):
    return np.repeat(np.repeat(img, k, axis=0), k, axis=1)


def hstack(frames):
    h = max(f.shape[0] for f in frames)
    w = sum(f.shape[1] for f in frames)
    out = blank(w, h)
    x = 0
    for f in frames:
        out[h - f.shape[0]:, x:x + f.shape[1]] = f
        x += f.shape[1]
    return out


def grid(frames, cols):
    fw, fh = frames[0].shape[1], frames[0].shape[0]
    rows = (len(frames) + cols - 1) // cols
    out = blank(fw * cols, fh * rows)
    for i, f in enumerate(frames):
        out[(i // cols) * fh:(i // cols) * fh + f.shape[0], (i % cols) * fw:(i % cols) * fw + f.shape[1]] = f
    return out


def png_bytes(img):
    buf = io.BytesIO()
    Image.fromarray(img, "RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def data_url(img):
    return "data:image/png;base64," + base64.b64encode(png_bytes(img)).decode("ascii")


def from_data_url(url):
    raw = base64.b64decode(url.split(",", 1)[1])
    return np.array(Image.open(io.BytesIO(raw)).convert("RGBA"))


def checker(w, h, a="#2a2a34", b="#34343f", size=4):
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((xx // size + yy // size) % 2).astype(bool)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[~m] = rgba(a)
    out[m] = rgba(b)
    return out


def preview(img, scale=None, max_side=512, bg=True):
    """Upscaled RGB preview with a checkerboard behind transparency (for ComfyUI image previews)."""
    if scale is None:
        scale = max(1, min(12, max_side // max(img.shape[0], img.shape[1], 1)))
    big = upscale(img, scale)
    if not bg:
        return big
    base = checker(big.shape[1], big.shape[0], size=max(4, scale * 2))
    return blit(base, big, 0, 0)


def to_float_rgb(img):
    """RGBA uint8 -> float32 RGB in 0..1 (ComfyUI IMAGE layout without batch)."""
    return img[..., :3].astype(np.float32) / 255.0


def noise2(w, h, scale, seed, octaves=3):
    """Smooth value noise in 0..1, tileable horizontally when w is a multiple of the cell grid."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), dtype=np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cells = max(1, int(scale * (2 ** o)))
        gw, gh = cells, max(1, int(cells * h / max(1, w)) + 1)
        grid_v = rng.random((gh + 2, gw + 1)).astype(np.float32)
        grid_v[:, -1] = grid_v[:, 0]  # wrap horizontally
        xs = np.linspace(0, gw, w, endpoint=False)
        ys = np.linspace(0, gh, h, endpoint=False)
        x0 = np.floor(xs).astype(int)
        y0 = np.floor(ys).astype(int)
        fx = xs - x0
        fy = ys - y0
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        a = grid_v[y0][:, x0]
        b = grid_v[y0][:, x0 + 1]
        c = grid_v[y0 + 1][:, x0]
        d = grid_v[y0 + 1][:, x0 + 1]
        top = a + (b - a) * fx[None, :]
        bot = c + (d - c) * fx[None, :]
        out += amp * (top + (bot - top) * fy[:, None])
        total += amp
        amp *= 0.5
    return out / total
