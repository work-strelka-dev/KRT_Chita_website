#!/bin/sh
# Выполняется при старте контейнера (docker-entrypoint.d) перед запуском nginx.
# 1. Доступ: без файла паролей контейнер не стартует — данные конфиденциальные.
# 2. Подложка: map-config.json из MAPBOX_TOKEN / MAPBOX_STYLE (токен не хранится в образе).
set -eu

RUNTIME_DIR=/tmp/krt
HTPASSWD_FILE="${KRT_HTPASSWD_FILE:-/run/secrets/htpasswd}"
MAPBOX_STYLE="${MAPBOX_STYLE:-okamidan/cmqupgwnh000b01s41y4r8ams}"
mkdir -p "$RUNTIME_DIR"

if [ -s "$HTPASSWD_FILE" ]; then
  printf 'auth_basic "KRT Chita";\nauth_basic_user_file %s;\n' "$HTPASSWD_FILE" > "$RUNTIME_DIR/auth.conf"
  echo "krt: доступ по паролю ($HTPASSWD_FILE)"
elif [ "${KRT_PUBLIC:-0}" = "1" ]; then
  : > "$RUNTIME_DIR/auth.conf"
  echo "krt: ВНИМАНИЕ, сайт открыт без пароля (KRT_PUBLIC=1)"
else
  echo "krt: нет файла паролей $HTPASSWD_FILE. Создайте его (см. docs/DEPLOY.md)" >&2
  echo "krt: или явно откройте сайт без пароля: KRT_PUBLIC=1" >&2
  exit 1
fi

token="${MAPBOX_TOKEN:-}"
if [ -n "$token" ] && ! printf '%s' "$token" | grep -Eq '^pk\.[A-Za-z0-9._-]+$'; then
  echo "krt: MAPBOX_TOKEN должен быть публичным токеном pk.… (секретный sk.… в браузер не отдаём)" >&2
  exit 1
fi
if ! printf '%s' "$MAPBOX_STYLE" | grep -Eq '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$'; then
  echo "krt: MAPBOX_STYLE ожидается в виде пользователь/стиль" >&2
  exit 1
fi
if [ -n "$token" ]; then
  printf '{"mapboxTilesUrl":"https://api.mapbox.com/styles/v1/%s/tiles/256/{z}/{x}/{y}?access_token=%s"}\n' \
    "$MAPBOX_STYLE" "$token" > "$RUNTIME_DIR/map-config.json"
  echo "krt: подложка Mapbox включена ($MAPBOX_STYLE)"
else
  printf '{"mapboxTilesUrl":null}\n' > "$RUNTIME_DIR/map-config.json"
  echo "krt: MAPBOX_TOKEN не задан — на карте только OpenStreetMap"
fi
