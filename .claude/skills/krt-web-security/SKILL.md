---
name: krt-web-security
description: Чек-лист безопасности для статического сайта КРТ Читы. Использовать при написании или ревью кода, который работает с DOM, URL-параметрами, загрузкой JSON, картинками, а также при настройке nginx и выкладке.
---

# Безопасность сайта КРТ

Модель угроз: статический сайт с конфиденциальными данными 80 площадок.
Бэкенда нет. Главные риски: утечка данных наружу, XSS через данные или URL,
подмена скриптов со сторонних доменов, индексация поисковиками.

## Код (web/js)

- Вывод текста только через `textContent`, `setAttribute`, `createElement`.
  **Запрещено:** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `eval`, `new Function`, `setTimeout("строка")`.
- Любые значения из URL (`?a=`, `?s=`) проверяются по белому списку ID из `sites.json`.
  Неизвестные значения молча отбрасываются. Длина списка ≤ 4.
- `fetch` только относительных путей своего сайта. Проверять `response.ok`
  и структуру JSON до использования (обязательные поля, типы, числа конечны).
- Никаких inline-обработчиков (`onclick="…"`) и inline-`<script>`/`<style>`:
  это ломает CSP. Стили только из `.css`, обработчики через `addEventListener`.
- Никаких сторонних скриптов, шрифтов, CDN, аналитики. Всё лежит в `web/`.
- Единственное исключение — тайлы подложки на `scoring.html` (Mapbox, OpenStreetMap):
  разрешены только в `img-src` этой страницы; Referrer там `strict-origin`, токен
  Mapbox только публичный `pk.` из `.env`, в git не попадает (ARCHITECTURE.md, 16.5).
- Сторонние библиотеки — только в `web/vendor/<имя>-<версия>/` с лицензией рядом.
- `localStorage` — только для удобств (последний выбор). Не хранить там ничего
  важного и не доверять прочитанному: проверять как URL.

## Что уходит на сервер

- Только папка `web/`. Проверить перед выкладкой, что в ней нет
  `.xlsx`, `.pdf`, `.py`, `.git`, `.env`, `.map`, служебных файлов.
- Нет комментариев с внутренней информацией, путей к машине разработчика.

## nginx (deploy/nginx/*.conf — общие для сервера и Docker)

```nginx
add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header X-Robots-Tag "noindex, nofollow" always;
server_tokens off;
autoindex off;
```

- Только HTTPS, редирект с HTTP.
- Доступ закрыт: `auth_basic` с bcrypt-паролями или доступ только из VPN/корпоративной сети.
- Разрешены только методы GET и HEAD.
- `robots.txt`: `Disallow: /`.

## Зависимости

- В рантайме зависимостей нет. Если библиотека всё же нужна, она копируется
  в `web/vendor/` с фиксированной версией и указанием источника, не с CDN.
- Python-зависимости сборки фиксируются по точным версиям.

## Docker

- В образ — только `web/`, `docker/`, `deploy/nginx/` (`.dockerignore` — белый список).
- Секреты (`MAPBOX_TOKEN`, `secrets/htpasswd`) — только при запуске, не в образе и не в архиве.
- Контейнер: не root, read-only, `cap_drop: ALL`, `no-new-privileges`, порт на `127.0.0.1`.
- Без файла паролей контейнер не стартует; открытый режим — только `KRT_PUBLIC=1`.
- Базовые образы — с точной версией (`nginx-unprivileged:1.30.5-alpine3.24`, `caddy:2.11.4-alpine`).

## Проверка перед выкладкой

1. `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function" web/js` → пусто.
2. `find web -type f` — только html, css, js, json, webp, otf, svg (только из style/, проверенный: без script и ссылок), txt.
3. `curl -sI https://<хост>/` — все заголовки выше на месте, без авторизации 401.
4. Консоль браузера — ни одного нарушения CSP.
5. Запустить встроенный `/security-review`.
