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

if [ "${FORCE_CONVEX_DEPLOY:-0}" = "1" ]; then
  echo "FORCE_CONVEX_DEPLOY=1, deploying Convex."
elif [ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] && [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ]; then
  if changed_files="$(git diff --name-only "$VERCEL_GIT_PREVIOUS_SHA" "$VERCEL_GIT_COMMIT_SHA" 2>/dev/null)"; then
    should_deploy_convex=0
    while IFS= read -r file; do
      case "$file" in
        convex/*|package.json|package-lock.json|bun.lock|tsconfig.json)
          should_deploy_convex=1
          break
          ;;
      esac
    done <<<"$changed_files"

    if [ "$should_deploy_convex" -eq 0 ]; then
      echo "No Convex-related files changed, skipping Convex deploy."
      exit 0
    fi
  else
    echo "Could not diff commits, deploying Convex to be safe."
  fi
fi

echo "Production build detected, deploying Convex..."
npx convex deploy --typecheck disable --codegen disable
