#!/usr/bin/env bash
# Піднімає локальний kind-кластер і ВАНТАЖИТЬ у нього образ. Образ, зібраний на хості, у кластері
# не існує — без kind load под повис би в ErrImagePull (imagePullPolicy:IfNotPresent не рятує).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CLUSTER="${CLUSTER:-hw28}"
IMAGE="${IMAGE:-hw28-app:v1}"
kind get clusters 2>/dev/null | grep -qx "$CLUSTER" || kind create cluster --name "$CLUSTER" --config k8s/kind-config.yaml
kind load docker-image "$IMAGE" --name "$CLUSTER"
echo "cluster $CLUSTER up; image $IMAGE loaded"
