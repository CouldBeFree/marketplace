#!/usr/bin/env bash
# restore-drill.sh — доводить, що бекап справді відновлюється.
#
# Бере ОСТАННІЙ дамп → піднімає ЧИСТИЙ ефемерний Postgres-контейнер (порожній volume,
# власне унікальне ім'я + динамічний порт) → pg_restore --no-owner → порівнює контрольну
# суму ДО (джерело) і ПІСЛЯ (відновлене) → друкує MATCH або падає з ненульовим кодом.
# Контейнер створюється і прибирається самим скриптом (trap), тож запуск повторюваний
# і БЕЗПЕЧНИЙ для паралельних прогонів (кожен має свій контейнер і порт).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL не задано (через обгортку зі сховища або export у ## Grading)}"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
DRILL_PW="drillpw"
# унікальне ім'я на кожен прогін → паралельні drill-и не чіпають контейнери одне одного
DRILL_NAME="marketplace-restore-drill-$$-${RANDOM}"

# Контрольна сума — count по ВСІХ доменних таблицях (+ агрегат по orders). Якщо restore
# втратить рядки будь-де (напр. products), count розійдеться й буде MISMATCH, а не хибний
# MATCH лише тому, що orders збіглись.
CHECKSUM_SQL="SELECT
  (SELECT count(*) FROM users)       || '|' ||
  (SELECT count(*) FROM products)    || '|' ||
  (SELECT count(*) FROM orders)      || '|' ||
  (SELECT count(*) FROM order_items) || '|' ||
  (SELECT count(*) FROM tasks)       || '|' ||
  COALESCE((SELECT sum(total_cents) FROM orders), 0)"

# мс-таймстемп, переносимо: GNU date дає %N (мілісекунди), BSD/macOS — ні (тоді секунди×1000).
# Повертає ЗАВЖДИ число, тож арифметика нижче не впаде й RTO_MS завжди визначений.
now_ms() {
  local t
  t="$(date +%s%3N 2>/dev/null || true)"
  case "$t" in
    ''|*[!0-9]*) echo $(( $(date +%s) * 1000 )) ;;   # %N не підтримується
    *)           echo "$t" ;;
  esac
}

# ── останній дамп ──
DUMP="$(ls -1t "$BACKUP_DIR"/marketplace-*.dump 2>/dev/null | head -1 || true)"
[ -n "$DUMP" ] || { echo "restore-drill: немає дампів у $BACKUP_DIR — спершу scripts/backup.sh" >&2; exit 1; }
echo "drill: дамп        = $DUMP ($(du -h "$DUMP" | cut -f1))"

# ── контрольна сума ДО (джерело, через DATABASE_URL) ──
SRC="$(psql "$DATABASE_URL" -Atc "$CHECKSUM_SQL")"
echo "drill: checksum ДО = $SRC"

# ── свіжий ефемерний контейнер (гарантовано порожній; прибирає ЛИШЕ свій) ──
cleanup() { docker rm -f "$DRILL_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# RTO = ПОВНИЙ цикл відновлення: підняти чистий Postgres → restore → дані готові.
RECOVER_START="$(now_ms)"
# динамічний порт (127.0.0.1::5432) → хост сам обирає вільний, паралельні drill-и не конфліктують
docker run -d --rm --name "$DRILL_NAME" \
  -e POSTGRES_PASSWORD="$DRILL_PW" \
  -p 127.0.0.1::5432 postgres:16 >/dev/null
HOST_PORT="$(docker port "$DRILL_NAME" 5432/tcp | head -1 | sed 's/.*://')"
[ -n "$HOST_PORT" ] || { echo "restore-drill: не вдалось визначити порт контейнера" >&2; exit 1; }
echo "drill: контейнер   = $DRILL_NAME (порт $HOST_PORT)"

# чекаємо, поки чистий Postgres почне приймати з'єднання
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p "$HOST_PORT" -U postgres >/dev/null 2>&1 && break
  sleep 1
done

BASE_URL="postgres://postgres:$DRILL_PW@127.0.0.1:$HOST_PORT"
psql "$BASE_URL/postgres" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE marketplace" >/dev/null

# ── відновлення (--no-owner/--no-acl: не падати на ролі marketplace, якої тут нема) ──
RESTORE_START="$(now_ms)"
if ! pg_restore --no-owner --no-acl --dbname="$BASE_URL/marketplace" "$DUMP"; then
  echo "drill: (pg_restore дав ненульовий код — вирок винесе контрольна сума по всіх таблицях)" >&2
fi
RESTORE_MS=$(( $(now_ms) - RESTORE_START ))

# ── контрольна сума ПІСЛЯ (відновлене) ──
DST="$(psql "$BASE_URL/marketplace" -Atc "$CHECKSUM_SQL")"
RTO_MS=$(( $(now_ms) - RECOVER_START ))
echo "drill: checksum ПІСЛЯ = $DST"
echo "drill: RTO (повний цикл відновлення) = ${RTO_MS} мс (з них pg_restore ${RESTORE_MS} мс)"

if [ "$SRC" = "$DST" ]; then
  echo "MATCH"
  exit 0
fi
echo "MISMATCH: джерело=$SRC відновлене=$DST" >&2
exit 1
