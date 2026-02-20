#!/bin/bash

set -euo pipefail

if [ "$#" -eq 0 ]; then
  VERCEL_ARGS=(--prod)
else
  VERCEL_ARGS=("$@")
fi

IS_PROD_DEPLOY=false
for arg in "${VERCEL_ARGS[@]}"; do
  if [ "$arg" = "--prod" ]; then
    IS_PROD_DEPLOY=true
    break
  fi
done

# Check if .env.local exists
if [ ! -f .env.local ]; then
  echo "Creating .env.local..."
  touch .env.local
fi

# Check if Convex is configured
if ! grep -q "NEXT_PUBLIC_CONVEX_URL" .env.local; then
  echo "Convex not configured. Running setup..."
  echo "Please follow the prompts to log in and configure your project."
  npx convex dev --once --configure=new
else
  echo "Convex is configured."
fi

# Deploy Vercel
echo "Deploying frontend to Vercel..."
npx vercel "${VERCEL_ARGS[@]}"

if [ "$IS_PROD_DEPLOY" = true ]; then
  # Deploy Convex only after successful production deploys
  echo "Deploying Convex backend..."
  npx convex deploy
else
  echo "Skipping Convex deploy (Vercel deploy is not production)."
fi

echo "Deployment complete!"
