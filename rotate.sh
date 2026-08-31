#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

DB_SERVICE="db"
DB_USER="marketplace"
DB_NAME="marketplace"
SECRET_FILE="secrets/db_password"

NEW_PW="rotated_$(date +%Y%m%d%H%M%S)_${RANDOM}"

echo "→ Ротація пароля ролі '${DB_USER}'…"

docker compose exec -T "$DB_SERVICE" \
  psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" \
  -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${NEW_PW}';"

printf '%s' "$NEW_PW" > "$SECRET_FILE"
echo "→ Файл-секрет оновлено: ${SECRET_FILE}"

docker compose exec -T "$DB_SERVICE" \
  psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE usename = '${DB_USER}' AND pid <> pg_backend_pid();"

echo "✓ Готово. Процес не рестартував; наступний запит у БД піде з новим паролем."
