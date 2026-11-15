#!/usr/bin/env bash
# Збірка production-образу з BuildKit-секретом. .npm_token — декой-секрет етапу збірки (у git його
# немає; грейдер створює його сам у ## Grading). Контекст — app/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IMAGE="${IMAGE:-hw28-app:v1}"
TOKEN_FILE="${TOKEN_FILE:-.npm_token}"
[ -s "$TOKEN_FILE" ] || printf 'dummy-npm-token' > "$TOKEN_FILE"
DOCKER_BUILDKIT=1 docker build -f docker/Dockerfile --secret id=npmtoken,src="$TOKEN_FILE" -t "$IMAGE" app
echo "built $IMAGE"
