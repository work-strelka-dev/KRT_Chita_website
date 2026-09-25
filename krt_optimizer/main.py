"""CLI-точка входа: воспроизведение оптимизации комбинаций площадок КРТ."""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from .assignment_optimizer import SiteAssignmentOptimizer
from .candidate_generator import CandidateGenerator
from .data_repository import DataValidationError, SiteRepository
from .models import CandidateType
from .report import ExcelReportBuilder
from .validator import Validator


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Оптимизация комбинаций площадок КРТ")
    parser.add_argument(
        "--input",
        default="input_data/параметры площадок(1).xlsx",
        help="Путь к исходному Excel-файлу с параметрами площадок",
    )
    parser.add_argument(
        "--output",
        default="output/KRT_оптимизация_результат.xlsx",
        help="Путь к итоговому Excel-отчёту",
    )
    parser.add_argument(
        "--time-limit",
        type=float,
        default=120.0,
        help="Лимит времени (сек) на каждый из 5 этапов CP-SAT",
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    print(f"[1/5] Загрузка данных из {args.input!r}...")
    try:
        sites = SiteRepository(args.input).load()
    except DataValidationError as exc:
        print(f"Ошибка валидации данных: {exc}", file=sys.stderr)
        return 1
    print(f"      Площадок в исходном файле: {len(sites)}")

    print("[2/5] Генерация допустимых кандидатов (обычные комбинации + крупные площадки)...")
    t0 = time.time()
    candidates = CandidateGenerator(sites).generate()
    regular_count = sum(1 for c in candidates if c.ctype is CandidateType.REGULAR)
    large_count = sum(1 for c in candidates if c.ctype is CandidateType.LARGE)
    print(
        f"      Кандидатов после фильтров (площадь ≤45 га, IP>1): "
        f"{regular_count} обычных, {large_count} крупных самостоятельных "
        f"(за {time.time() - t0:.1f} с)"
    )

    print("[3/5] Лексикографическая глобальная оптимизация (CP-SAT, компактная модель по назначениям)...")
    optimizer = SiteAssignmentOptimizer(sites, time_limit_seconds=args.time_limit)
    result = optimizer.solve()
    for stage in result.stages:
        proof = "оптимум доказан" if stage.proven_optimal else "лимит времени, оптимум НЕ доказан"
        print(f"      {stage.name}: {stage.value} ({proof})")

    print("[4/5] Контрольные проверки и сверка с эталоном...")
    validation = Validator(sites, candidates, result).validate()
    for check in validation.checks:
        mark = "OK" if check.passed else "ОШИБКА"
        print(f"      [{mark}] {check.name}")
    print("      " + validation.comparison_note.replace("\n", "\n      "))

    print(f"[5/5] Экспорт отчёта в {args.output!r}...")
    ExcelReportBuilder(result, validation, total_sites=len(sites)).build(args.output)

    if not validation.all_hard_checks_passed:
        print("ВНИМАНИЕ: не все жёсткие проверки пройдены, см. отчёт.", file=sys.stderr)
        return 2

    print("Готово.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
