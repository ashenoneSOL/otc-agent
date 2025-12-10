import { createPublicClient, http, type Address, type Abi } from "viem";
import { base, baseSepolia } from "viem/chains";
import { getCurrentNetwork } from "@/config/contracts";

const OIF_DEPLOYMENTS: Record<string, { inputSettler: Address; outputSettler: Address; solverRegistry: Address }> = {
  testnet: {
    inputSettler: process.env.NEXT_PUBLIC_OIF_INPUT_SETTLER as Address || "0x0000000000000000000000000000000000000000",
    outputSettler: process.env.NEXT_PUBLIC_OIF_OUTPUT_SETTLER as Address || "0x0000000000000000000000000000000000000000",
    solverRegistry: process.env.NEXT_PUBLIC_OIF_SOLVER_REGISTRY as Address || "0x0000000000000000000000000000000000000000",
  },
  mainnet: {
    inputSettler: process.env.NEXT_PUBLIC_OIF_INPUT_SETTLER_MAINNET as Address || "0x0000000000000000000000000000000000000000",
    outputSettler: process.env.NEXT_PUBLIC_OIF_OUTPUT_SETTLER_MAINNET as Address || "0x0000000000000000000000000000000000000000",
    solverRegistry: process.env.NEXT_PUBLIC_OIF_SOLVER_REGISTRY_MAINNET as Address || "0x0000000000000000000000000000000000000000",
  },
};

const INPUT_SETTLER_ABI: Abi = [
  {
    name: "open",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "originSettler", type: "address" },
          { name: "user", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "originChainId", type: "uint256" },
          { name: "openDeadline", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "orderDataType", type: "bytes32" },
          { name: "orderData", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "openFor",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "originSettler", type: "address" },
          { name: "user", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "originChainId", type: "uint256" },
          { name: "openDeadline", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "orderDataType", type: "bytes32" },
          { name: "orderData", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "originFillerData", type: "bytes" },
    ],
    outputs: [],
  },
];

const SOLVER_REGISTRY_ABI: Abi = [
  {
    name: "getSolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "solver", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "solver", type: "address" },
          { name: "stakedAmount", type: "uint256" },
          { name: "slashedAmount", type: "uint256" },
          { name: "totalFills", type: "uint256" },
          { name: "successfulFills", type: "uint256" },
          { name: "supportedChains", type: "uint256[]" },
          { name: "isActive", type: "bool" },
          { name: "registeredAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "isSolverActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "solver", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
];

export interface CrossChainOrder {
  originSettler: Address;
  user: Address;
  nonce: bigint;
  originChainId: bigint;
  openDeadline: number;
  fillDeadline: number;
  orderDataType: `0x${string}`;
  orderData: `0x${string}`;
}

export interface SolverInfo {
  solver: Address;
  stakedAmount: bigint;
  slashedAmount: bigint;
  totalFills: bigint;
  successfulFills: bigint;
  supportedChains: bigint[];
  isActive: boolean;
  registeredAt: bigint;
}

function getOIFDeployment() {
  const network = getCurrentNetwork();
  return OIF_DEPLOYMENTS[network] || OIF_DEPLOYMENTS.testnet;
}

function getPublicClient() {
  const network = getCurrentNetwork();
  const chain = network === "mainnet" ? base : baseSepolia;
  const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || chain.rpcUrls.default.http[0];
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function getSolverInfo(solverAddress: Address): Promise<SolverInfo | null> {
  const deployment = getOIFDeployment();
  if (deployment.solverRegistry === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const client = getPublicClient();
  try {
    const result = await client.readContract({
      address: deployment.solverRegistry,
      abi: SOLVER_REGISTRY_ABI,
      functionName: "getSolver",
      args: [solverAddress],
    }) as SolverInfo;
    return result;
  } catch {
    return null;
  }
}

export async function isSolverActive(solverAddress: Address): Promise<boolean> {
  const deployment = getOIFDeployment();
  if (deployment.solverRegistry === "0x0000000000000000000000000000000000000000") {
    return false;
  }

  const client = getPublicClient();
  try {
    const result = await client.readContract({
      address: deployment.solverRegistry,
      abi: SOLVER_REGISTRY_ABI,
      functionName: "isSolverActive",
      args: [solverAddress],
    }) as boolean;
    return result;
  } catch {
    return false;
  }
}

export function encodeTokenSwapOrder(params: {
  sourceToken: Address;
  sourceAmount: bigint;
  destinationToken: Address;
  destinationChainId: bigint;
  minReceived: bigint;
  recipient: Address;
}): `0x${string}` {
  const { sourceToken, sourceAmount, destinationToken, destinationChainId, minReceived, recipient } = params;
  const encoded = `0x${[
    sourceToken.slice(2).padStart(64, "0"),
    sourceAmount.toString(16).padStart(64, "0"),
    destinationToken.slice(2).padStart(64, "0"),
    destinationChainId.toString(16).padStart(64, "0"),
    minReceived.toString(16).padStart(64, "0"),
    recipient.slice(2).padStart(64, "0"),
  ].join("")}` as `0x${string}`;
  return encoded;
}

export const OIF_ORDER_TYPES = {
  TOKEN_SWAP: "0x" + Buffer.from("TokenSwap").toString("hex").padEnd(64, "0") as `0x${string}`,
  COMPUTE_RENTAL: "0x" + Buffer.from("ComputeRental").toString("hex").padEnd(64, "0") as `0x${string}`,
  COMPUTE_INFERENCE: "0x" + Buffer.from("ComputeInference").toString("hex").padEnd(64, "0") as `0x${string}`,
};

export function getOIFAddresses() {
  return getOIFDeployment();
}


