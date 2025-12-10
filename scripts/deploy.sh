#!/bin/bash
# Deploy OTC contracts to all supported testnets or mainnets
# Supports: Base, BSC, Solana, Jeju
set -e

cd "$(dirname "$0")/.."

ENV="${1:-testnet}"
CHAIN="${2:-all}"  # all, base, bsc, solana, jeju

if [ "$ENV" != "testnet" ] && [ "$ENV" != "mainnet" ]; then
    echo "Usage: ./scripts/deploy.sh [testnet|mainnet] [all|base|bsc|solana|jeju]"
    exit 1
fi

echo "Deploying to $ENV (chains: $CHAIN)..."

# Load env vars
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs 2>/dev/null || true)
fi

# Check if Jeju contracts package is available
JEJU_CONTRACTS="../../packages/contracts"

deploy_base() {
    if [ "$ENV" = "testnet" ]; then
        echo "Deploying EVM contracts to Base Sepolia..."
        RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
    else
        echo "Deploying EVM contracts to Base Mainnet..."
        RPC="${BASE_RPC:-https://mainnet.base.org}"
    fi
    
    if [ -d "$JEJU_CONTRACTS" ]; then
        cd "$JEJU_CONTRACTS"
        forge script script/DeployOTC.s.sol:DeployOTC --rpc-url "$RPC" --broadcast --verify
        cd -
    else
        echo "Jeju contracts package not found, skipping Base deployment"
    fi
}

deploy_bsc() {
    if [ "$ENV" = "testnet" ]; then
        echo "Deploying EVM contracts to BSC Testnet..."
        RPC="${BSC_TESTNET_RPC:-https://data-seed-prebsc-1-s1.bnbchain.org:8545}"
    else
        echo "Deploying EVM contracts to BSC Mainnet..."
        RPC="${BSC_RPC:-https://bsc-dataseed.bnbchain.org}"
    fi
    
    if [ -d "$JEJU_CONTRACTS" ]; then
        cd "$JEJU_CONTRACTS"
        forge script script/DeployOTC.s.sol:DeployOTC --rpc-url "$RPC" --broadcast --verify
        cd -
    else
        echo "Jeju contracts package not found, skipping BSC deployment"
    fi
}

deploy_solana() {
    if [ "$ENV" = "testnet" ]; then
        echo "Deploying Solana program to Devnet..."
        RPC="https://api.devnet.solana.com"
    else
        echo "Deploying Solana program to Mainnet..."
        RPC="https://api.mainnet-beta.solana.com"
    fi
    
    if [ -d "solana/otc-program" ]; then
        cd solana/otc-program
        ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET=./id.json bun scripts/deploy-$ENV.ts
        cd ../..
    else
        echo "Solana program directory not found, skipping Solana deployment"
    fi
}

deploy_jeju() {
    if [ "$ENV" = "testnet" ]; then
        echo "Deploying EVM contracts to Jeju Testnet..."
        RPC="${JEJU_TESTNET_RPC:-https://testnet-rpc.jeju.network}"
    else
        echo "Deploying EVM contracts to Jeju Mainnet..."
        RPC="${JEJU_RPC:-https://rpc.jeju.network}"
    fi
    
    if [ -d "$JEJU_CONTRACTS" ]; then
        cd "$JEJU_CONTRACTS"
        forge script script/DeployOTC.s.sol:DeployOTC --rpc-url "$RPC" --broadcast
        cd -
    else
        echo "Jeju contracts package not found, skipping Jeju deployment"
    fi
}

# Deploy to selected chains
case "$CHAIN" in
    all)
        deploy_base
        deploy_bsc
        deploy_solana
        deploy_jeju
        ;;
    base)
        deploy_base
        ;;
    bsc)
        deploy_bsc
        ;;
    solana)
        deploy_solana
        ;;
    jeju)
        deploy_jeju
        ;;
    *)
        echo "Unknown chain: $CHAIN"
        echo "Valid options: all, base, bsc, solana, jeju"
        exit 1
        ;;
esac

echo "Deployment complete."

