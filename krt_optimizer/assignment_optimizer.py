"""Компактная лексикографическая MILP-оптимизация без явного перечисления
миллионов комбинаций.

Наивная формулировка "одна булева переменная на каждую допустимую
комбинацию" даёт свыше 380 000 переменных (комбинации 1 опорная + до 4 из
~63 неопорных площадок) и практически не решается CP-SAT за разумное время.

Ключевое наблюдение, которое устраняет необходимость в переборе: условие
интегрального IP линеаризуется без потери точности —

    IP_comb > 1
    <=> Σ(IP_i · Area_i) / Σ Area_i > 1        (Σ Area_i > 0)
    <=> Σ((IP_i − 1) · Area_i) > 0

Поэтому вместо переменной на комбинацию используются переменные "площадка
назначена опорной площадке" (y[s, a]) и "опорная площадка активна"
(reg_anchor[a]). Условие IP > 1 становится обычным линейным ограничением на
эти переменные. Модель эквивалентна перебору комбинаций (те же допустимые
множества, тот же оптимум на каждом лексикографическом шаге), но имеет
порядка 10^3, а не 10^5-10^6 переменных.

IP хранится с точностью до 2 знаков, площадь — до 1 знака после запятой,
поэтому целочисленное произведение (IP·100 − 100) × (Area·10) даёт ТОЧНОЕ
(без округления) целое значение, пропорциональное (IP − 1) × Area × 1000 —
это позволяет использовать CP-SAT (требует целочисленных коэффициентов) без
потери точности сравнения с реальным условием IP > 1.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from ortools.sat.python import cp_model

from .models import (
    IP_EPS,
    MAX_COMBO_AREA_GA,
    MAX_COMBO_SIZE,
    Candidate,
    CandidateType,
    Site,
)


@dataclass
class StageOutcome:
    name: str
    direction: str
    value: int
    proven_optimal: bool


@dataclass
class OptimizationResult:
    selected: List[Candidate]
    stages: List[StageOutcome] = field(default_factory=list)


def _fixed_point(value: float, decimals: int) -> int:
    """Точное целочисленное представление десятичного значения без ошибок
    накопления с плавающей точкой (значения в исходных данных имеют строго
    ограниченное число знаков после запятой)."""
    return round(value * (10 ** decimals))


class SiteAssignmentOptimizer:
    """Лексикографическая оптимизация на переменных 'площадка -> опорная'."""

    def __init__(
        self,
        sites: List[Site],
        time_limit_seconds: float = 60.0,
        num_search_workers: int = 1,
        random_seed: int = 42,
    ):
        # num_search_workers=1 умышленно: модель решается за секунды даже в один
        # поток, а при нескольких потоках CP-SAT недетерминирован при равных
        # оптимумах (portfolio-поиск гонится за первым найденным доказанным
        # решением) — на этой задаче существует несколько равнозначных по всем
        # шести целям решений с разной внутренней группировкой площадок, и без
        # фиксации в один поток результат "плавает" между перезапусками.
        self.sites = sites
        self.time_limit_seconds = time_limit_seconds
        self.num_search_workers = num_search_workers
        self.random_seed = random_seed

        self.anchors = [s for s in sites if s.is_opornaya and not s.is_large]
        self.additional_pool = [s for s in sites if not s.is_opornaya and not s.is_large]
        self.large_sites = [s for s in sites if s.is_large and s.ip > 1.0 + IP_EPS]
        self._additional_by_id: Dict[str, Site] = {s.site_id: s for s in self.additional_pool}

        self.model = cp_model.CpModel()
        self.stages: List[StageOutcome] = []

        # reg_anchor[a.site_id] = 1, если опорная площадка a формирует активную обычную комбинацию
        self.reg_anchor: Dict[str, cp_model.IntVar] = {
            a.site_id: self.model.NewBoolVar(f"anchor_{a.site_id}") for a in self.anchors
        }
        # y[(s.site_id, a.site_id)] = 1, если площадка s назначена дополнительной к опорной a
        self.y: Dict[Tuple[str, str], cp_model.IntVar] = {}
        for a in self.anchors:
            budget = MAX_COMBO_AREA_GA - a.area_ga
            for s in self.additional_pool:
                if s.area_ga <= budget + 1e-9:
                    self.y[(s.site_id, a.site_id)] = self.model.NewBoolVar(f"y_{s.site_id}_{a.site_id}")

        # large[i.site_id] = 1, если крупная площадка включена самостоятельно
        self.large = {s.site_id: self.model.NewBoolVar(f"large_{s.site_id}") for s in self.large_sites}

        self._add_structural_constraints()

    # ------------------------------------------------------------------
    def _add_structural_constraints(self) -> None:
        # 1. каждая неопорная площадка назначена не более чем одной опорной
        by_site: Dict[str, List[cp_model.IntVar]] = {s.site_id: [] for s in self.additional_pool}
        for (sid, aid), var in self.y.items():
            by_site[sid].append(var)
        for sid, vars_ in by_site.items():
            if vars_:
                self.model.Add(sum(vars_) <= 1)

        for a in self.anchors:
            a_vars = [var for (sid, aid), var in self.y.items() if aid == a.site_id]
            # 2. назначать площадку опорной можно только если она активна
            for var in a_vars:
                self.model.Add(var <= self.reg_anchor[a.site_id])
            # 3. не более 4 дополнительных площадок (итого до 5 в комбинации)
            if a_vars:
                self.model.Add(sum(a_vars) <= MAX_COMBO_SIZE - 1)
            # 4. площадь: сумма дополнительных <= 45 - площадь опорной
            budget_fp = _fixed_point(MAX_COMBO_AREA_GA - a.area_ga, 1)
            area_terms = [
                _fixed_point(self._additional_by_id[sid].area_ga, 1) * var
                for (sid, aid), var in self.y.items()
                if aid == a.site_id
            ]
            if area_terms:
                self.model.Add(sum(area_terms) <= budget_fp)
            # 5. интегральный IP > 1 <=> Σ(IP_i-1)*Area_i > 0, точная целочисленная форма
            w_anchor = (_fixed_point(a.ip, 2) - 100) * _fixed_point(a.area_ga, 1)
            w_terms = [
                (_fixed_point(self._additional_by_id[sid].ip, 2) - 100)
                * _fixed_point(self._additional_by_id[sid].area_ga, 1)
                * var
                for (sid, aid), var in self.y.items()
                if aid == a.site_id
            ]
            self.model.Add(w_anchor * self.reg_anchor[a.site_id] + sum(w_terms) >= self.reg_anchor[a.site_id])

    # ------------------------------------------------------------------
    def _solve(self) -> cp_model.CpSolver:
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.time_limit_seconds
        solver.parameters.num_search_workers = self.num_search_workers
        solver.parameters.random_seed = self.random_seed
        status = solver.Solve(self.model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            raise RuntimeError(f"Решатель не нашёл допустимого решения: {solver.StatusName(status)}")
        solver.last_status = status  # type: ignore[attr-defined]
        return solver

    def _run_stage(self, name: str, expr, maximize: bool) -> cp_model.CpSolver:
        if maximize:
            self.model.Maximize(expr)
        else:
            self.model.Minimize(expr)
        solver = self._solve()
        value = int(round(solver.ObjectiveValue()))
        proven_optimal = solver.last_status == cp_model.OPTIMAL  # type: ignore[attr-defined]
        self.stages.append(StageOutcome(name, "max" if maximize else "min", value, proven_optimal))
        self.model.Add(expr == value)
        return solver

    def _size_expr(self, a: Site):
        terms = [var for (sid, aid), var in self.y.items() if aid == a.site_id]
        return self.reg_anchor[a.site_id] + (sum(terms) if terms else 0)

    def solve(self) -> OptimizationResult:
        coverage_expr = (
            sum(self._size_expr(a) for a in self.anchors)
            + sum(self.large[s.site_id] for s in self.large_sites)
        )
        self._run_stage("Охват уникальных площадок (max)", coverage_expr, True)

        max_size_var = self.model.NewIntVar(0, MAX_COMBO_SIZE, "max_regular_size")
        for a in self.anchors:
            self.model.Add(self._size_expr(a) <= max_size_var)
        self._run_stage("Компактность обычных комбинаций (min макс. размера)", max_size_var, False)

        def delta_expr(attr: str):
            # значения по построению целые (кв.м), но хранятся как float -> явное приведение
            # для CP-SAT, который требует целочисленных коэффициентов
            return sum(
                int(round(getattr(self._additional_by_id[sid], attr))) * var
                for (sid, aid), var in self.y.items()
            )

        avar_expr = delta_expr("avar_fond")
        self._run_stage("Δ аварийного жилого фонда (max)", avar_expr, True)

        novoy_expr = delta_expr("sp_novoy_zhiloy")
        self._run_stage("Δ новой жилой застройки (max)", novoy_expr, True)

        prochey_expr = delta_expr("sp_prochey_snos")
        final_solver = self._run_stage("Δ прочей сносимой застройки (min)", prochey_expr, False)

        return self._extract_result(final_solver)

    # ------------------------------------------------------------------
    def _extract_result(self, solver: cp_model.CpSolver) -> OptimizationResult:
        selected: List[Candidate] = []
        by_id = {s.site_id: s for s in self.sites}

        for a in self.anchors:
            if solver.Value(self.reg_anchor[a.site_id]) != 1:
                continue
            additional_ids = [
                sid for (sid, aid), var in self.y.items() if aid == a.site_id and solver.Value(var) == 1
            ]
            additional = tuple(by_id[sid] for sid in additional_ids)
            candidate = Candidate(
                ctype=CandidateType.REGULAR,
                anchor=a,
                additional=additional,
                members=(a, *additional),
            )
            assert candidate.integral_ip > 1.0 + IP_EPS, (
                f"Внутренняя несогласованность: комбинация {candidate.composition_label} "
                f"прошла линеаризованное ограничение MILP, но IP={candidate.integral_ip} <= 1"
            )
            assert candidate.area_ga <= MAX_COMBO_AREA_GA + 1e-6
            selected.append(candidate)

        for s in self.large_sites:
            if solver.Value(self.large[s.site_id]) == 1:
                selected.append(
                    Candidate(ctype=CandidateType.LARGE, anchor=None, additional=tuple(), members=(s,))
                )

        return OptimizationResult(selected=selected, stages=self.stages)
