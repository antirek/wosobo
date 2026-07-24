#!/bin/sh
# Build (and optionally push) the wosobo application image.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-antirek/wosobo:0.0.4}"
PUSH="${PUSH:-1}"

echo "building ${IMAGE} (context: ${ROOT})..."
docker build -f "${ROOT}/build/Dockerfile" -t "${IMAGE}" "${ROOT}"

if [ "${PUSH}" = "1" ]; then
  echo "pushing ${IMAGE}..."
  docker push "${IMAGE}"
else
  echo "skip push (PUSH=0)"
fi
