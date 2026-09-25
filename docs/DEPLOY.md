# Развёртывание сайта КРТ Читы на сервере

Сайт — статические страницы и данные, отдаваемые nginx из Docker-контейнера.
Бэкенда и базы данных нет. Контейнер не настраивает доступ: ограничение по
паролю, VPN или IP-адресам задаётся на внешнем nginx.

## Что нужно на сервере

- Linux с Docker Engine 24+ и плагином `docker compose` (v2).
- Для HTTPS «из коробки» — домен, указывающий на сервер, и открытые порты 80 и 443.
  Если на сервере уже есть свой обратный прокси (nginx, Traefik), HTTPS
  настраивается в нём, а порты 80/443 не нужны.
- Около 100 МБ на диске.

## 1. Загрузить архив

Архив `krt-chita-deploy-<дата>.tar.gz` собирает аналитик
(`tools/make_bundle.py`). Docker для этого на его компьютере не нужен.

```bash
scp krt-chita-deploy-*.tar.gz user@server:/opt/
ssh user@server
cd /opt && tar -xzf krt-chita-deploy-*.tar.gz && cd krt-chita
```

## 2. Настроить `.env`

```bash
cp .env.example .env
nano .env
```

| Переменная | Что указать |
|---|---|
| `MAPBOX_TOKEN` | Публичный токен Mapbox `pk.…` с ограничением по домену сайта. Пусто — на карте скоринга будет только OpenStreetMap |
| `MAPBOX_STYLE` | Стиль подложки `пользователь/стиль` (стиль должен быть доступен этому токену) |
| `KRT_DOMAIN` | Домен сайта, например `krt.example.ru` (только для варианта А) |
| `KRT_PORT` | Порт на `127.0.0.1` для своего прокси (вариант Б), по умолчанию 8080 |

## 3. Запустить

**Вариант А — HTTPS силами контейнера (Caddy + Let's Encrypt):**

```bash
docker compose --profile https up -d --build
```

Через минуту сайт доступен по `https://<KRT_DOMAIN>/`, сертификат
выпускается и продлевается автоматически.

**Вариант Б — за уже существующим прокси:**

```bash
docker compose up -d --build
```

Сайт слушает `http://127.0.0.1:8080` (только локально). В прокси:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
}
```

Заголовки безопасности (CSP, HSTS, noindex и др.) выставляет сам контейнер,
в прокси их дублировать не нужно.

## 4. Проверить

```bash
docker compose ps                                  # web: healthy
curl -s  http://127.0.0.1:8080/healthz             # ok
curl -sI http://127.0.0.1:8080/ | head -1          # 200
curl -sI http://127.0.0.1:8080/scoring.html | grep -i content-security
```

В браузере: главная, «Формирование площадки», «Скоринговая модель» — в
консоли разработчика не должно быть ошибок CSP.

## Обновление

Аналитик присылает новый архив:

```bash
cd /opt && tar -xzf krt-chita-deploy-<новая-дата>.tar.gz   # .env сохраняется
cd krt-chita && docker compose up -d --build               # или с --profile https
```

## Устройство

| Компонент | Где |
|---|---|
| Образ | `docker/Dockerfile`: `nginxinc/nginx-unprivileged:1.30.5-alpine3.24`, внутри только `web/` и конфиг nginx |
| Конфиг nginx | `deploy/nginx/*.conf` (общий с установкой без Docker) + `docker/default.conf` |
| Старт контейнера | `docker/40-krt-runtime.sh`: создаёт конфиг подложки из `MAPBOX_TOKEN` |
| HTTPS | `docker/Caddyfile` (профиль `https`) |
| Безопасность контейнера | не root, файловая система только для чтения, без Linux capabilities, `no-new-privileges` |

Токен Mapbox в образ не попадает: он передаётся при запуске.
