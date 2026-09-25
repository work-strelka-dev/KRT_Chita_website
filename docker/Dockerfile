# Сайт КРТ Читы: статика web/ + nginx. Данные собираются заранее на машине аналитика
# (tools/build_*.py), в образ попадает только web/ — без Excel, GPKG, PDF и секретов.
# Сборка: docker compose build  (из корня проекта; контекст — корень, см. .dockerignore)

FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24

LABEL org.opencontainers.image.title="krt-chita" \
      org.opencontainers.image.description="Сайт КРТ Читы: формирование площадки и скоринговая модель"

# Конфиг nginx: общие части из deploy/nginx/, сервер контейнера — docker/default.conf
COPY deploy/nginx/ /etc/nginx/krt/
COPY docker/default.conf /etc/nginx/conf.d/default.conf
# При старте: доступ по паролю и конфиг подложки из переменных окружения
COPY --chmod=0755 docker/40-krt-runtime.sh /docker-entrypoint.d/40-krt-runtime.sh

COPY web/ /usr/share/nginx/html/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
