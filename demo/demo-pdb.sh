#!/usr/bin/env bash
# demo:pdb — PDB лишає місце для обслуговування і зупиняє ДРУГЕ виселення.
# Друкує: healthy, minAvailable, evict-1, evict-2. Має бути evict-1=201, evict-2=429.
# ⚠️ Бюджет витрачається: після демо disruptionsAllowed=0 навіть на правильному PDB.
set -uo pipefail
NS="${NS:-hw28}"
DEP="${DEP:-zero-downtime}"
PDB="${PDB:-zero-downtime}"

HEALTHY=$(kubectl -n "$NS" get deploy "$DEP" -o jsonpath='{.status.readyReplicas}' 2>/dev/null)
[ -z "$HEALTHY" ] && HEALTHY=0
MINAVAIL=$(kubectl -n "$NS" get pdb "$PDB" -o jsonpath='{.spec.minAvailable}' 2>/dev/null)
[ -z "$MINAVAIL" ] && MINAVAIL=0

# Два поди на виселення.
read -r -a PODS <<< "$(kubectl -n "$NS" get pods -l app="$DEP" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)"

# Виселення через Eviction API (саме його, а не kubectl delete, стримує PDB). kubectl create --raw
# БЕЗ -o (у 1.33 -o і --raw взаємно виключні). 201 → успіх; 429/TooManyRequests → бюджет вичерпано.
evict_code() {
  local pod="$1"
  local body="{\"apiVersion\":\"policy/v1\",\"kind\":\"Eviction\",\"metadata\":{\"name\":\"$pod\",\"namespace\":\"$NS\"}}"
  local out rc
  out=$(printf '%s' "$body" | kubectl create --raw "/api/v1/namespaces/$NS/pods/$pod/eviction" -f - 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    echo 201
  elif printf '%s' "$out" | grep -qiE 'TooManyRequests|429|disruption budget|Cannot evict'; then
    echo 429
  else
    echo "000"
  fi
}

E1=$(evict_code "${PODS[0]:-none}")
E2=$(evict_code "${PODS[1]:-none}") # одразу за першим — заміна ще не готова, бюджет=0 → 429

echo "healthy=$HEALTHY"
echo "minAvailable=$MINAVAIL"
echo "evict-1=$E1"
echo "evict-2=$E2"

[ "$E1" = "201" ] && [ "$E2" = "429" ]
