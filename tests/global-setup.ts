/**
 * Global Setup for E2E Tests
 * 
 * Starts all required infrastructure before tests run:
 * - PostgreSQL database (via Docker)
 * - Anvil (local EVM node)
 * - Deploys contracts to Anvil
 * - Next.js dev server
 * 
 * Infrastructure state is saved to be cleaned up in global-teardown.ts
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(__dirname, "..");
const STATE_FILE = join(PROJECT_ROOT, ".test-infrastructure-state.json");
const ANVIL_PORT = 8545;
const APP_PORT = 4444;
const POSTGRES_PORT = 5439;

interface InfrastructureState {
  anvilPid?: number;
  nextPid?: number;
  startedAt: number;
}

function log(message: string) {
  console.log(`[E2E Setup] ${message}`);
}

function isPortInUse(port: number): boolean {
  try {
    execSync(`lsof -i :${port}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function waitForPort(port: number, timeoutMs: number = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (isPortInUse(port)) {
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for port ${port}`));
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

function waitForUrl(url: string, timeoutMs: number = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = async () => {
      try {
        const response = await fetch(url, { method: "HEAD" });
        if (response.ok || response.status === 404) {
          resolve();
          return;
        }
      } catch {
        // Not ready yet
      }
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url}`));
      } else {
        setTimeout(check, 1000);
      }
    };
    check();
  });
}

async function startPostgres(): Promise<void> {
  log("Ensuring PostgreSQL is running...");
  
  try {
    execSync(`${PROJECT_ROOT}/scripts/ensure-postgres.sh`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
  } catch (error) {
    throw new Error(`Failed to start PostgreSQL: ${error}`);
  }
}

async function startAnvil(): Promise<ChildProcess | null> {
  if (isPortInUse(ANVIL_PORT)) {
    log("Anvil already running on port 8545");
    return null;
  }

  log("Starting Anvil...");
  
  // Kill any stale processes
  try {
    execSync("pkill -9 -f anvil 2>/dev/null || true", { stdio: "ignore" });
  } catch {
    // Ignore
  }

  const anvil = spawn("anvil", [
    "--host", "127.0.0.1",
    "--port", String(ANVIL_PORT),
    "--chain-id", "31337",
    "--accounts", "20",
    "--balance", "10000",
    "--gas-limit", "30000000",
    "--gas-price", "0",
  ], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  anvil.unref();

  // Wait for Anvil to be ready
  await waitForPort(ANVIL_PORT, 15000);
  log("Anvil started successfully");
  
  return anvil;
}

async function deployContracts(): Promise<void> {
  log("Deploying contracts to Anvil...");
  
  try {
    execSync(
      "forge script scripts/DeployElizaOTC.s.sol --broadcast --rpc-url http://127.0.0.1:8545",
      {
        cwd: join(PROJECT_ROOT, "contracts"),
        stdio: "inherit",
      }
    );
    log("Contracts deployed successfully");
  } catch (error) {
    throw new Error(`Failed to deploy contracts: ${error}`);
  }

  // Sync deployment addresses to local-evm.json
  const deploymentFile = join(PROJECT_ROOT, "contracts/deployments/eliza-otc-deployment.json");
  const localEvmFile = join(PROJECT_ROOT, "src/config/deployments/local-evm.json");
  
  if (existsSync(deploymentFile)) {
    const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));
    
    const localConfig = {
      network: "local-anvil",
      chainId: 31337,
      rpc: "http://127.0.0.1:8545",
      timestamp: new Date().toISOString(),
      deployer: deployment.accounts?.owner || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      contracts: {
        otc: deployment.contracts?.deal || deployment.contracts?.otc,
        usdc: deployment.contracts?.usdcMock || deployment.contracts?.usdc,
        elizaToken: deployment.contracts?.elizaToken,
        registrationHelper: deployment.contracts?.registrationHelper,
        ethUsdFeed: deployment.contracts?.ethUsdFeed,
      },
      accounts: deployment.accounts,
      testWalletPrivateKey: deployment.testWalletPrivateKey,
    };
    
    // Ensure directory exists
    mkdirSync(join(PROJECT_ROOT, "src/config/deployments"), { recursive: true });
    writeFileSync(localEvmFile, JSON.stringify(localConfig, null, 2));
    log("Updated local-evm.json with deployment addresses");
    
    // Fund test wallet if available
    if (deployment.accounts?.testWallet) {
      const ownerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      try {
        execSync(
          `cast send ${deployment.accounts.testWallet} --value 100ether --private-key ${ownerKey} --rpc-url http://127.0.0.1:8545`,
          { stdio: "ignore" }
        );
        log("Funded test wallet with 100 ETH");
      } catch {
        // May already have funds
      }
    }
  }
}

async function startNextJs(): Promise<ChildProcess | null> {
  if (isPortInUse(APP_PORT)) {
    log("Next.js already running on port 4444");
    return null;
  }

  log("Starting Next.js dev server...");
  
  // Kill any stale Next.js processes
  try {
    execSync("pkill -f 'next dev' 2>/dev/null || true", { stdio: "ignore" });
  } catch {
    // Ignore
  }

  const next = spawn("bun", ["run", "next", "dev", "-p", String(APP_PORT)], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: {
      ...process.env,
      NEXT_PUBLIC_NETWORK: "local",
      NODE_ENV: "development",
    },
  });

  next.unref();

  // Wait for Next.js to be ready
  await waitForUrl(`http://localhost:${APP_PORT}`, 60000);
  log("Next.js started successfully");
  
  return next;
}

function saveState(state: InfrastructureState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export default async function globalSetup(): Promise<void> {
  log("Starting E2E test infrastructure...");
  const startTime = Date.now();

  try {
    // 1. Start PostgreSQL (required for app)
    await startPostgres();

    // 2. Start Anvil (EVM localnet)
    const anvil = await startAnvil();

    // 3. Deploy contracts
    await deployContracts();

    // 4. Start Next.js
    const next = await startNextJs();

    // Save state for teardown
    const state: InfrastructureState = {
      anvilPid: anvil?.pid,
      nextPid: next?.pid,
      startedAt: startTime,
    };
    saveState(state);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Infrastructure ready in ${elapsed}s`);
    log("  PostgreSQL: localhost:5439");
    log("  Anvil: http://127.0.0.1:8545");
    log("  Next.js: http://localhost:4444");
  } catch (error) {
    log(`Setup failed: ${error}`);
    throw error;
  }
}


