#!/bin/bash

set -euo pipefail

bun run build

if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "Skipping Convex deploy (VERCEL_ENV=${VERCEL_ENV:-unset})."
  exit 0
fi

if [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
  echo "CONVEX_DEPLOY_KEY is required for production Convex deploys." >&2
  exit 1
fi

echo "Production build detected, deploying Convex..."
npx convex deploy
