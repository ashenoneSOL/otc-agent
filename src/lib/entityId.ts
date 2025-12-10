import { stringToUuid } from "@elizaos/core";

export function walletToEntityId(address: string): string {
  const trimmed = address.trim();
  const normalized = trimmed.toLowerCase();
  return stringToUuid(normalized) as string;
}
