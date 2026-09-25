"""Фирменные изображения из style/ → web/img/brand/ (ARCHITECTURE.md, раздел 8).

- логотип KB_logo_blue.png → kb-strelka.webp (720 px);
- знак логотипа → favicon.webp (64 px);
- иллюстрация Main.png → main-1280.webp, main-2560.webp: белый фон,
  связанный с краями картинки, делается прозрачным (белые детали внутри
  рисунка не трогаются), чтобы под ней были видны волны Group;
- Group.svg копируется как есть (проверка на активное содержимое — в pytest);
- frost.webp — плитка зерна для матового стекла плашек.

Запуск: .venv/Scripts/python tools/build_brand.py
"""
from __future__ import annotations

import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from common import ROOT, WEB_DIR, log, setup_logging

STYLE = ROOT / "style"
OUT = WEB_DIR / "img" / "brand"
KEY = (255, 0, 255)
WHITE_MIN = 235         # минимальный канал, с которого пиксель считается белым фоном
FILL_THRESH = 28        # допуск заливки от края
BG_SEEDS = [(40, 40), (1280, 30), (2500, 40), (40, 700)]  # точки фона для ширины 2560
ART_WIDTHS = (1280, 2560)


def resized(im: Image.Image, width: int) -> Image.Image:
    return im.resize((width, round(width * im.height / im.width)), Image.LANCZOS)


def cut_background(im: Image.Image) -> Image.Image:
    """Заливкой от краёв помечает белый фон и делает его прозрачным с мягкой кромкой."""
    rgb = im.convert("RGB")
    for seed in BG_SEEDS:
        if min(rgb.getpixel(seed)) > WHITE_MIN:
            ImageDraw.floodfill(rgb, seed, KEY, thresh=FILL_THRESH)
    background = np.all(np.asarray(rgb) == KEY, axis=2)
    pixels = np.asarray(im).copy()
    alpha = pixels[:, :, 3].copy()
    alpha[background] = 0
    soft = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.2)))
    pixels[:, :, 3] = np.where(background, 0, np.minimum(soft, pixels[:, :, 3]))
    return Image.fromarray(pixels)


def favicon(logo: Image.Image) -> Image.Image:
    """Знак — правая часть логотипа, вписанная в квадрат."""
    right = logo.crop((int(logo.width * 0.84), 0, logo.width, logo.height))
    mark = right.crop(right.getbbox())
    side = max(mark.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    return square.resize((64, 64), Image.LANCZOS)


def frost_noise(size: int = 160, seed: int = 20260925) -> Image.Image:
    """Плитка зерна для матового стекла: светлые и тёмные крапинки с малой
    непрозрачностью. Значения независимы, поэтому плитка стыкуется без шва."""
    rng = np.random.default_rng(seed)
    light = rng.random((size, size)) > 0.5
    alpha = np.clip(np.abs(rng.normal(0, 1, (size, size))) * 9, 0, 32).astype(np.uint8)
    rgb = np.where(light[..., None], 255, 0).astype(np.uint8).repeat(3, axis=2)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def main() -> None:
    setup_logging()
    OUT.mkdir(parents=True, exist_ok=True)
    logo = Image.open(STYLE / "KB_logo_blue.png").convert("RGBA")
    resized(logo, 720).save(OUT / "kb-strelka.webp", "WEBP", lossless=True)
    favicon(logo).save(OUT / "favicon.webp", "WEBP", lossless=True)

    art = cut_background(resized(Image.open(STYLE / "Main.png").convert("RGBA"), max(ART_WIDTHS)))
    for width in ART_WIDTHS:
        resized(art, width).save(OUT / f"main-{width}.webp", "WEBP", quality=82, alpha_quality=90, method=6)

    frost_noise().save(OUT / "frost.webp", "WEBP", lossless=True)
    shutil.copyfile(STYLE / "Group.svg", OUT / "group.svg")
    log.info("Готово: %s", ", ".join(sorted(p.name for p in OUT.iterdir())))


if __name__ == "__main__":
    main()
