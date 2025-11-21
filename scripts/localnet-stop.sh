#!/bin/bash

echo "🛑 Stopping Anvil services for OTC Agent"
echo ""

# Stop Docker services
if [ -f "docker-compose.localnet.yml" ]; then
  echo "🐳 Stopping Docker services..."
  docker compose -f docker-compose.localnet.yml down
  echo "✅ Docker services stopped"
else
  echo "⚠️  docker-compose.localnet.yml not found, skipping Docker cleanup"
fi

# Stop Anvil node
echo ""
echo "🔧 Stopping Anvil node..."
cd ../..
if [ -f "scripts/localnet/stop.ts" ]; then
  bun run scripts/localnet/stop.ts
  echo "✅ Anvil node stopped"
else
  echo "⚠️  Anvil stop script not found"
  echo "💡 You may need to manually stop the Anvil node process"
fi
cd vendor/otc-desk

echo ""
echo "✅ Localnet stopped"
echo ""
