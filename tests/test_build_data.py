"""Проверки собранных данных (ARCHITECTURE.md, раздел 11). Запуск: pytest tests/"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from rules import area_fits, ip_valid_int  # noqa: E402
from krt_optimizer.models import Category, Site  # noqa: E402

WEB = ROOT / "web"


def load(name: str) -> dict:
    return json.loads((WEB / "data" / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def sites() -> dict[str, dict]:
    return {s["id"]: s for s in load("sites.json")["sites"]}


@pytest.fixture(scope="module")
def recommended() -> dict:
    return load("recommended.json")


def as_site(s: dict) -> Site:
    return Site(s["id"], s["avarM2"], s["sppDemolM2"], s["areaHa"], s["sppNewM2"], s["ip"], Category(s["category"]))


def test_counts(sites):
    assert len(sites) == 80
    assert sum(s["category"] == "опорная" for s in sites.values()) == 18
    assert sum(s["addable"] and not s["reason"] for s in sites.values()) == 42
    assert sum(bool(s["reason"]) for s in sites.values()) == 12
    assert sum(s["addable"] and bool(s["reason"]) for s in sites.values()) == 5


def test_every_site_has_images(sites):
    for s in sites.values():
        assert (WEB / s["image"]).is_file(), s["id"]
        assert (WEB / s["thumb"]).is_file(), s["id"]
        assert s["imageWidthM"] > 0


def test_recommendations_pass_methodology(sites, recommended):
    assert recommended["coverage"] == 68
    assert len(recommended["byAnchor"]) == 18
    assert recommended["byAnchor"]["31.4"] == {"type": "standalone", "additional": []}
    seen: set[str] = set()
    for anchor, rec in recommended["byAnchor"].items():
        ids = [anchor, *rec["additional"]]
        assert not seen & set(ids), "площадка в двух рекомендациях"
        seen |= set(ids)
        if rec["type"] == "regular":
            members = [as_site(sites[i]) for i in ids]
            assert area_fits(members) and ip_valid_int(members), anchor
            assert all(sites[i]["addable"] for i in rec["additional"])


def test_ip_integer_check_boundary(sites):
    assert not ip_valid_int([as_site(sites["20.1"])])  # IP ровно 1,00
    assert ip_valid_int([as_site(sites["11.2"])])


def test_web_has_only_public_files():
    allowed = {".html", ".css", ".js", ".json", ".webp", ".otf", ".svg", ".txt"}
    extra = [p for p in WEB.rglob("*") if p.is_file() and p.suffix not in allowed]
    assert not extra, extra


def methodology_score(sites: dict[str, dict], anchor: str, additional: list[str]) -> tuple:
    extra = [sites[i] for i in additional]
    return (1 + len(extra), sum(s["avarM2"] for s in extra), sum(s["sppNewM2"] for s in extra),
            -sum(s["sppDemolM2"] for s in extra))


def test_optimizer_not_worse_than_recommendation(sites, recommended):
    """Рекомендация допустима для подбора, значит подбор с нуля не может быть хуже по целям методики."""
    golden = json.loads((ROOT / "tests" / "golden_cases.json").read_text(encoding="utf-8"))
    for case in golden["optimize"]:
        rec = recommended["byAnchor"][case["anchor"]]
        if case["kept"] or rec["type"] != "regular":
            continue
        assert case["status"] == "ok"
        found = methodology_score(sites, case["anchor"], case["added"])
        assert found >= methodology_score(sites, case["anchor"], rec["additional"]), case["anchor"]


def test_svg_has_no_active_content():
    """SVG из дизайна публикуется как картинка: без скриптов, обработчиков и внешних ссылок."""
    import re
    for svg in WEB.rglob("*.svg"):
        text = svg.read_text(encoding="utf-8")
        assert not re.search(r"<script|<foreignObject|\son\w+=|href=", text, re.I), svg.name


def test_pages_exist():
    assert (WEB / "index.html").is_file() and (WEB / "formation.html").is_file()


def test_scoring_data():
    """Скоринг: сетка общая для профилей, состав критериев и площадок как в итоговой карте."""
    data = WEB / "data" / "scoring"
    hexes = json.loads((data / "hexes.json").read_text(encoding="utf-8"))
    profiles = json.loads((data / "profiles.json").read_text(encoding="utf-8"))["profiles"]
    plots = json.loads((data / "plots.json").read_text(encoding="utf-8"))["features"]
    n = len(hexes["hexId"])
    assert n == 15372 and len(hexes["rings"]) == n and sum(hexes["inKrt"]) == 1370
    assert [len(profiles[k]["layers"]) for k in ("city", "investor")] == [13, 14]
    assert all(len(col) == n for p in profiles.values() for col in p["scores"].values())
    assert "crit_16_score" not in profiles["investor"]["scores"]
    assert len(plots) == 80
    assert {f["properties"]["plot_number"] for f in plots} == set(load("recommended.json")["byAnchor"]) | {
        s["id"] for s in load("sites.json")["sites"] if s["category"] != "опорная"}


def test_mapbox_token_is_public_only():
    config = json.loads((WEB / "data" / "scoring" / "map-config.json").read_text(encoding="utf-8"))
    url = config["mapboxTilesUrl"]
    assert url is None or ("access_token=pk." in url and "sk." not in url)
