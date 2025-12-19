/**
 * Global Teardown for E2E Tests
 * 
 * Stops all infrastructure started by global-setup.ts:
 * - Next.js dev server
 * - Anvil (local EVM node)
 * - PostgreSQL container (optional - keeps running by default)
 * 
 * Set TEARDOWN_POSTGRES=true to also stop the database
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(__dirname, "..");
const STATE_FILE = join(PROJECT_ROOT, ".test-infrastructure-state.json");

interface InfrastructureState {
  anvilPid?: number;
  nextPid?: number;
  startedAt: number;
}

function log(message: string) {
  console.log(`[E2E Teardown] ${message}`);
}

function killProcess(pid: number | undefined, name: string): void {
  if (!pid) return;
  
  try {
    process.kill(pid, "SIGTERM");
    log(`Stopped ${name} (PID: ${pid})`);
  } catch {
    // Process may have already exited
  }
}

function stopAnvil(): void {
  try {
    execSync("pkill -9 -f anvil 2>/dev/null || true", { stdio: "ignore" });
    log("Stopped Anvil");
  } catch {
    // Ignore
  }
}

function stopNextJs(): void {
  try {
    execSync("pkill -f 'next dev' 2>/dev/null || true", { stdio: "ignore" });
    log("Stopped Next.js");
  } catch {
    // Ignore
  }
}

function stopPostgres(): void {
  if (process.env.TEARDOWN_POSTGRES !== "true") {
    log("Keeping PostgreSQL running (set TEARDOWN_POSTGRES=true to stop)");
    return;
  }
  
  try {
    execSync("docker stop otc-postgres 2>/dev/null || true", { stdio: "ignore" });
    log("Stopped PostgreSQL container");
  } catch {
    // Ignore
  }
}

function loadState(): InfrastructureState | null {
  if (!existsSync(STATE_FILE)) {
    return null;
  }
  
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function cleanupStateFile(): void {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

export default async function globalTeardown(): Promise<void> {
  log("Stopping E2E test infrastructure...");

  const state = loadState();

  // Stop processes that we started
  if (state) {
    killProcess(state.nextPid, "Next.js");
    killProcess(state.anvilPid, "Anvil");
    
    const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
    log(`Infrastructure ran for ${elapsed}s`);
  }

  // Ensure processes are stopped even if we don't have PIDs
  stopNextJs();
  stopAnvil();
  stopPostgres();

  // Clean up state file
  cleanupStateFile();

  log("Teardown complete");
}


