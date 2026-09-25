"""Эталонные значения из методики / контрольного файла KRT_оптимизация_итог.xlsx.

Используются ТОЛЬКО для сверки (раздел 6.7 промпта): если найденный
оптимизатором набор совпадает по всем целевым значениям, но отличается по
составу комбинаций — это фиксируется как альтернативный эквивалентный
оптимум, а не как ошибка. Контрольный набор не подставляется силой в решатель.
"""
from __future__ import annotations

REFERENCE_REGULAR_COMBOS = [
    ("22.1", ("9.2", "21.2", "18.4")),
    ("12.2", ("28.1", "30.3")),
    ("16.2", ("24.1", "13.2", "20.3")),
    ("2.2", ("23.1", "14.1", "18.3")),
    ("11.2", ("12.1", "11.1", "35.2")),
    ("13.3", ("15.1", "24.2", "20.4")),
    ("29.1", ("25.1", "1.1", "19.1")),
    ("7.1", ("27.4",)),
    ("14.3", ("18.2", "14.2", "21.3")),
    ("9.1", ("32.3", "27.2")),
    ("1.2", ("16.3", "35.3")),
    ("17.3", ("33.1", "17.2", "8.2")),
    ("20.1", ("13.1", "17.1", "31.2")),
    ("31.3", ("32.2", "15.3", "34.1")),
    ("7.2", ("31.1", "25.2", "18.1")),
    ("2.1", ("23.2", "8.1", "34.3")),
]

REFERENCE_LARGE_STANDALONE = (
    "31.4", "33.2", "21.1", "15.2", "10.1", "16.1", "32.1", "19.2", "34.2",
)

REFERENCE_EXCLUDED = (
    "26.2", "29.2", "20.2", "35.1", "27.3", "30.1", "26.1", "27.1", "27.5", "27.6", "18.5", "30.2",
)

REFERENCE_TOTAL_SITES = 80
REFERENCE_COVERAGE = 68
REFERENCE_MAX_REGULAR_SIZE = 4
REFERENCE_REGULAR_COUNT = 16
REFERENCE_LARGE_COUNT = 9

# Суммы посчитаны независимо из листа "Итог" файла KRT_оптимизация_итог.xlsx
# (столбцы дельт по 16 обычным комбинациям; у крупных площадок дельты = 0).
REFERENCE_DELTA_AVAR_TOTAL = 106_136
REFERENCE_DELTA_NOVOY_TOTAL = 2_890_009
REFERENCE_DELTA_PROCHEY_TOTAL = 623_137


def reference_site_ids() -> frozenset[str]:
    ids = set(REFERENCE_LARGE_STANDALONE)
    for anchor, additional in REFERENCE_REGULAR_COMBOS:
        ids.add(anchor)
        ids.update(additional)
    return frozenset(ids)


def reference_regular_groupings() -> frozenset[tuple[str, frozenset[str]]]:
    """Точная структура эталона: какая опорная площадка держит какой набор
    дополнительных площадок (а не просто общий список из 68 ID)."""
    return frozenset((anchor, frozenset(additional)) for anchor, additional in REFERENCE_REGULAR_COMBOS)
