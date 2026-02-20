#!/bin/bash

set -euo pipefail

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
npx vercel --prod

# Deploy Convex after Vercel finishes
echo "Deploying Convex backend..."
npx convex deploy

echo "Deployment complete!"
