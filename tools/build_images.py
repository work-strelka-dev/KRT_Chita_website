"""PDF-схемы площадок → WebP с прозрачным фоном (ARCHITECTURE.md, раздел 9).

Каждая схема обрезается по содержимому и рендерится заново под целевой
размер: PDF векторные, поэтому мелкие площадки остаются чёткими.
Все PDF нарисованы в едином масштабе, поэтому масштаб в метрах
выводится из отношения площади из Excel к закрашенной площади схемы.

Запуск: .venv/Scripts/python tools/build_images.py
Результат: web/img/parcels/<id>.webp, <id>.thumb.webp, build/images.json
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium

from common import IMAGES_MANIFEST, IMG_DIR, SITES_XLSX, BuildError, log, parcel_pdfs, setup_logging
from krt_optimizer.data_repository import SiteRepository

PROBE_SCALE = 4  # px на pt при поиске границ содержимого
MARGIN_SHARE = 0.05
MIN_MARGIN_PT = 2.0
MAX_SCALE = 80  # предел увеличения для крошечных площадок
SIZES = {"image": 1200, "thumb": 320}  # длинная сторона, px
SUFFIXES = {"image": "", "thumb": ".thumb"}
EDGE_TOLERANCE_PT = 0.5
TRANSPARENT = (0, 0, 0, 0)


@dataclass(frozen=True)
class Probe:
    page_w: float
    page_h: float
    box: tuple[float, float, float, float]  # x0, y0, x1, y1 в pt, y сверху вниз
    painted_pt2: float


def probe(page: pdfium.PdfPage) -> Probe:
    page_w, page_h = page.get_size()
    alpha = np.asarray(page.render(scale=PROBE_SCALE, fill_color=TRANSPARENT).to_pil().convert("RGBA"))[:, :, 3]
    ys, xs = np.nonzero(alpha)
    if xs.size == 0:
        raise BuildError("пустая схема")
    box = (xs.min() / PROBE_SCALE, ys.min() / PROBE_SCALE,
           (xs.max() + 1) / PROBE_SCALE, (ys.max() + 1) / PROBE_SCALE)
    return Probe(page_w, page_h, box, xs.size / PROBE_SCALE**2)


def crop_box(p: Probe) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = p.box
    margin = max(MIN_MARGIN_PT, MARGIN_SHARE * max(x1 - x0, y1 - y0))
    return max(0.0, x0 - margin), max(0.0, y0 - margin), min(p.page_w, x1 + margin), min(p.page_h, y1 + margin)


def touches_edge(p: Probe) -> bool:
    x0, y0, x1, y1 = p.box
    tol = EDGE_TOLERANCE_PT
    return x0 < tol or y0 < tol or x1 > p.page_w - tol or y1 > p.page_h - tol


def render_webp(page: pdfium.PdfPage, p: Probe, box: tuple[float, float, float, float],
                long_side: int, out: Path) -> dict[str, int]:
    x0, y0, x1, y1 = box
    scale = min(MAX_SCALE, long_side / max(x1 - x0, y1 - y0))
    # crop в pypdfium2: сколько pt отрезать слева, снизу, справа, сверху
    crop = (x0, p.page_h - y1, p.page_w - x1, y0)
    image = page.render(scale=scale, crop=crop, fill_color=TRANSPARENT).to_pil().convert("RGBA")
    image.save(out, "WEBP", lossless=True, method=6)
    return {"w": image.width, "h": image.height}


def meters_per_pt(probes: dict[str, Probe], area_ha: dict[str, float]) -> float:
    """Единый масштаб всех схем: √(Σ площадь, м² / Σ закрашено, pt²)."""
    total_m2 = sum(area_ha[i] * 10_000 for i in probes)
    total_pt2 = sum(p.painted_pt2 for p in probes.values())
    return math.sqrt(total_m2 / total_pt2)


def main() -> None:
    setup_logging()
    area_ha = {s.site_id: s.area_ga for s in SiteRepository(SITES_XLSX).load()}
    pdfs = parcel_pdfs(set(area_ha))
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    docs = {site_id: pdfium.PdfDocument(path) for site_id, path in pdfs.items()}
    probes = {site_id: probe(doc[0]) for site_id, doc in docs.items()}
    m_per_pt = meters_per_pt(probes, area_ha)
    log.info("Масштаб схем: %.2f м в 1 pt", m_per_pt)

    manifest: dict[str, dict] = {}
    for site_id, doc in docs.items():
        p = probes[site_id]
        if touches_edge(p):
            log.warning("Схема %s касается края листа: часть площадки может быть обрезана", site_id)
        box = crop_box(p)
        entry = {name: render_webp(doc[0], p, box, size, IMG_DIR / f"{site_id}{SUFFIXES[name]}.webp")
                 for name, size in SIZES.items()}
        entry["widthM"] = round((box[2] - box[0]) * m_per_pt, 1)
        manifest[site_id] = entry
        doc.close()

    stale = set(IMG_DIR.glob("*.webp")) - {IMG_DIR / f"{i}{s}.webp" for i in manifest for s in SUFFIXES.values()}
    for f in stale:
        log.warning("Удаляю устаревшую картинку %s", f.name)
        f.unlink()

    IMAGES_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    IMAGES_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    log.info("Готово: %d площадок, манифест %s", len(manifest), IMAGES_MANIFEST.name)


if __name__ == "__main__":
    main()
