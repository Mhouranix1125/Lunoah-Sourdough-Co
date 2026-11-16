"""Makes the wood-grain textures for the Meet Nadia frame, one real-world wood per theme.

    python3 -m venv /tmp/woodenv && /tmp/woodenv/bin/pip install numpy pillow
    /tmp/woodenv/bin/python tools/make-wood-textures.py

Writes pb_public/img/wood-<wood>.webp (seamless tiles, ~20 KB each). themes.css picks one per theme.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "pb_public" / "img"
W, H = 800, 400

# light, mid and dark tones of each wood, plus how strong its grain is (1 = normal)
WOODS = {
    "oak":       ((206, 156, 102), (168, 114, 64), (104, 62, 30), 1.0),   # basic: white oak, honey gold
    "ebony":     ((74, 58, 50), (44, 34, 30), (16, 12, 11), 1.1),         # halloween: near black, faint brown grain
    "walnut":    ((128, 88, 62), (92, 60, 40), (48, 30, 20), 1.0),        # thanksgiving: black walnut, chocolate
    "pine":      ((232, 200, 140), (210, 166, 98), (150, 98, 46), 1.15),  # christmas: knotty pine, pale gold
    "bloodwood": ((168, 70, 62), (128, 40, 38), (70, 18, 20), 1.0),       # valentine's: deep rose red
    "ash":       ((236, 228, 214), (206, 196, 180), (150, 140, 126), 0.9),  # spring: white ash, pale and ashy
    "driftwood": ((196, 190, 180), (158, 152, 142), (98, 94, 88), 1.0),   # summer: weathered silver grey
}


def noise(sy, sx, seed):
    """Smooth noise stretched along x, so it reads as long wood streaks."""
    r = np.random.default_rng(seed)
    gh, gw = max(2, H // sy), max(2, W // sx)
    g = r.random((gh, gw))
    g = np.vstack([g, g[:1]])
    g = np.hstack([g, g[:, :1]])
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((W + W // gw, H + H // gh), Image.BICUBIC)
    return np.asarray(im, float)[:H, :W] / 255


def grain():
    """One grain pattern (0 = light, 1 = dark) shared by every wood, tiling seamlessly."""
    y, x = np.mgrid[0:H, 0:W].astype(float)
    v = y + 9 * noise(80, 400, 1) + 4 * np.sin(2 * np.pi * x / W) + 3 * np.sin(2 * np.pi * (2 * x / W + y / H))
    lines = (0.5 + 0.5 * np.sin(2 * np.pi * v / H * 34 + 2.5 * noise(30, 200, 2))) ** 3
    t = 0.45 * lines + 0.35 * (noise(4, 160, 3) * 0.6 + noise(2, 60, 4) * 0.4) + 0.20 * noise(1, 12, 5)
    # cross-fade with half-shifted copies so opposite edges meet without a seam
    wx = 1 - np.abs(np.linspace(-1, 1, W))
    t = t * wx + np.roll(t, W // 2, axis=1) * (1 - wx)
    wy = (1 - np.abs(np.linspace(-1, 1, H)))[:, None]
    t = t * wy + np.roll(t, H // 2, axis=0) * (1 - wy)
    lo, hi = np.percentile(t, 2), np.percentile(t, 98)  # blending flattens contrast; stretch it back
    return np.clip((t - lo) / (hi - lo), 0, 1)


def colour(t, light, mid, dark, strength):
    t = np.clip(0.5 + (t - 0.5) * strength, 0, 1)[..., None]
    light, mid, dark = (np.array(c, float) for c in (light, mid, dark))
    img = np.where(t < 0.5, light + (mid - light) * (t * 2), mid + (dark - mid) * (t * 2 - 1))
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5))


if __name__ == "__main__":
    t = grain()
    for name, (light, mid, dark, strength) in WOODS.items():
        path = OUT / f"wood-{name}.webp"
        colour(t, light, mid, dark, strength).save(path, quality=84, method=6)
        print(path.name, path.stat().st_size, "bytes")
