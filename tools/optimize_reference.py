"""Эталон оптимизации выбора для golden-тестов web/js/domain/optimize.js.

Намеренно другой алгоритм, чем в JS (полный перебор сочетаний вместо DFS),
чтобы тесты ловили ошибки обхода. Критерии и порядок сравнения — те же:
лексикографические цели методики (Промпт_воспроизведение_оптимизации_КРТ.md, п. 4)
для одной комбинации — охват (число площадок) ↑, затем Δ аварийного фонда ↑,
Δ новой жилой ↑, Δ прочей сносимой ↓; компактность при зафиксированном охвате
на одну комбинацию не влияет. Последний ключ — ID, только для однозначности.
"""
from __future__ import annotations

from itertools import combinations

from common import id_sort_key
from krt_optimizer.models import MAX_COMBO_SIZE, Site
from rules import MAX_AREA_TENTHS, area_tenths, ip_valid_int

MAX_ADDITIONAL = MAX_COMBO_SIZE - 1


def optimize(kept: list[Site], pool: list[Site]) -> tuple[str, list[str]]:
    """kept — опорная первой. Возвращает (статус, добавленные ID в естественном порядке)."""
    if area_tenths(kept[:1]) > MAX_AREA_TENTHS:
        return "standalone", []
    slots = MAX_ADDITIONAL - (len(kept) - 1)
    if slots <= 0:
        return "full", []

    def key(added: tuple[Site, ...]) -> tuple:
        extra = [*kept[1:], *added]
        ids = sorted((s.site_id for s in added), key=id_sort_key)
        return (
            -(len(kept) + len(added)),
            -sum(s.avar_fond for s in extra),
            -sum(s.sp_novoy_zhiloy for s in extra),
            sum(s.sp_prochey_snos for s in extra),
            [id_sort_key(i) for i in ids],
        ), ids

    budget = MAX_AREA_TENTHS - area_tenths(kept)
    pool = [s for s in pool if round(s.area_ga * 10) <= budget]
    best = None
    for n in range(slots + 1):
        for added in combinations(pool, n):
            if area_tenths(added) > budget or not ip_valid_int([*kept, *added]):
                continue
            candidate = key(added)
            if best is None or candidate[0] < best[0]:
                best = candidate
    return ("ok", best[1]) if best else ("infeasible", [])
