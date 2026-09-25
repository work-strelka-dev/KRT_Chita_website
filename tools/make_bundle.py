"""Архив для развёртывания на сервере: build/krt-chita-deploy-<дата>.tar.gz.

Внутри — только то, что нужно для `docker compose up -d --build`: web/, docker/,
deploy/nginx/, docker-compose.yml, .dockerignore, .env.example, docs/DEPLOY.md.
Исходные Excel, GPKG, PDF, .env, секреты и map-config.json с токеном не попадают.
Docker на машине аналитика не нужен: образ собирается на сервере.

Запуск (после build_*.py и тестов): .venv/Scripts/python tools/make_bundle.py
"""
from __future__ import annotations

import datetime
import io
import tarfile
from pathlib import Path

from common import BUILD_DIR, ROOT, BuildError, log, setup_logging

TOP = "krt-chita"
INCLUDE_DIRS = ["web", "docker", "deploy/nginx"]
INCLUDE_FILES = ["docker-compose.yml", ".dockerignore", ".env.example", "docs/DEPLOY.md"]
EXCLUDE = {"web/data/scoring/map-config.json"}
WEB_TYPES = {".html", ".css", ".js", ".json", ".webp", ".otf", ".svg", ".txt"}
EXECUTABLE = {"docker/40-krt-runtime.sh"}
TEXT_TYPES = {".html", ".css", ".js", ".json", ".svg", ".txt", ".md", ".yml", ".conf", ".sh", ""}


def collect() -> list[Path]:
    files = [p for d in INCLUDE_DIRS for p in sorted((ROOT / d).rglob("*")) if p.is_file()]
    files += [ROOT / f for f in INCLUDE_FILES]
    files = [p for p in files if p.relative_to(ROOT).as_posix() not in EXCLUDE]
    missing = [p for p in files if not p.exists()]
    if missing:
        raise BuildError(f"Нет файлов: {missing}")
    wrong = [p for p in files if p.relative_to(ROOT).parts[0] == "web" and p.suffix not in WEB_TYPES]
    if wrong:
        raise BuildError(f"В web/ посторонние типы файлов: {wrong}")
    return files


def payload(path: Path) -> bytes:
    """Текст — с переводами строк LF: на Linux-сервере CRLF ломает sh-скрипты и конфиги."""
    data = path.read_bytes()
    name = path.name
    if path.suffix in TEXT_TYPES or name in {"Dockerfile", "Caddyfile", ".dockerignore", ".env.example"}:
        data = data.replace(b"\r\n", b"\n")
    return data


def main() -> None:
    setup_logging()
    files = collect()
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    out = BUILD_DIR / f"krt-chita-deploy-{datetime.date.today().isoformat()}.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        for path in files:
            rel = path.relative_to(ROOT).as_posix()
            data = payload(path)
            info = tarfile.TarInfo(f"{TOP}/{rel}")
            info.size = len(data)
            info.mode = 0o755 if rel in EXECUTABLE else 0o644
            info.mtime = int(path.stat().st_mtime)
            tar.addfile(info, io.BytesIO(data))
        secrets = tarfile.TarInfo(f"{TOP}/secrets")
        secrets.type, secrets.mode = tarfile.DIRTYPE, 0o700
        tar.addfile(secrets)
    log.info("Архив: %s (%d файлов, %.1f МБ)", out.relative_to(ROOT), len(files), out.stat().st_size / 1e6)


if __name__ == "__main__":
    try:
        main()
    except BuildError as err:
        raise SystemExit(f"Ошибка упаковки: {err}") from None
