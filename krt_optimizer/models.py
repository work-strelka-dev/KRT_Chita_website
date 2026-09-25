"""Доменные модели: площадка КРТ и кандидат-комбинация."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import FrozenSet, Tuple

AREA_EPS = 1e-6
IP_EPS = 1e-9
MAX_COMBO_AREA_GA = 45.0
MAX_COMBO_SIZE = 5


class Category(str, Enum):
    OPORNAYA = "опорная"
    VOZNAGRAZHDENIE = "вознаграждение"
    NEYTRALNAYA = "нейтральная площадка"
    OBREMENENIE = "обременение"


@dataclass(frozen=True)
class Site:
    """Одна строка исходного Excel-файла."""

    site_id: str
    avar_fond: float
    sp_prochey_snos: float
    area_ga: float
    sp_novoy_zhiloy: float
    ip: float
    category: Category

    @property
    def is_opornaya(self) -> bool:
        return self.category == Category.OPORNAYA

    @property
    def is_large(self) -> bool:
        return self.area_ga > MAX_COMBO_AREA_GA + AREA_EPS

    def __repr__(self) -> str:  # pragma: no cover - удобство отладки
        return f"Site({self.site_id}, area={self.area_ga}, ip={self.ip}, cat={self.category.value})"


class CandidateType(str, Enum):
    REGULAR = "Комбинация"
    LARGE = "Самостоятельная >45 га"


@dataclass(frozen=True)
class Candidate:
    """Допустимый (прошедший жёсткие фильтры) кандидат — обычная комбинация
    или крупная самостоятельная площадка."""

    ctype: CandidateType
    anchor: Site | None  # None только для крупной самостоятельной площадки
    additional: Tuple[Site, ...]  # для LARGE всегда пусто
    members: Tuple[Site, ...]  # anchor + additional (или одна площадка для LARGE)

    @property
    def site_ids(self) -> FrozenSet[str]:
        return frozenset(s.site_id for s in self.members)

    @property
    def size(self) -> int:
        return len(self.members)

    @property
    def area_ga(self) -> float:
        return sum(s.area_ga for s in self.members)

    @property
    def integral_ip(self) -> float:
        if self.ctype is CandidateType.LARGE:
            return self.members[0].ip
        total_area = self.area_ga
        return sum(s.ip * s.area_ga for s in self.members) / total_area

    @property
    def delta_avar_fond(self) -> float:
        if self.ctype is CandidateType.LARGE:
            return 0.0
        return sum(s.avar_fond for s in self.additional)

    @property
    def delta_novoy_zhiloy(self) -> float:
        if self.ctype is CandidateType.LARGE:
            return 0.0
        return sum(s.sp_novoy_zhiloy for s in self.additional)

    @property
    def delta_prochey_snos(self) -> float:
        if self.ctype is CandidateType.LARGE:
            return 0.0
        return sum(s.sp_prochey_snos for s in self.additional)

    @property
    def total_novoy_zhiloy(self) -> float:
        return sum(s.sp_novoy_zhiloy for s in self.members)

    @property
    def total_prochey_snos(self) -> float:
        return sum(s.sp_prochey_snos for s in self.members)

    @property
    def composition_label(self) -> str:
        return " + ".join(s.site_id for s in self.members)

    @property
    def additional_label(self) -> str:
        if not self.additional:
            return "—"
        return "; ".join(s.site_id for s in self.additional)

    @property
    def anchor_label(self) -> str:
        return self.anchor.site_id if self.anchor is not None else "—"
