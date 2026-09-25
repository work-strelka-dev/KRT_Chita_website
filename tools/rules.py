"""Проверки методики в целых числах (ARCHITECTURE.md, 3.2): общие для сборки и эталонов."""
from __future__ import annotations

from collections.abc import Iterable

from krt_optimizer.models import MAX_COMBO_AREA_GA, Site

MAX_AREA_TENTHS = round(MAX_COMBO_AREA_GA * 10)


def ip_valid_int(members: Iterable[Site]) -> bool:
    """IP > 1 строго: Σ (ip·100 − 100)·(area·10) > 0, без ошибок округления на границе."""
    return sum((round(s.ip * 100) - 100) * round(s.area_ga * 10) for s in members) > 0


def area_tenths(members: Iterable[Site]) -> int:
    return sum(round(s.area_ga * 10) for s in members)


def area_fits(members: Iterable[Site]) -> bool:
    return area_tenths(members) <= MAX_AREA_TENTHS
