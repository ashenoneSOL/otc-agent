import { createPublicClient, http, type Address, type Abi } from "viem";
import { base, baseSepolia } from "viem/chains";
import { getCurrentNetwork } from "@/config/contracts";

const EIL_DEPLOYMENTS: Record<string, { paymaster: Address; stakeManager: Address }> = {
  testnet: {
    paymaster: process.env.NEXT_PUBLIC_EIL_PAYMASTER as Address || "0x0000000000000000000000000000000000000000",
    stakeManager: process.env.NEXT_PUBLIC_EIL_STAKE_MANAGER as Address || "0x0000000000000000000000000000000000000000",
  },
  mainnet: {
    paymaster: process.env.NEXT_PUBLIC_EIL_PAYMASTER_MAINNET as Address || "0x0000000000000000000000000000000000000000",
    stakeManager: process.env.NEXT_PUBLIC_EIL_STAKE_MANAGER_MAINNET as Address || "0x0000000000000000000000000000000000000000",
  },
};

const PAYMASTER_ABI: Abi = [
  {
    name: "createVoucherRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destinationToken", type: "address" },
      { name: "destinationChainId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "gasOnDestination", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "feeIncrement", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    name: "getCurrentFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "requester", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "destinationToken", type: "address" },
          { name: "destinationChainId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "gasOnDestination", type: "uint256" },
          { name: "maxFee", type: "uint256" },
          { name: "feeIncrement", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "createdBlock", type: "uint256" },
          { name: "claimed", type: "bool" },
          { name: "expired", type: "bool" },
          { name: "refunded", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "canFulfillRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getXLPLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "xlp", type: "address" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
];

export interface VoucherRequest {
  requester: Address;
  token: Address;
  amount: bigint;
  destinationToken: Address;
  destinationChainId: bigint;
  recipient: Address;
  gasOnDestination: bigint;
  maxFee: bigint;
  feeIncrement: bigint;
  deadline: bigint;
  createdBlock: bigint;
  claimed: boolean;
  expired: boolean;
  refunded: boolean;
}

function getEILDeployment() {
  const network = getCurrentNetwork();
  return EIL_DEPLOYMENTS[network] || EIL_DEPLOYMENTS.testnet;
}

function getPublicClient() {
  const network = getCurrentNetwork();
  const chain = network === "mainnet" ? base : baseSepolia;
  const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || chain.rpcUrls.default.http[0];
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export async function getCurrentFee(requestId: `0x${string}`): Promise<bigint | null> {
  const deployment = getEILDeployment();
  if (deployment.paymaster === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const client = getPublicClient();
  try {
    const result = await client.readContract({
      address: deployment.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "getCurrentFee",
      args: [requestId],
    }) as bigint;
    return result;
  } catch {
    return null;
  }
}

export async function getVoucherRequest(requestId: `0x${string}`): Promise<VoucherRequest | null> {
  const deployment = getEILDeployment();
  if (deployment.paymaster === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const client = getPublicClient();
  try {
    const result = await client.readContract({
      address: deployment.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "getRequest",
      args: [requestId],
    }) as VoucherRequest;
    return result;
  } catch {
    return null;
  }
}

export async function canFulfillRequest(requestId: `0x${string}`): Promise<boolean> {
  const deployment = getEILDeployment();
  if (deployment.paymaster === "0x0000000000000000000000000000000000000000") {
    return false;
  }

  const client = getPublicClient();
  try {
    const result = await client.readContract({
      address: deployment.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "canFulfillRequest",
      args: [requestId],
    }) as boolean;
    return result;
  } catch {
    return false;
  }
}

export async function getXLPLiquidity(xlpAddress: Address, tokenAddress: Address): Promise<bigint | null> {
  const deployment = getEILDeployment();
  if (deployment.paymaster === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const client = getPublicClient();
  try {
    const result = await client.readContract({
      address: deployment.paymaster,
      abi: PAYMASTER_ABI,
      functionName: "getXLPLiquidity",
      args: [xlpAddress, tokenAddress],
    }) as bigint;
    return result;
  } catch {
    return null;
  }
}

export function getEILAddresses() {
  return getEILDeployment();
}


