"""Скоринговая модель: GPKG-результаты → web/data/scoring/*.json (ARCHITECTURE.md, раздел 16).

Логика перенесена из generate_map.py проекта скоринга без изменений алгоритмов:
подписи и направления критериев — из «Критерии.xlsx» (crt_pipeline), те же
правки подписей для HTML, упрощение гексов на 40 м, округление баллов до
3 знаков, привязка гексов к площадкам по intersects и средние баллы площадок.
Отличие только в формате: геометрия гексов хранится один раз, баллы — столбцами.

Запуск: .venv/Scripts/python tools/build_scoring.py
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

from common import ROOT, WEB_DIR, BuildError, log, setup_logging

SRC = ROOT / "scoring"
sys.path.insert(0, str(SRC))
import crt_pipeline as P  # noqa: E402  методика скоринга, не изменяется

OUT = WEB_DIR / "data" / "scoring"
CRITERIA_XLSX = SRC / "Критерии.xlsx"
PROFILES = {  # профиль → (лист критериев, результат расчёта)
    "city": ("город", SRC / "krt_scores_city_criterion12_inverted.gpkg"),
    "investor": ("инвестор", SRC / "krt_scores_investor_without_16.gpkg"),
}
PLOTS_GPKG = SRC / "Площадки КРТ в МСК 75.gpkg"
PLOTS_MATRIX_XLSX = SRC / "Копия Мастер-презентация _ КРТ Чита - График 156.xlsx"
EXCLUDED_PLOTS = {"3.1", "3.2", "4.1", "4.2", "5.1", "6.1", "6.2"}  # нет в параметрах площадок
PLOT_ID_ALIASES = {"22": "22.1"}
PLOT_ID_COLUMNS = ("*№ по ИД_1", "№ ИД", "№ по ИД_1", "plot_number")
STATUS_COLORS = {
    "Безусловный приоритет": "#00A7A7",
    "Нужны стимулы": "#CCB29F",
    "Нужно пересмотреть конфигурацию": "#2C4295",
    "Нейтральный статус": "#FEC700",
}
METRIC_CRS = 32649
SIMPLIFY_M = 40.0
SIMPLIFY_FROM = 5000        # упрощать сетки крупнее этого числа ячеек
SCORE_DIGITS = 3
COORD_DIGITS = 6            # ≈ 0,1 м: визуально без изменений, файл втрое меньше
EXPECTED = {"hexes": 15372, "plots": 80, "city": 13, "investor": 14}
ENV_FILE = ROOT / ".env"  # локальные секреты, в git не попадают
MAPBOX_STYLE_DEFAULT = "okamidan/cmqupgwnh000b01s41y4r8ams"  # стиль исходной карты


def env(name: str) -> str:
    """Переменная окружения или строка NAME=value из .env в корне проекта."""
    if os.getenv(name):
        return os.environ[name].strip()
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == name:
                return value.strip()
    return ""


def map_config() -> dict:
    """Подложка Mapbox: публичный токен (pk.) ограничивается доменом сайта в кабинете Mapbox."""
    token = env("MAPBOX_TOKEN")
    if token and not re.fullmatch(r"pk\.[\w.-]+", token):
        raise BuildError("MAPBOX_TOKEN: нужен публичный токен pk.… (секретный sk.… в браузер не отдаём)")
    style = env("MAPBOX_STYLE") or MAPBOX_STYLE_DEFAULT
    if not re.fullmatch(r"[\w-]+/[\w-]+", style):
        raise BuildError(f"MAPBOX_STYLE: ожидается «пользователь/стиль», получено {style!r}")
    if not token:
        log.warning("MAPBOX_TOKEN не задан: на карте будет только OpenStreetMap")
        return {"mapboxTilesUrl": None}
    return {"mapboxTilesUrl": f"https://api.mapbox.com/styles/v1/{style}/tiles/256/{{z}}/{{x}}/{{y}}?access_token={token}"}


# ---------- критерии ----------

def criterion_metadata(profile_key: str, sheet: str) -> dict[str, dict]:
    """Подписи и направления из листа Excel плюс согласованные правки для карты."""
    sheet_name = P.normalize_criteria_sheet(sheet)
    meta = {
        f"crit_{c.cid}_score": {
            "label": f"Критерий {c.cid}: {c.name}",
            "direction": c.direction,
            "direction_label": "Обратная" if c.direction == "inverse" else "Прямая",
        }
        for c in P.load_criteria(str(CRITERIA_XLSX), sheet_name=sheet_name)
    }
    if profile_key == "investor":
        for number, item in enumerate(meta.values(), start=1):
            item["label"] = re.sub(r"^Критерий\s+\d+:", f"Критерий {number}:", item["label"])
        if "crit_5_score" in meta:
            meta["crit_5_score"]["label"] = "Критерий 5: Концентрация общественно-деловой активности"
    if profile_key == "city":
        for key, direction in (("crit_13_score", "inverse"), ("crit_12_score", "direct")):
            if key in meta:
                meta[key]["direction"] = direction
                meta[key]["direction_label"] = "Обратная" if direction == "inverse" else "Прямая"
    return meta


# ---------- гексы ----------

def load_hexes(path: Path, expected_cols: list[str], all_plots: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, list[str]]:
    gdf = gpd.read_file(path)
    # Как в исходной карте: признак считается по ВСЕМ контурам слоя (87), включая
    # исключённые из показа площадки 3.1–6.2 (ARCHITECTURE.md, 16, открытый вопрос).
    gdf["_in_krt"] = gdf.geometry.intersects(all_plots.to_crs(gdf.crs).geometry.union_all())
    if len(gdf) > SIMPLIFY_FROM:
        gdf = gdf.to_crs(METRIC_CRS).copy()
        gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_M, preserve_topology=True)
    gdf = gdf.to_crs(4326)
    available = {c for c in gdf.columns if re.fullmatch(r"crit_\d+_score", c)}
    missing = [c for c in expected_cols if c not in available]
    stale = sorted(available - set(expected_cols))
    if missing:
        log.warning("%s: в Excel есть критерии без колонки в GPKG: %s", path.name, missing)
    if stale:
        log.info("%s: колонки вне листа Excel не публикуются: %s", path.name, stale)
    cols = [c for c in expected_cols if c in available]
    for col in cols:
        gdf[col] = gdf[col].round(SCORE_DIGITS)
    return gdf[["hex_id", "_in_krt", "geometry", *cols]], cols


def ring(coords) -> list[list[float]]:
    return [[round(x, COORD_DIGITS), round(y, COORD_DIGITS)] for x, y in coords]


def polygon_coords(geom) -> list:
    return [ring(geom.exterior.coords), *(ring(i.coords) for i in geom.interiors)]


def geometry_json(geom) -> dict:
    if geom.geom_type == "Polygon":
        return {"type": "Polygon", "coordinates": polygon_coords(geom)}
    return {"type": "MultiPolygon", "coordinates": [polygon_coords(p) for p in geom.geoms]}


def column(series: pd.Series) -> list:
    return [None if pd.isna(v) else float(v) for v in series]


# ---------- площадки ----------

def plot_id(value) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, (pd.Timestamp, datetime.datetime, datetime.date)):
        return f"{value.day}.{value.month}"   # Excel превращает «1.2» в дату
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip().replace(",", ".")


def repair_mojibake(value):
    if not isinstance(value, str):
        return value
    try:
        return value.encode("latin1").decode("utf-8") or value
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def read_plots_layer() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(PLOTS_GPKG)
    gdf.columns = [repair_mojibake(c) for c in gdf.columns]
    for col in gdf.select_dtypes(include=["object", "str"]).columns:
        gdf[col] = gdf[col].map(repair_mojibake)
    return gdf


def load_plots(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Площадки для показа: без исключённых, с площадью, статусом и градпотенциалом."""
    gdf = gdf.copy()
    id_col = next((c for c in PLOT_ID_COLUMNS if c in gdf.columns), None)
    if id_col is None:
        raise BuildError(f"{PLOTS_GPKG.name}: нет поля номера площадки, поля: {list(gdf.columns)}")
    gdf["plot_number"] = gdf[id_col].map(plot_id).replace(PLOT_ID_ALIASES)
    gdf = gdf[~gdf["plot_number"].isin(EXCLUDED_PLOTS)].copy()
    gdf["name"] = gdf["name"].fillna("—")
    gdf["area_ha"] = gdf.geometry.area / 10_000   # слой в метрической проекции

    matrix = pd.read_excel(PLOTS_MATRIX_XLSX, sheet_name="Матрица площадок", header=0)
    statuses = matrix.iloc[:87, [0, 1, 2, 7, 9]].copy()
    statuses.columns = ["plot_number", "city_score", "investor_score", "status", "potential_thsqm"]
    statuses["plot_number"] = statuses["plot_number"].map(plot_id).replace(PLOT_ID_ALIASES)
    statuses["status_color"] = statuses["status"].map(STATUS_COLORS)
    gdf = gdf.merge(statuses, on="plot_number", how="left")
    gdf["status_color"] = gdf["status_color"].fillna("#000000")
    return gdf


def plot_criteria(plots: gpd.GeoDataFrame, hexes: gpd.GeoDataFrame, cols: list[str]) -> list[dict]:
    """Средние баллы гексов, пересекающих площадку (по упрощённой геометрии, как в карте)."""
    joined = gpd.sjoin(hexes[cols + ["geometry"]].to_crs(plots.crs), plots[["plot_number", "geometry"]],
                       how="inner", predicate="intersects")
    means = joined.groupby("plot_number")[cols].mean()
    lookup = {str(pid): {k: (None if pd.isna(v) else float(v)) for k, v in row.items()}
              for pid, row in means.iterrows()}
    return [lookup.get(str(pid), {}) for pid in plots["plot_number"]]


def plot_feature(row, criteria: dict[str, dict]) -> dict:
    num = lambda v: None if pd.isna(v) else (int(v) if float(v).is_integer() else float(v))  # noqa: E731
    return {
        "type": "Feature",
        "properties": {
            "plot_number": row["plot_number"], "name": row["name"],
            "status": None if pd.isna(row["status"]) else row["status"], "status_color": row["status_color"],
            "area_ha": float(row["area_ha"]), "potential_thsqm": num(row["potential_thsqm"]),
            "city_score": num(row["city_score"]), "investor_score": num(row["investor_score"]),
            **{f"criteria_{k}": v for k, v in criteria.items()},
        },
        "geometry": geometry_json(row["geometry"]),
    }


# ---------- сборка ----------

def write(name: str, payload: object) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("Записан %s (%d КБ)", path.relative_to(ROOT), path.stat().st_size // 1024)


def main() -> None:
    setup_logging()
    layer = read_plots_layer()
    plots = load_plots(layer)
    profiles, frames = {}, {}
    for key, (sheet, gpkg) in PROFILES.items():
        meta = criterion_metadata(key, sheet)
        hexes, cols = load_hexes(gpkg, list(meta), layer)
        _, label = P.profile_from_sheet(P.normalize_criteria_sheet(sheet))
        frames[key] = (hexes, cols)
        profiles[key] = {
            "label": label, "sheet_name": P.normalize_criteria_sheet(sheet),
            "layers": [{"key": c, **meta[c]} for c in cols],
            "scores": {c: column(hexes[c]) for c in cols},
        }

    city, investor = frames["city"][0], frames["investor"][0]
    if len(city) != EXPECTED["hexes"] or not city["hex_id"].equals(investor["hex_id"]):
        raise BuildError("Сетки профилей не совпадают: общий слой сопоставит разные ячейки")
    if not city.geometry.geom_equals(investor.geometry).all():
        raise BuildError("Геометрия гексов профилей различается")
    if (city.geometry.geom_type != "Polygon").any() or city.geometry.map(lambda g: len(g.interiors)).any():
        raise BuildError("Гексы должны быть простыми полигонами: формат hexes.json хранит один контур")
    for key in PROFILES:
        if len(profiles[key]["layers"]) != EXPECTED[key]:
            raise BuildError(f"Профиль {key}: {len(profiles[key]['layers'])} критериев, ожидалось {EXPECTED[key]}")
    if len(plots) != EXPECTED["plots"]:
        raise BuildError(f"Площадок {len(plots)}, ожидалось {EXPECTED['plots']}")

    criteria = {key: plot_criteria(plots, *frames[key]) for key in PROFILES}
    write("hexes.json", {
        "hexId": [int(v) for v in city["hex_id"]],
        "inKrt": [bool(v) for v in city["_in_krt"]],
        "rings": [polygon_coords(g)[0] for g in city.geometry],
    })
    write("profiles.json", {"version": datetime.date.today().isoformat(), "profiles": profiles})
    write("map-config.json", map_config())
    write("plots.json", {"type": "FeatureCollection", "features": [
        plot_feature(row, {k: criteria[k][i] for k in PROFILES})
        for i, (_, row) in enumerate(plots.to_crs(4326).iterrows())
    ]})


if __name__ == "__main__":
    try:
        main()
    except BuildError as err:
        raise SystemExit(f"Ошибка сборки: {err}") from None
