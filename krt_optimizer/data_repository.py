"""Загрузка и валидация исходных данных по площадкам КРТ."""
from __future__ import annotations

from pathlib import Path
from typing import List

import pandas as pd

from .models import Category, Site

REQUIRED_COLUMNS = {
    "id": "Номер площадки КРТ",
    "avar_fond": "Аварийный жилой фонд, кв.м",
    "sp_prochey": "СПП прочей сносимой застройки, кв.м",
    "area": "Размер территории, га",
    "sp_novoy": "СПП новой жилой застройки, кв.м",
    "ip": "Индекс инвестиционного потенциала",
    "category": "Категория",
}


class DataValidationError(Exception):
    """Ошибка целостности исходных данных."""


class SiteRepository:
    """Читает Excel-файл с параметрами площадок и превращает строки в Site."""

    def __init__(self, path: str | Path, sheet_name: str | int = 0):
        self.path = Path(path)
        self.sheet_name = sheet_name

    @staticmethod
    def _format_id(raw_id: float) -> str:
        # Все ID в исходном файле имеют вид X.Y (ровно один знак после запятой).
        return f"{float(raw_id):.1f}"

    def load(self) -> List[Site]:
        df = pd.read_excel(self.path, sheet_name=self.sheet_name)

        missing = [col for col in REQUIRED_COLUMNS.values() if col not in df.columns]
        if missing:
            raise DataValidationError(
                f"В файле {self.path} отсутствуют обязательные столбцы: {missing}"
            )

        if df[REQUIRED_COLUMNS["id"]].isna().any():
            raise DataValidationError("Обнаружены пустые значения в столбце с ID площадки")

        raw_ids = df[REQUIRED_COLUMNS["id"]].tolist()
        formatted_ids = [self._format_id(v) for v in raw_ids]
        duplicates = {i for i in formatted_ids if formatted_ids.count(i) > 1}
        if duplicates:
            raise DataValidationError(f"Обнаружены повторяющиеся ID площадок: {sorted(duplicates)}")

        known_categories = {c.value for c in Category}
        bad_categories = set(df[REQUIRED_COLUMNS["category"]].unique()) - known_categories
        if bad_categories:
            raise DataValidationError(
                f"Обнаружены неизвестные категории: {bad_categories}. "
                f"Ожидались: {known_categories}"
            )

        sites: List[Site] = []
        for row_dict, site_id in zip(df.to_dict("records"), formatted_ids):
            sites.append(
                Site(
                    site_id=site_id,
                    avar_fond=float(row_dict[REQUIRED_COLUMNS["avar_fond"]]),
                    sp_prochey_snos=float(row_dict[REQUIRED_COLUMNS["sp_prochey"]]),
                    area_ga=float(row_dict[REQUIRED_COLUMNS["area"]]),
                    sp_novoy_zhiloy=float(row_dict[REQUIRED_COLUMNS["sp_novoy"]]),
                    ip=float(row_dict[REQUIRED_COLUMNS["ip"]]),
                    category=Category(row_dict[REQUIRED_COLUMNS["category"]]),
                )
            )

        if len(sites) != len(set(s.site_id for s in sites)):
            raise DataValidationError("Внутренняя ошибка: дубли ID после парсинга")

        return sites
