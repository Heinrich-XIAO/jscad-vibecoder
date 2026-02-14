#!/bin/bash

echo "Setting up environment variables..."

# Check if .env.local exists
if [ ! -f .env.local ]; then
  echo "Creating .env.local from example..."
  touch .env.local
fi

# Function to prompt for variable if not set
prompt_var() {
  local var_name=$1
  local var_desc=$2
  
  if grep -q "^$var_name=" .env.local; then
    echo "✅ $var_name is already set."
  else
    echo ""
    echo "👉 $var_desc"
    read -p "Enter $var_name: " var_value
    if [ -n "$var_value" ]; then
      echo "$var_name=$var_value" >> .env.local
      echo "Saved $var_name."
    else
      echo "Skipped $var_name."
    fi
  fi
}

# 1. Convex URL
if ! grep -q "NEXT_PUBLIC_CONVEX_URL" .env.local; then
  echo ""
  echo "Checking Convex configuration..."
  # Try to find it in convex.json or ask user to run setup
  echo "You need to configure Convex first."
  read -p "Do you want to run 'npx convex dev --once --configure=new' now? (y/n) " run_convex
  if [ "$run_convex" = "y" ]; then
    npx convex dev --once --configure=new
    # After this, NEXT_PUBLIC_CONVEX_URL should be in .env.local automatically by convex
  else
    prompt_var "NEXT_PUBLIC_CONVEX_URL" "Enter your Convex Deployment URL (e.g. https://...convex.cloud)"
  fi
else
  echo "✅ NEXT_PUBLIC_CONVEX_URL is set."
fi

# 2. OpenRouter API Key
prompt_var "OPENROUTER_API_KEY" "Enter your OpenRouter API Key (sk-or-...)"

echo ""
echo "Environment setup complete! 🎉"
echo "Run 'bun run dev' to start the app."
