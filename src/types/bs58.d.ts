/**
 * Type declarations for bs58
 * bs58 provides base58 encoding/decoding for Solana addresses
 */
declare module "bs58" {
  export function encode(source: Uint8Array | number[]): string;
  export function decode(source: string): Uint8Array;
  export function decodeUnsafe(source: string): Uint8Array | undefined;
}
