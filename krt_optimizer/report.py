"""Экспорт результата в Excel (структура листов как в KRT_оптимизация_итог.xlsx)."""
from __future__ import annotations

from pathlib import Path
from typing import List

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.worksheet import Worksheet

from .assignment_optimizer import OptimizationResult
from .models import Candidate, CandidateType
from .validator import ValidationReport

HEADER_FONT = Font(bold=True)


def _autosize(ws: Worksheet) -> None:
    for col_cells in ws.columns:
        length = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
        ws.column_dimensions[col_cells[0].column_letter].width = min(max(length + 2, 10), 60)


class ExcelReportBuilder:
    def __init__(self, result: OptimizationResult, validation: ValidationReport, total_sites: int):
        self.result = result
        self.validation = validation
        self.total_sites = total_sites

    def build(self, output_path: str | Path) -> None:
        wb = Workbook()
        self._write_summary_sheet(wb.active)
        self._write_excluded_sheet(wb.create_sheet("Не вошли"))
        self._write_checks_sheet(wb.create_sheet("Проверки"))
        self._write_methodology_sheet(wb.create_sheet("Методика"))
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        wb.save(output_path)

    def _write_summary_sheet(self, ws: Worksheet) -> None:
        ws.title = "Итог"
        ws.append(["Итоговый набор комбинаций КРТ"])
        ws["A1"].font = HEADER_FONT
        headers = [
            "№",
            "Тип",
            "Опорная площадка",
            "Дополнительные площадки",
            "Полный состав",
            "Кол-во площадок",
            "Интегральный IP",
            "Площадь, га",
            "Δ аварийного фонда, м²",
            "Δ новой жилой застройки, м²",
            "Δ прочей сносимой застройки, м²",
            "Новая жилая застройка всего, м²",
            "Прочая сносимая застройка всего, м²",
        ]
        ws.append([])
        ws.append(headers)
        for cell in ws[3]:
            cell.font = HEADER_FONT

        regular = [c for c in self.result.selected if c.ctype is CandidateType.REGULAR]
        large = [c for c in self.result.selected if c.ctype is CandidateType.LARGE]
        # порядок вывода: по опорной/ID для читаемости и воспроизводимости
        regular.sort(key=lambda c: c.anchor.site_id if c.anchor else "")
        large.sort(key=lambda c: c.members[0].site_id)

        row_num = 1
        for c in regular:
            ws.append(
                [
                    row_num,
                    c.ctype.value,
                    c.anchor_label,
                    c.additional_label,
                    c.composition_label,
                    c.size,
                    round(c.integral_ip, 6),
                    round(c.area_ga, 2),
                    round(c.delta_avar_fond, 2),
                    round(c.delta_novoy_zhiloy, 2),
                    round(c.delta_prochey_snos, 2),
                    round(c.total_novoy_zhiloy, 2),
                    round(c.total_prochey_snos, 2),
                ]
            )
            row_num += 1
        for c in large:
            ws.append(
                [
                    row_num,
                    c.ctype.value,
                    c.anchor_label,
                    c.additional_label,
                    c.composition_label,
                    c.size,
                    round(c.integral_ip, 6),
                    round(c.area_ga, 2),
                    round(c.delta_avar_fond, 2),
                    round(c.delta_novoy_zhiloy, 2),
                    round(c.delta_prochey_snos, 2),
                    round(c.total_novoy_zhiloy, 2),
                    round(c.total_prochey_snos, 2),
                ]
            )
            row_num += 1

        coverage = self.validation.coverage
        ws.append([])
        ws.append([f"Итого уникальных площадок: {coverage} из {self.total_sites} ({coverage / self.total_sites:.0%})"])
        ws.append([f"Обычных комбинаций: {len(regular)}; крупных самостоятельных площадок: {len(large)}"])
        _autosize(ws)

    def _write_excluded_sheet(self, ws: Worksheet) -> None:
        headers = ["Площадка", "Категория", "IP", "Площадь, га", "Причина", "Аварийный фонд, м²", "Новая жилая застройка, м²", "Прочая сносимая застройка, м²"]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = HEADER_FONT
        for item in sorted(self.validation.excluded, key=lambda e: e.site.site_id):
            s = item.site
            ws.append([s.site_id, s.category.value, s.ip, s.area_ga, item.reason, s.avar_fond, s.sp_novoy_zhiloy, s.sp_prochey_snos])
        _autosize(ws)

    def _write_checks_sheet(self, ws: Worksheet) -> None:
        ws.append(["Этап лексикографической оптимизации", "Направление", "Достигнутое значение", "Оптимальность доказана"])
        for cell in ws[1]:
            cell.font = HEADER_FONT
        for stage in self.result.stages:
            ws.append([stage.name, stage.direction, stage.value, "да" if stage.proven_optimal else "нет (лимит времени)"])

        ws.append([])
        ws.append(["Контрольная проверка", "Результат", "Детали"])
        for cell in ws[ws.max_row]:
            cell.font = HEADER_FONT
        for check in self.validation.checks:
            ws.append([check.name, "OK" if check.passed else "ОШИБКА", check.detail])

        ws.append([])
        ws.append(["Сверка с эталонным набором из методики"])
        ws[f"A{ws.max_row}"].font = HEADER_FONT
        for line in self.validation.comparison_note.split("\n"):
            ws.append([line])
        _autosize(ws)
        for row in ws.iter_rows():
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")

    def _write_methodology_sheet(self, ws: Worksheet) -> None:
        rows = [
            ["Примененная методика оптимизации"],
            [],
            ["Этап", "Условие", "Приоритет", "Реализация"],
            [1, "Комбинации из 1–5 площадок с опорной", "Жёсткое", "Для обычных комбинаций Σ площади ≤45 га"],
            ["1а", "Площадки >45 га", "Жёсткое", "Допускаются самостоятельно при собственном IP >1"],
            [2, "Интегральный IP >1", "Жёсткое", "Средневзвешенный по площади территории"],
            [3, "Предельные эффекты", "Расчёт", "Δ аварийного фонда; Δ новой жилой; Δ прочей сносимой"],
            [4, "Охват уникальных площадок", 1, "Максимизируется при полном запрете повторений (CP-SAT)"],
            [5, "Количество площадок в комбинации", 2, "Минимизируется максимальный размер обычной комбинации"],
            [
                6,
                "Парето-эффективность",
                3,
                "Не отдельный MILP-этап: гарантируется лексикографическим порядком шагов 7-9 "
                "(лексикографический оптимум по трём эффектам всегда Парето-эффективен)",
            ],
            [7, "Эффекты", "4-6", "Последовательно: аварийный фонд ↑, новая жилая ↑, прочая сносимая ↓"],
            [],
            ["Результат"],
            ["Максимальный охват", f"{self.validation.coverage} из {self.total_sites} площадок", f"{self.validation.coverage / self.total_sites:.0%}"],
            ["Макс. размер обычной комбинации", self.validation.max_regular_size, ""],
            ["Не вошли", len(self.validation.excluded), ""],
        ]
        for row in rows:
            ws.append(row)
        ws["A1"].font = HEADER_FONT
        ws["A13"].font = HEADER_FONT
        _autosize(ws)
