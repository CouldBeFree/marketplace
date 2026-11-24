#!/usr/bin/env bash
# demo:rollout ⭐ — викочування нової ревізії під навантаженням не дає жодної невдалої відповіді.
# Друкує: profile, requests, ok, failed, rollout-seconds. Має бути failed=0 при requests≥5000.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NS="${NS:-hw28}"
DEP="${DEP:-zero-downtime}"
URL="${URL:-http://localhost:30080/}"

CODES="$(mktemp)"
trap 'rm -f "$CODES"' EXIT

# Генератор навантаження у фоні (пише код кожної відповіді у файл; працює до SIGTERM).
node "$ROOT/scripts/loadgen.mjs" "$URL" 20 "$CODES" &
LG=$!
sleep 1 # дати навантаженню розігнатись ДО початку викочування

START=$(date +%s)
# Тригеримо викочування зміною pod-шаблону (rollout restart додає анотацію restartedAt у шаблон).
kubectl -n "$NS" rollout restart deploy/"$DEP" >/dev/null 2>&1
kubectl -n "$NS" rollout status deploy/"$DEP" --timeout=240s >/dev/null 2>&1
ROLL=$(( $(date +%s) - START ))

sleep 2 # зловити хвіст запитів після завершення викочування
kill -TERM "$LG" 2>/dev/null
wait "$LG" 2>/dev/null

REQ=$(grep -c . "$CODES")
OK=$(grep -cx '200' "$CODES")
FAIL=$(( REQ - OK ))

echo "profile=zero-downtime"
echo "requests=$REQ"
echo "ok=$OK"
echo "failed=$FAIL"
echo "rollout-seconds=$ROLL"

[ "$FAIL" -eq 0 ] && [ "$REQ" -ge 5000 ]
