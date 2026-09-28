#!/usr/bin/env bash
# restore-drill.sh — доводить, що бекап справді відновлюється.
#
# Бере ОСТАННІЙ дамп → піднімає ЧИСТИЙ ефемерний Postgres-контейнер (порожній volume,
# окремий порт) → pg_restore --no-owner → порівнює контрольну суму ключової таблиці
# ДО (джерело) і ПІСЛЯ (відновлене) → друкує MATCH або падає з ненульовим кодом.
# Контейнер створюється і прибирається самим скриптом (trap), тож запуск повторюваний.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL не задано (через обгортку зі сховища або export у ## Grading)}"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
DRILL_PORT="${DRILL_PORT:-6544}"
DRILL_NAME="marketplace-restore-drill"
DRILL_PW="drillpw"

# контрольна сума: count + агрегат по ключовій таблиці orders (одна команда)
CHECKSUM_SQL="SELECT count(*) || '|' || COALESCE(sum(total_cents), 0) FROM orders"

# ── останній дамп ──
DUMP="$(ls -1t "$BACKUP_DIR"/marketplace-*.dump 2>/dev/null | head -1 || true)"
[ -n "$DUMP" ] || { echo "restore-drill: немає дампів у $BACKUP_DIR — спершу scripts/backup.sh" >&2; exit 1; }
echo "drill: дамп        = $DUMP ($(du -h "$DUMP" | cut -f1))"

# ── контрольна сума ДО (джерело, через DATABASE_URL) ──
SRC="$(psql "$DATABASE_URL" -Atc "$CHECKSUM_SQL")"
echo "drill: checksum ДО = $SRC"

# ── свіжий ефемерний контейнер (гарантовано порожній) ──
cleanup() { docker rm -f "$DRILL_NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup   # прибрати рештки попереднього запуску, якщо були

# RTO рахуємо як ПОВНИЙ цикл відновлення: підняти чистий Postgres → restore → дані готові
RECOVER_START=$(date +%s%3N)
docker run -d --rm --name "$DRILL_NAME" \
  -e POSTGRES_PASSWORD="$DRILL_PW" \
  -p "127.0.0.1:$DRILL_PORT:5432" postgres:16 >/dev/null

# чекаємо, поки чистий Postgres почне приймати з'єднання
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p "$DRILL_PORT" -U postgres >/dev/null 2>&1 && break
  sleep 1
done

BASE_URL="postgres://postgres:$DRILL_PW@127.0.0.1:$DRILL_PORT"
psql "$BASE_URL/postgres" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE marketplace" >/dev/null

# ── відновлення (--no-owner/--no-acl: не падати на ролі marketplace, якої тут нема) ──
RESTORE_START=$(date +%s%3N)
if ! pg_restore --no-owner --no-acl --dbname="$BASE_URL/marketplace" "$DUMP"; then
  echo "drill: (pg_restore дав ненульовий код — вирок винесе контрольна сума)" >&2
fi
RESTORE_MS=$(( $(date +%s%3N) - RESTORE_START ))

# ── контрольна сума ПІСЛЯ (відновлене) ──
DST="$(psql "$BASE_URL/marketplace" -Atc "$CHECKSUM_SQL")"
RTO_MS=$(( $(date +%s%3N) - RECOVER_START ))
echo "drill: checksum ПІСЛЯ = $DST"
echo "drill: RTO (повний цикл відновлення) = ${RTO_MS} мс (з них pg_restore ${RESTORE_MS} мс)"

if [ "$SRC" = "$DST" ]; then
  echo "MATCH"
  exit 0
fi
echo "MISMATCH: джерело=$SRC відновлене=$DST" >&2
exit 1
