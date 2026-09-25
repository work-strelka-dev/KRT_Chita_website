"""Генерация допустимых кандидатов: обычных комбинаций и крупных
самостоятельных площадок.

Обычные комбинации не перебираются "в лоб" через itertools.combinations по
всем неопорным площадкам (это дало бы огромное количество заведомо
непроходных по площади вариантов). Вместо этого используется DFS с
отсечением по накопленной площади: неопорный пул сортируется по возрастанию
площади, и как только очередная площадка не влезает в остаток бюджета
45 га, обход обрывается (break, а не continue), поскольку все более поздние
площадки в отсортированном пуле не меньше по площади.
"""
from __future__ import annotations

from typing import List

from .models import (
    AREA_EPS,
    IP_EPS,
    MAX_COMBO_AREA_GA,
    MAX_COMBO_SIZE,
    Candidate,
    CandidateType,
    Site,
)


class CandidateGenerator:
    def __init__(
        self,
        sites: List[Site],
        max_combo_area_ga: float = MAX_COMBO_AREA_GA,
        max_combo_size: int = MAX_COMBO_SIZE,
    ):
        self.sites = sites
        self.max_combo_area_ga = max_combo_area_ga
        self.max_combo_size = max_combo_size
        self.max_additional = max_combo_size - 1

    def generate(self) -> List[Candidate]:
        candidates: List[Candidate] = []
        candidates.extend(self._generate_regular())
        candidates.extend(self._generate_large())
        return candidates

    # ------------------------------------------------------------------
    # Обычные комбинации
    # ------------------------------------------------------------------
    def _generate_regular(self) -> List[Candidate]:
        anchors = [s for s in self.sites if s.is_opornaya]
        # площадка, потенциально входящая как "дополнительная", сама по себе
        # не может быть >45 га (иначе комбинация автоматически превысит лимит)
        pool = sorted(
            (s for s in self.sites if not s.is_opornaya and not s.is_large),
            key=lambda s: s.area_ga,
        )

        results: List[Candidate] = []
        for anchor in anchors:
            if anchor.is_large:
                # опорная площадка >45 га не формирует обычных комбинаций,
                # она будет рассмотрена как крупная самостоятельная
                continue
            budget = self.max_combo_area_ga - anchor.area_ga
            results.extend(self._dfs_for_anchor(anchor, pool, budget))
        return results

    def _dfs_for_anchor(self, anchor: Site, pool: List[Site], budget: float) -> List[Candidate]:
        found: List[Candidate] = []
        stack: List[Site] = []
        n = len(pool)

        def emit() -> None:
            members = (anchor, *stack)
            candidate = Candidate(
                ctype=CandidateType.REGULAR,
                anchor=anchor,
                additional=tuple(stack),
                members=members,
            )
            if candidate.integral_ip > 1.0 + IP_EPS:
                found.append(candidate)

        def dfs(start: int, current_area: float) -> None:
            emit()
            if len(stack) == self.max_additional:
                return
            for idx in range(start, n):
                site = pool[idx]
                new_area = current_area + site.area_ga
                if new_area > budget + AREA_EPS:
                    break  # пул отсортирован по площади -> дальше тоже не влезет
                stack.append(site)
                dfs(idx + 1, new_area)
                stack.pop()

        if budget >= -AREA_EPS:
            dfs(0, 0.0)
        return found

    # ------------------------------------------------------------------
    # Крупные самостоятельные площадки
    # ------------------------------------------------------------------
    def _generate_large(self) -> List[Candidate]:
        results = []
        for site in self.sites:
            if site.is_large and site.ip > 1.0 + IP_EPS:
                results.append(
                    Candidate(
                        ctype=CandidateType.LARGE,
                        anchor=None,
                        additional=tuple(),
                        members=(site,),
                    )
                )
        return results
