#!/usr/bin/env bash
# backup.sh — pg_dump -Fc бази курсового у ДАТОВАНИЙ файл (локальна тека поза контейнером).
#
# Підключення береться з $DATABASE_URL: його наповнює scripts/with-secrets.sh зі сховища
# ДЗ #11 (bash scripts/with-secrets.sh dev bash scripts/backup.sh), або грейдер під
# SKIP_VAULT=1 через export DATABASE_URL=… (див. ## Grading у README).
#
# Голий запуск без креденшелів падає нижче з `DATABASE_URL: unbound variable`, exit 1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# без рядка підключення нема що бекапити — зупиняємось із зрозумілою помилкою
: "${DATABASE_URL:?DATABASE_URL не задано (через обгортку зі сховища або export у ## Grading)}"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/marketplace-$STAMP.dump"

# -Fc = custom-формат: стиснутий і придатний для `pg_restore --list` / вибіркового відновлення
pg_dump -Fc --dbname="$DATABASE_URL" --file="$OUT"

echo "backup OK: $OUT"
echo "  розмір: $(du -h "$OUT" | cut -f1)"
