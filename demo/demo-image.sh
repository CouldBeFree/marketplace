#!/usr/bin/env bash
# demo:image — production-grade образ + секрет етапу збірки не осів у ЖОДНОМУ з трьох каналів.
# Друкує: stages, shell-inside, runtime-uid, token-in-history, token-in-config, token-in-layers.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-hw28-app:demo}"
TOKEN_FILE="${TOKEN_FILE:-.npm_token}"

# Декой-токен (у git його немає). Саме цей рядок шукаємо в history/config/layers.
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  TOKEN="decoy-$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf '%s' "$TOKEN" > "$TOKEN_FILE"
fi

# Збірка з BuildKit-секретом.
DOCKER_BUILDKIT=1 docker build -f docker/Dockerfile --secret id=npmtoken,src="$TOKEN_FILE" -t "$IMAGE" app >/dev/null 2>&1 \
  || { echo "demo:image FAILED: docker build" >&2; exit 1; }

# stages: кількість FROM у Dockerfile.
STAGES=$(grep -cE '^[[:space:]]*FROM ' docker/Dockerfile)

# shell-inside: ЗАПУСКОМ docker run --entrypoint sh (а не читанням Dockerfile) — у distroless
# shell немає, run провалиться → 0.
if docker run --rm --entrypoint sh "$IMAGE" -c 'echo hi' >/dev/null 2>&1; then SHELL_INSIDE=1; else SHELL_INSIDE=0; fi

# runtime-uid: з конфігу образу, ЧИСЛОМ (distroless без shell — id усередині не запустиш).
RUID=$(docker image inspect --format '{{.Config.User}}' "$IMAGE" 2>/dev/null)
RUID="${RUID%%:*}"
[ -z "$RUID" ] && RUID=0

# token-in-history (ARG осів би тут).
HIST=$(docker history --no-trunc "$IMAGE" 2>/dev/null | grep -cF -- "$TOKEN")
# token-in-config (ENV/метадані).
CONF=$(docker image inspect "$IMAGE" 2>/dev/null | grep -cF -- "$TOKEN")

# token-in-layers: docker save + розпакування + пошук ПО БАЙТАХ. Шари можуть бути gzip, тож кожен
# блоб розпаковуємо (COPY+rm лишив би токен у ПОПЕРЕДНЬОМУ шарі під whiteout — у ФС не видно, а
# в байтах шару лежить).
TMP="$(mktemp -d)"
docker save "$IMAGE" -o "$TMP/img.tar" 2>/dev/null
mkdir -p "$TMP/x" && tar -xf "$TMP/img.tar" -C "$TMP/x" 2>/dev/null
LAY=$(
  find "$TMP/x" -type f -print0 2>/dev/null | while IFS= read -r -d '' f; do
    if gzip -t "$f" 2>/dev/null; then zcat "$f" 2>/dev/null; else cat "$f" 2>/dev/null; fi
  done | grep -acF -- "$TOKEN"
)
[ -z "$LAY" ] && LAY=0
rm -rf "$TMP"

echo "stages=$STAGES"
echo "shell-inside=$SHELL_INSIDE"
echo "runtime-uid=$RUID"
echo "token-in-history=$HIST"
echo "token-in-config=$CONF"
echo "token-in-layers=$LAY"

[ "$STAGES" -ge 2 ] && [ "$SHELL_INSIDE" -eq 0 ] && [ "$RUID" != 0 ] && [ -n "$RUID" ] \
  && [ "$HIST" -eq 0 ] && [ "$CONF" -eq 0 ] && [ "$LAY" -eq 0 ]
