"""Excel → web/data/*.json и tests/golden_cases.json (ARCHITECTURE.md, разделы 6 и 11).

Показатели считает методика из krt_optimizer.models; скрипт только
собирает данные, сверяет пересчёт с принятым Excel и падает при расхождении.

Запуск (после build_images.py): .venv/Scripts/python tools/build_data.py
"""
from __future__ import annotations

import json
import random
from datetime import date
from pathlib import Path

import pandas as pd

from common import (DATA_DIR, GOLDEN_CASES, IMAGES_MANIFEST, NAMES_XLSX, RESULT_XLSX, SITES_XLSX,
                    BuildError, id_sort_key, log, setup_logging)
from krt_optimizer.candidate_generator import CandidateGenerator
from krt_optimizer.data_repository import REQUIRED_COLUMNS, SiteRepository
from krt_optimizer.models import IP_EPS, MAX_COMBO_SIZE, Candidate, CandidateType, Site
from optimize_reference import optimize
from rules import MAX_AREA_TENTHS, area_fits, area_tenths, ip_valid_int

GRAD_COLUMN = "Градпотенциал, кв.м"
REGULAR, STANDALONE = "Комбинация", "Самостоятельная >45 га"
EXPECTED = {"sites": 80, "anchors": 17, "regular": 16, "not_included": 12}
GOLDEN_RANDOM = 30
GOLDEN_SEED = 20260924


def whole(value: float) -> int:
    """м² в Excel целые: в JSON пишем без «.0»."""
    if not float(value).is_integer():
        raise BuildError(f"Ожидалось целое число м², получено {value}")
    return int(value)


def split_ids(cell: object) -> list[str]:
    if pd.isna(cell) or str(cell).strip() in {"", "—"}:
        return []
    return [f"{float(x):.1f}" for x in str(cell).split(";")]


def load_grad() -> dict[str, float]:
    df = pd.read_excel(SITES_XLSX, usecols=[REQUIRED_COLUMNS["id"], GRAD_COLUMN])
    return {f"{float(i):.1f}": float(g) for i, g in zip(df[REQUIRED_COLUMNS["id"]], df[GRAD_COLUMN])}


def load_names(site_ids: set[str]) -> dict[str, str]:
    """Адреса площадок: ровно по одному на каждую площадку из Excel параметров."""
    df = pd.read_excel(NAMES_XLSX, usecols=[REQUIRED_COLUMNS["id"], "Наименование"])
    names = {f"{float(i):.1f}": " ".join(str(n).split()) for i, n in zip(df[REQUIRED_COLUMNS["id"]], df["Наименование"])}
    if len(names) != len(df) or set(names) != site_ids or not all(names.values()):
        raise BuildError(f"{NAMES_XLSX.name}: повторы, пустые адреса или расхождение ID {sorted(set(names) ^ site_ids)}")
    return names


def combo(sites: dict[str, Site], anchor_id: str, additional: list[str]) -> Candidate:
    anchor = sites[anchor_id]
    extra = tuple(sites[i] for i in additional)
    return Candidate(CandidateType.REGULAR, anchor, extra, (anchor, *extra))


def check_close(label: str, actual: float, expected: float, tol: float) -> None:
    if abs(actual - expected) > tol:
        raise BuildError(f"{label}: пересчёт {actual} ≠ Excel {expected}")


def read_recommended(sites: dict[str, Site]) -> dict[str, dict]:
    """Лист «Итог» → опорная → состав. Каждая строка сверяется с пересчётом."""
    df = pd.read_excel(RESULT_XLSX, sheet_name="Итог", header=2)
    df = df[df["Тип"].isin([REGULAR, STANDALONE])]
    by_anchor: dict[str, dict] = {}
    for row in df.to_dict("records"):
        if row["Тип"] == REGULAR:
            anchor_id, extra = f"{float(row['Опорная площадка']):.1f}", split_ids(row["Дополнительные площадки"])
            c = combo(sites, anchor_id, extra)
            label = f"Комбинация {c.composition_label}"
            if not (area_fits(list(c.members)) and ip_valid_int(list(c.members))):
                raise BuildError(f"{label} не проходит методику")
            check_close(f"{label}, IP", c.integral_ip, row["Интегральный IP"], 1e-6)
            check_close(f"{label}, площадь", c.area_ga, row["Площадь, га"], 0.01)
            check_close(f"{label}, Δ аварийного фонда", c.delta_avar_fond, row["Δ аварийного фонда, м²"], 0.5)
            check_close(f"{label}, Δ новой жилой", c.delta_novoy_zhiloy, row["Δ новой жилой застройки, м²"], 0.5)
            check_close(f"{label}, Δ прочей сносимой", c.delta_prochey_snos, row["Δ прочей сносимой застройки, м²"], 0.5)
            by_anchor[anchor_id] = {"type": "regular", "additional": extra}
        else:
            site_id = f"{float(row['Полный состав']):.1f}"
            if sites[site_id].is_opornaya:
                by_anchor[site_id] = {"type": "standalone", "additional": []}
    anchors = {i for i, s in sites.items() if s.is_opornaya}
    if set(by_anchor) != anchors:
        raise BuildError(f"Рекомендации не покрывают опорные: {sorted(anchors ^ set(by_anchor))}")
    if sum(v["type"] == "regular" for v in by_anchor.values()) != EXPECTED["regular"]:
        raise BuildError("Неожиданное число обычных комбинаций")
    return dict(sorted(by_anchor.items(), key=lambda kv: id_sort_key(kv[0])))


def read_not_included(sites: dict[str, Site]) -> dict[str, str]:
    df = pd.read_excel(RESULT_XLSX, sheet_name="Не вошли")
    reasons = {f"{float(i):.1f}": str(r).strip() for i, r in zip(df["Площадка"], df["Причина"])}
    unknown = set(reasons) - set(sites)
    if unknown or len(reasons) != EXPECTED["not_included"]:
        raise BuildError(f"Лист «Не вошли»: неизвестные ID {sorted(unknown)} или не {EXPECTED['not_included']} строк")
    return dict(sorted(reasons.items(), key=lambda kv: id_sort_key(kv[0])))


def site_json(s: Site, name: str, grad: float, images: dict, reason: str | None) -> dict:
    img = images[s.site_id]
    return {
        "id": s.site_id, "name": name, "category": s.category.value,
        "areaHa": s.area_ga, "ip": s.ip,
        "avarM2": whole(s.avar_fond), "gradM2": whole(grad),
        "sppNewM2": whole(s.sp_novoy_zhiloy), "sppDemolM2": whole(s.sp_prochey_snos),
        "image": f"img/parcels/{s.site_id}.webp", "imageSize": [img["image"]["w"], img["image"]["h"]],
        "thumb": f"img/parcels/{s.site_id}.thumb.webp", "thumbSize": [img["thumb"]["w"], img["thumb"]["h"]],
        "imageWidthM": img["widthM"],
        "addable": not s.is_opornaya and not s.is_large,
        "reason": reason,
    }


def golden_case(sites: dict[str, Site], grad: dict[str, float], anchor_id: str, additional: list[str], note: str) -> dict:
    c = combo(sites, anchor_id, additional)
    members = list(c.members)
    if ip_valid_int(members) != (c.integral_ip > 1.0 + IP_EPS):
        raise BuildError(f"Целочисленная и float-проверка IP расходятся: {c.composition_label}")
    return {
        "note": note, "anchor": anchor_id, "additional": additional,
        "expected": {
            "count": c.size, "areaHa": round(c.area_ga, 6), "ip": round(c.integral_ip, 12),
            "ipValid": ip_valid_int(members), "areaFits": area_fits(members),
            "avarM2": whole(sum(s.avar_fond for s in members)), "gradM2": whole(sum(grad[s.site_id] for s in members)),
            "sppNewM2": whole(c.total_novoy_zhiloy), "sppDemolM2": whole(c.total_prochey_snos),
            "deltaAvarM2": whole(c.delta_avar_fond), "deltaSppNewM2": whole(c.delta_novoy_zhiloy),
            "deltaSppDemolM2": whole(c.delta_prochey_snos),
        },
    }


def golden_cases(sites: dict[str, Site], grad: dict[str, float], recommended: dict[str, dict]) -> list[dict]:
    """Рекомендации, одиночные опорные, границы (IP = 1, 45 га) и случайные допустимые комбинации."""
    cases = [golden_case(sites, grad, a, r["additional"], "рекомендация") for a, r in recommended.items()]
    cases += [golden_case(sites, grad, a, [], "только опорная") for a in recommended]

    pool = [s for s in sites.values() if not s.is_opornaya and not s.is_large]
    for ip_one in ("15.3", "19.1"):  # IP ровно 1,00 у присоединяемой
        cases.append(golden_case(sites, grad, "11.2", [ip_one], f"с {ip_one}, IP = 1,00"))
    cases.append(golden_case(sites, grad, "11.2", ["20.2", "27.3"], "с IP = 0, не проходит"))
    cases.append(golden_case(sites, grad, "2.2", ["27.6", "30.2"], "превышение 45 га"))

    candidates = CandidateGenerator(list(sites.values())).generate()
    regular = [c for c in candidates if c.ctype is CandidateType.REGULAR]
    boundary = [c for c in regular if sum((round(s.ip * 100) - 100) * round(s.area_ga * 10) for s in c.members) == 1]
    exactly_45 = [c for c in regular if area_tenths(c.members) == MAX_AREA_TENTHS and c.size == MAX_COMBO_SIZE]
    rng = random.Random(GOLDEN_SEED)
    picks = [("минимальный запас по IP", boundary[:3]), ("ровно 45 га, 5 площадок", exactly_45[:3]),
             ("случайная допустимая", rng.sample(regular, GOLDEN_RANDOM))]
    for note, group in picks:
        cases += [golden_case(sites, grad, c.anchor.site_id, [s.site_id for s in c.additional], note) for c in group]
    for _ in range(10):  # IP ≤ 1: случайные наборы с обременениями
        anchor = rng.choice([a for a in recommended if not sites[a].is_large])
        extra = [s.site_id for s in rng.sample(pool, rng.randint(1, MAX_COMBO_SIZE - 1))]
        cases.append(golden_case(sites, grad, anchor, extra, "случайный набор"))
    return cases


def optimize_cases(sites: dict[str, Site], recommended: dict[str, dict], not_included: dict[str, str]) -> list[dict]:
    """Оптимизация выбора: пустой выбор, часть рекомендации, IP ≤ 1, полный набор, 31.4."""
    pool_ids = [i for i, s in sites.items() if not s.is_opornaya and not s.is_large and i not in not_included]
    rng = random.Random(GOLDEN_SEED)
    inputs = [(a, [], "пустой выбор") for a in recommended]
    inputs += [(a, r["additional"][:2], "две из рекомендации") for a, r in list(recommended.items())[:8] if r["additional"]]
    inputs += [("11.2", ["27.3"], "оставлена площадка с IP = 0"), ("20.1", [], "опорная с IP = 1,00"),
               ("1.2", recommended["1.2"]["additional"] + ["35.3"], "выбрано 4")]
    for _ in range(6):
        anchor = rng.choice([a for a in recommended if not sites[a].is_large])
        inputs.append((anchor, rng.sample(pool_ids, rng.randint(1, 2)), "случайный выбор"))

    cases = []
    for anchor, kept_ids, note in inputs:
        kept = [sites[anchor], *(sites[i] for i in kept_ids)]
        pool = [sites[i] for i in pool_ids if i not in kept_ids]
        status, added = optimize(kept, pool)
        cases.append({"note": note, "anchor": anchor, "kept": kept_ids, "status": status, "added": added})
    return cases


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    log.info("Записан %s", path.relative_to(path.parents[1]))


def main() -> None:
    setup_logging()
    site_list = sorted(SiteRepository(SITES_XLSX).load(), key=lambda s: id_sort_key(s.site_id))
    sites = {s.site_id: s for s in site_list}
    if len(sites) != EXPECTED["sites"] or sum(s.is_opornaya for s in site_list) != EXPECTED["anchors"]:
        raise BuildError("Неожиданное число площадок или опорных в Excel")
    if not IMAGES_MANIFEST.exists():
        raise BuildError("Нет build/images.json: сначала запустите tools/build_images.py")
    images = json.loads(IMAGES_MANIFEST.read_text(encoding="utf-8"))
    if set(images) != set(sites):
        raise BuildError(f"Картинки не совпадают с Excel: {sorted(set(images) ^ set(sites))}")

    grad = load_grad()
    names = load_names(set(sites))
    recommended = read_recommended(sites)
    not_included = read_not_included(sites)
    covered = {i for a, r in recommended.items() for i in [a, *r["additional"]]}
    standalone_large = {s.site_id for s in site_list if s.is_large and not s.is_opornaya and s.site_id not in not_included}
    coverage = len(covered | standalone_large)
    if coverage + len(not_included) != len(sites):
        raise BuildError(f"Охват {coverage} + не вошли {len(not_included)} ≠ {len(sites)}")

    today = date.today().isoformat()
    write_json(DATA_DIR / "sites.json", {
        "version": today, "source": SITES_XLSX.name,
        "sites": [site_json(s, names[s.site_id], grad[s.site_id], images, not_included.get(s.site_id)) for s in site_list],
    })
    write_json(DATA_DIR / "recommended.json", {
        "source": RESULT_XLSX.name, "coverage": coverage, "total": len(sites),
        "byAnchor": recommended, "notIncluded": not_included,
    })
    write_json(GOLDEN_CASES, {
        "version": today, "cases": golden_cases(sites, grad, recommended),
        "optimize": optimize_cases(sites, recommended, not_included),
    })


if __name__ == "__main__":
    try:
        main()
    except BuildError as err:
        raise SystemExit(f"Ошибка сборки: {err}") from None
