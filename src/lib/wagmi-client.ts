import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import type { Config } from "wagmi";
import { localhost, base, baseSepolia, bsc, bscTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

const jejuDevnet = defineChain({
  id: 420689,
  name: "Jeju Devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://devnet-rpc.jeju.network"] },
  },
  blockExplorers: {
    default: { name: "Jeju Explorer", url: "https://devnet-explorer.jeju.network" },
  },
});

const jejuTestnet = defineChain({
  id: 420690,
  name: "Jeju Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.jeju.network"] },
  },
  blockExplorers: {
    default: { name: "Jeju Explorer", url: "https://testnet-explorer.jeju.network" },
  },
});

const jejuMainnet = defineChain({
  id: 420691,
  name: "Jeju",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.jeju.network"] },
  },
  blockExplorers: {
    default: { name: "Jeju Explorer", url: "https://explorer.jeju.network" },
  },
});

const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const bscRpcUrl = process.env.NEXT_PUBLIC_BSC_RPC_URL;
const jejuRpcUrl = process.env.NEXT_PUBLIC_JEJU_RPC_URL;
const anvilRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

function getProxyUrl(path: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}${path}`;
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:4444";
  return `${appUrl}${path}`;
}

function getAvailableChains() {
  const network = process.env.NEXT_PUBLIC_NETWORK;
  const isLocalNetwork = network === "local" || network === "localnet";
  const chains = [];

  if (isLocalNetwork) {
    chains.push(localhost);
    chains.push(jejuDevnet);
  }

  chains.push(base, baseSepolia);
  chains.push(bsc, bscTestnet);
  chains.push(jejuTestnet, jejuMainnet);

  return chains;
}

const chains = getAvailableChains();

function getTransports() {
  const transports: Record<number, ReturnType<typeof http>> = {};

  const network = process.env.NEXT_PUBLIC_NETWORK;
  const isLocalNetwork = network === "local" || network === "localnet";

  if (isLocalNetwork) {
    transports[localhost.id] = http(anvilRpcUrl);
    transports[jejuDevnet.id] = http(jejuRpcUrl || "https://devnet-rpc.jeju.network");
  }

  if (baseRpcUrl) {
    transports[base.id] = http(baseRpcUrl);
    transports[baseSepolia.id] = http(baseRpcUrl);
  } else {
    transports[base.id] = http(getProxyUrl("/api/rpc/base"));
    transports[baseSepolia.id] = http("https://sepolia.base.org");
  }

  if (bscRpcUrl) {
    transports[bsc.id] = http(bscRpcUrl);
    transports[bscTestnet.id] = http(bscRpcUrl);
  } else {
    transports[bsc.id] = http("https://bsc-dataseed1.binance.org");
    transports[bscTestnet.id] = http(
      "https://data-seed-prebsc-1-s1.binance.org:8545",
    );
  }

  transports[jejuTestnet.id] = http(jejuRpcUrl || "https://testnet-rpc.jeju.network");
  transports[jejuMainnet.id] = http(jejuRpcUrl || "https://rpc.jeju.network");

  return transports;
}

function getConnectors() {
  if (typeof window === "undefined") return [];
  return [
    farcasterMiniApp(),
    injected({ shimDisconnect: true }),
  ];
}

export const config: Config = createConfig({
  chains: chains as never,
  connectors: getConnectors(),
  transports: getTransports() as never,
  ssr: true,
});

export { chains };
