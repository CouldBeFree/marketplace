#!/usr/bin/env bash
# Обгортка pulumi: ЛОКАЛЬНИЙ ФАЙЛОВИЙ бекенд (обов'язково — інакше pulumi проситиме login у твій
# акаунт і грейдер не пройде далі). Вибирає/ініціалізує стек dev і виконує команду (up/destroy/preview).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
cd "$ROOT/infra"
pulumi stack select dev 2>/dev/null || pulumi stack init dev
case "${1:-up}" in
  up) pulumi up --yes --skip-preview ;;
  destroy) pulumi destroy --yes --skip-preview ;;
  preview) shift; pulumi preview --non-interactive "$@" ;;
  *) pulumi "$@" ;;
esac
