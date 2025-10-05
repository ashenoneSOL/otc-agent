#!/bin/bash
set -euo pipefail

echo "[playwright] Cleaning previous processes..."
pkill -f "hardhat node" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
lsof -t -i:2222 | xargs kill -9 2>/dev/null || true
sleep 2

ROOT="/Users/shawwalters/eliza-nextjs-starter"
cd "$ROOT"

echo "[playwright] Starting Hardhat node..."
(cd contracts && npx hardhat node > ../hardhat.log 2>&1 & echo $! > ../.hardhat.pid)
sleep 3

echo "[playwright] Waiting for Hardhat RPC..."
for i in {1..30}; do
  if curl -s -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[playwright] Deploying contracts..."
(cd contracts && npx hardhat run scripts/deploy-eliza-otc.ts --network localhost >> ../deploy.log 2>&1 || true)

echo "[playwright] Building Next.js (production)..."
NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production next build > next-build.log 2>&1 || true

echo "[playwright] Starting Next.js (production)..."
(NODE_ENV=production next start -p 2222 > nextjs.log 2>&1 & echo $! > .nextjs.pid)

echo "[playwright] Waiting for Next.js to be ready..."
for i in {1..120}; do
  if curl -s http://localhost:2222 >/dev/null 2>&1; then
    echo "[playwright] Next.js is ready"
    break
  fi
  sleep 1
done

NEXT_PID=$(cat .nextjs.pid)
echo "[playwright] Holding on Next.js PID ${NEXT_PID}"
wait "$NEXT_PID"

