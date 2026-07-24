#!/bin/sh
set -eu

# Run from anywhere; build context is always the repo root (packages/*).
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-antirek/wosobo:0.0.2}"
PUSH="${PUSH:-1}"

echo "building ${IMAGE} (context: ${ROOT})..."
docker build -f "${ROOT}/prod_deploy/Dockerfile" -t "${IMAGE}" "${ROOT}"

if [ "${PUSH}" = "1" ]; then
  echo "pushing ${IMAGE}..."
  docker push "${IMAGE}"
else
  echo "skip push (PUSH=0)"
fi
