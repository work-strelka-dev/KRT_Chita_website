"""Общие пути и сопоставление PDF-схем с ID площадок для скриптов сборки."""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SITES_XLSX = ROOT / "input_data" / "параметры площадок(1).xlsx"
RESULT_XLSX = ROOT / "output" / "KRT_оптимизация_результат.xlsx"
PARCELS_DIR = ROOT / "parcels"
WEB_DIR = ROOT / "web"
IMG_DIR = WEB_DIR / "img" / "parcels"
DATA_DIR = WEB_DIR / "data"
BUILD_DIR = ROOT / "build"
IMAGES_MANIFEST = BUILD_DIR / "images.json"
GOLDEN_CASES = ROOT / "tests" / "golden_cases.json"

# Имя PDF не совпадает с ID площадки в Excel (ARCHITECTURE.md, 2.1).
PDF_ID_ALIASES = {"22": "22.1"}
PDF_NAME = re.compile(r"^output_\d+_(?P<id>[\d.]+)\.pdf$")

log = logging.getLogger("krt-build")


class BuildError(Exception):
    """Несогласованность исходных данных: сборка останавливается."""


def parcel_pdfs(site_ids: set[str]) -> dict[str, Path]:
    """ID площадки → PDF-схема. PDF без строки в Excel пропускаются с предупреждением."""
    found: dict[str, Path] = {}
    for pdf in sorted(PARCELS_DIR.glob("*.pdf")):
        match = PDF_NAME.match(pdf.name)
        if not match:
            raise BuildError(f"Неожиданное имя файла схемы: {pdf.name}")
        site_id = PDF_ID_ALIASES.get(match["id"], match["id"])
        if site_id not in site_ids:
            log.warning("Схема %s: площадки %s нет в Excel, пропускаю", pdf.name, site_id)
            continue
        if site_id in found:
            raise BuildError(f"Две схемы для площадки {site_id}: {found[site_id].name}, {pdf.name}")
        found[site_id] = pdf
    missing = site_ids - found.keys()
    if missing:
        raise BuildError(f"Нет схем для площадок: {sorted(missing, key=id_sort_key)}")
    return found


def id_sort_key(site_id: str) -> tuple[int, ...]:
    """Естественный порядок ID: 2.1 < 10.1."""
    return tuple(int(part) for part in site_id.split("."))


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
