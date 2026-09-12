#!/usr/bin/env bash
# with-secrets.sh — виконати команду «зі сховища».
#
# Наповнює оточення значеннями з нашого сховища ДЗ #11 (gitignored .env +
# secrets/db_password) і запускає передану команду. Це наш ФАЙЛОВИЙ аналог
# `infisical run --env=<slug> -- <cmd>`: основний, «прод-шейпнутий» шлях —
# креденшели приходять зі сховища, а не зашиті в код.
#
# Використання:
#   bash scripts/with-secrets.sh <env-slug> <команда...>
# Приклад:
#   bash scripts/with-secrets.sh dev npx typeorm migration:run -d dist/data-source.js
#
# Грейдер сховища не має → запускає з SKIP_VAULT=1 і власним export DB_URL=…
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

# ── шлях «зі сховища» (наше файлове сховище ДЗ #11) ──────────────────────────
: "${ENV_SLUG:?}"                      # slug лишається частиною контракту виклику
ENV_FILE="$ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "with-secrets: сховища не знайдено ($ENV_FILE)." >&2
  echo "  Для грейдера: export SKIP_VAULT=1 і export DB_URL=… (див. ## Grading у README)." >&2
  exit 1
fi

# .env тримає DB_URL БЕЗ пароля + шлях до файла-пароля (контракт ДЗ #11)
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

PW_FILE="${DB_PASSWORD_FILE:-secrets/db_password}"
case "$PW_FILE" in
  /*) : ;;                             # абсолютний шлях — як є
  *)  PW_FILE="$ROOT/$PW_FILE" ;;      # відносний — від кореня репо
esac
if [ ! -f "$PW_FILE" ]; then
  echo "with-secrets: файла-пароля не знайдено ($PW_FILE)." >&2
  exit 1
fi
DB_PW="$(tr -d '\r\n' < "$PW_FILE")"

# складаємо повний DB_URL: host/port/user/db — з .env, пароль — з файла-секрета
export DB_URL="$(DB_URL="${DB_URL:?DB_URL відсутній у .env}" DB_PW="$DB_PW" node -e '
  const u = new URL(process.env.DB_URL);
  u.password = process.env.DB_PW;
  process.stdout.write(u.toString());
')"

exec "$@"
