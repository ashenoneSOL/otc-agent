#!/bin/bash
# Development server - starts everything needed for local dev
set -e

cd "$(dirname "$0")/.."

# Port configuration (uses Jeju network standard port for OTC desk)
OTC_PORT="${VENDOR_OTC_DESK_PORT:-${OTC_PORT:-5005}}"

echo "Starting OTC Trading Desk development environment on port $OTC_PORT..."

# Ensure dependencies
./scripts/ensure-postgres.sh
./scripts/ensure-deployments.sh

# Cleanup old processes
lsof -t -i:$OTC_PORT | xargs kill -9 2>/dev/null || true

# Check network mode
NETWORK="${NEXT_PUBLIC_NETWORK:-${NETWORK:-local}}"
USE_LOCAL_CHAINS=true

if [ "$NETWORK" = "mainnet" ] || [ "$NETWORK" = "testnet" ]; then
    echo "Using $NETWORK networks - skipping local validators"
    USE_LOCAL_CHAINS=false
fi

# Start services based on network mode
if [ "$USE_LOCAL_CHAINS" = true ]; then
    echo "Starting local development with Anvil..."
    concurrently --kill-others-on-fail \
        --names "anvil,prices,next,seed" \
        "./scripts/start-rpc.sh" \
        "sleep 15 && ./scripts/keep-prices-fresh.sh" \
        "sleep 8 && next dev -p $OTC_PORT" \
        "sleep 20 && bun run seed && tail -f /dev/null"
else
    echo "Connecting to $NETWORK networks (Base, BSC, Jeju)..."
    concurrently --kill-others-on-fail \
        --names "prices,next,seed" \
        "sleep 5 && ./scripts/keep-prices-fresh.sh" \
        "next dev -p $OTC_PORT" \
        "sleep 15 && bun run seed && tail -f /dev/null"
fi

