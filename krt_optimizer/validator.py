"""Контрольные проверки результата (раздел 6 промпта) и сверка с эталоном."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .assignment_optimizer import OptimizationResult
from .models import AREA_EPS, IP_EPS, MAX_COMBO_AREA_GA, Candidate, CandidateType, Site
from .reference import (
    REFERENCE_COVERAGE,
    REFERENCE_DELTA_AVAR_TOTAL,
    REFERENCE_DELTA_NOVOY_TOTAL,
    REFERENCE_DELTA_PROCHEY_TOTAL,
    REFERENCE_LARGE_COUNT,
    REFERENCE_MAX_REGULAR_SIZE,
    REFERENCE_REGULAR_COUNT,
    reference_regular_groupings,
    reference_site_ids,
)


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str


@dataclass
class ExcludedSite:
    site: Site
    reason: str


@dataclass
class ValidationReport:
    checks: List[CheckResult]
    excluded: List[ExcludedSite]
    comparison_note: str
    all_hard_checks_passed: bool
    coverage: int
    max_regular_size: int
    delta_avar_total: float
    delta_novoy_total: float
    delta_prochey_total: float


class Validator:
    def __init__(self, sites: List[Site], all_candidates: List[Candidate], result: OptimizationResult):
        self.sites = sites
        self.all_candidates = all_candidates
        self.result = result

    def validate(self) -> ValidationReport:
        selected = self.result.selected
        checks: List[CheckResult] = []

        bad_area = [c for c in selected if c.ctype is CandidateType.REGULAR and c.area_ga > MAX_COMBO_AREA_GA + AREA_EPS]
        checks.append(
            CheckResult(
                "Площадь каждой обычной комбинации ≤45 га",
                not bad_area,
                "OK" if not bad_area else f"Нарушение у: {[c.composition_label for c in bad_area]}",
            )
        )

        bad_ip = [c for c in selected if c.integral_ip <= 1.0 + IP_EPS]
        checks.append(
            CheckResult(
                "Интегральный IP каждого элемента строго >1 (пересчитано из исходного Excel)",
                not bad_ip,
                "OK" if not bad_ip else f"Нарушение у: {[c.composition_label for c in bad_ip]}",
            )
        )

        bad_large = [
            c
            for c in selected
            if c.ctype is CandidateType.LARGE
            and not (c.members[0].area_ga > MAX_COMBO_AREA_GA + AREA_EPS and c.members[0].ip > 1.0 + IP_EPS)
        ]
        checks.append(
            CheckResult(
                "Крупные самостоятельные площадки: площадь >45 га и собственный IP >1",
                not bad_large,
                "OK" if not bad_large else f"Нарушение у: {[c.composition_label for c in bad_large]}",
            )
        )

        all_ids = [sid for c in selected for sid in c.site_ids]
        has_duplicates = len(all_ids) != len(set(all_ids))
        checks.append(
            CheckResult(
                "Отсутствие повторов ID между итоговыми комбинациями",
                not has_duplicates,
                "OK" if not has_duplicates else "Обнаружены повторяющиеся ID",
            )
        )

        unique_ids = set(all_ids)
        coverage = len(unique_ids)
        checks.append(
            CheckResult(
                f"Максимальный охват уникальных площадок = {coverage} (эталон: {REFERENCE_COVERAGE})",
                coverage == REFERENCE_COVERAGE,
                "Совпадает с эталоном" if coverage == REFERENCE_COVERAGE else "Отличается от эталона — см. пояснение ниже",
            )
        )

        regular_selected = [c for c in selected if c.ctype is CandidateType.REGULAR]
        large_selected = [c for c in selected if c.ctype is CandidateType.LARGE]
        max_regular_size = max((c.size for c in regular_selected), default=0)
        checks.append(
            CheckResult(
                f"Макс. размер обычной комбинации = {max_regular_size} (эталон: {REFERENCE_MAX_REGULAR_SIZE})",
                max_regular_size == REFERENCE_MAX_REGULAR_SIZE,
                "OK" if max_regular_size == REFERENCE_MAX_REGULAR_SIZE else "Отличается от эталона",
            )
        )

        checks.append(
            CheckResult(
                f"Количество обычных комбинаций / крупных площадок = {len(regular_selected)} / {len(large_selected)} "
                f"(эталон: {REFERENCE_REGULAR_COUNT} / {REFERENCE_LARGE_COUNT})",
                True,
                "Информационно — не является жёстким ограничением модели",
            )
        )

        feasible_ids = set()
        for c in self.all_candidates:
            feasible_ids.update(c.site_ids)

        excluded: List[ExcludedSite] = []
        for s in self.sites:
            if s.site_id in unique_ids:
                continue
            if s.is_large and not (s.ip > 1.0 + IP_EPS):
                reason = "Площадь >45 га и IP ≤1: не допускается как самостоятельная площадка (структурно недопустима)"
            elif s.site_id not in feasible_ids:
                reason = "Нет ни одной допустимой комбинации (площадь ≤45 га и IP >1) с её участием"
            else:
                reason = f"Имеет допустимые комбинации, но не включена в глобально оптимальный набор при охвате {coverage}/{len(self.sites)}"
            excluded.append(ExcludedSite(s, reason))

        delta_avar_total = sum(c.delta_avar_fond for c in selected)
        delta_novoy_total = sum(c.delta_novoy_zhiloy for c in selected)
        delta_prochey_total = sum(c.delta_prochey_snos for c in selected)

        comparison_note = self._compare_with_reference(
            selected, coverage, max_regular_size, delta_avar_total, delta_novoy_total, delta_prochey_total
        )

        all_hard_checks_passed = not bad_area and not bad_ip and not bad_large and not has_duplicates

        return ValidationReport(
            checks=checks,
            excluded=excluded,
            comparison_note=comparison_note,
            all_hard_checks_passed=all_hard_checks_passed,
            coverage=coverage,
            max_regular_size=max_regular_size,
            delta_avar_total=delta_avar_total,
            delta_novoy_total=delta_novoy_total,
            delta_prochey_total=delta_prochey_total,
        )

    @staticmethod
    def _compare_with_reference(
        selected: List[Candidate],
        coverage: int,
        max_regular_size: int,
        delta_avar_total: float,
        delta_novoy_total: float,
        delta_prochey_total: float,
    ) -> str:
        achieved_ids = frozenset(sid for c in selected for sid in c.site_ids)
        ref_ids = reference_site_ids()

        achieved_groupings = frozenset(
            (c.anchor.site_id, frozenset(s.site_id for s in c.additional))
            for c in selected
            if c.ctype is CandidateType.REGULAR
        )
        ref_groupings = reference_regular_groupings()

        same_objectives = (
            coverage == REFERENCE_COVERAGE
            and max_regular_size == REFERENCE_MAX_REGULAR_SIZE
            and abs(delta_avar_total - REFERENCE_DELTA_AVAR_TOTAL) < 1e-6
            and abs(delta_novoy_total - REFERENCE_DELTA_NOVOY_TOTAL) < 1e-6
            and abs(delta_prochey_total - REFERENCE_DELTA_PROCHEY_TOTAL) < 1e-6
        )

        if achieved_ids == ref_ids and achieved_groupings == ref_groupings:
            return (
                "Состав итогового набора ПОЛНОСТЬЮ совпадает с эталоном: те же 68 площадок и та же "
                "разбивка по опорным площадкам (каждая обычная комбинация содержит тот же набор "
                "дополнительных площадок, что и в методике)."
            )

        if same_objectives:
            only_ref_ids = sorted(ref_ids - achieved_ids)
            only_new_ids = sorted(achieved_ids - ref_ids)

            ref_by_anchor = dict(ref_groupings)
            achieved_by_anchor = dict(achieved_groupings)
            changed_anchors = sorted(
                a
                for a in set(ref_by_anchor) | set(achieved_by_anchor)
                if ref_by_anchor.get(a) != achieved_by_anchor.get(a)
            )
            grouping_diff_lines = []
            for a in changed_anchors:
                ref_add = sorted(ref_by_anchor.get(a, frozenset()))
                new_add = sorted(achieved_by_anchor.get(a, frozenset()))
                grouping_diff_lines.append(f"    опорная {a}: эталон [{', '.join(ref_add)}] -> новое решение [{', '.join(new_add)}]")

            note = (
                "Найден АЛЬТЕРНАТИВНЫЙ ЭКВИВАЛЕНТНЫЙ ОПТИМУМ: все шесть целевых значений "
                "лексикографической оптимизации совпадают с эталоном (охват, компактность, "
                "суммы трёх предельных эффектов), но конкретная группировка площадок по комбинациям отличается.\n"
                "Это возможно потому, что лексикографические цели фиксируют только суммарные показатели "
                "по всем комбинациям, а не то, какая именно дополнительная площадка досталась какой опорной — "
                "при равных суммах решатель вправе вернуть любую из существующих равнозначных группировок.\n"
            )
            if only_ref_ids or only_new_ids:
                note += f"  Набор из 68 площадок отличается: только в эталоне {only_ref_ids}, только в новом решении {only_new_ids}\n"
            else:
                note += "  Набор из 68 площадок при этом идентичен эталону — отличается только распределение по опорным.\n"
            if grouping_diff_lines:
                note += "  Изменившиеся комбинации:\n" + "\n".join(grouping_diff_lines) + "\n"
            note += "Это математически допустимая ситуация (см. раздел 6.7 промпта) — не считается ошибкой."
            return note

        return (
            "Результат ОТЛИЧАЕТСЯ от эталона по значениям целевых функций "
            f"(охват={coverage} vs {REFERENCE_COVERAGE}, макс.размер={max_regular_size} vs {REFERENCE_MAX_REGULAR_SIZE}, "
            f"Δаварийный={delta_avar_total} vs {REFERENCE_DELTA_AVAR_TOTAL}, "
            f"Δновая={delta_novoy_total} vs {REFERENCE_DELTA_NOVOY_TOTAL}, "
            f"Δпрочая={delta_prochey_total} vs {REFERENCE_DELTA_PROCHEY_TOTAL}). "
            "Требуется разбор расхождения перед выдачей результата."
        )
