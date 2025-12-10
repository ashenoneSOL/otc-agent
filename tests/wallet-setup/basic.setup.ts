import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';

/**
 * MetaMask wallet setup for Synpress E2E tests (EVM-only)
 * 
 * Uses the standard Anvil test seed phrase:
 * - Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
 * - Account 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
 * 
 * Supported chains:
 * - Anvil: chainId 31337 at http://localhost:8545
 * - Jeju Testnet: chainId 10242 
 * - Jeju Mainnet: chainId 10241
 * 
 * Wallet state is cached by Synpress in .cache/synpress-cache.
 */

const SEED_PHRASE = process.env.SEED_PHRASE || 'test test test test test test test test test test test junk';
const PASSWORD = process.env.WALLET_PASSWORD || 'Tester@1234';

const setupWallet = defineWalletSetup(PASSWORD, async (context, walletPage) => {
  await walletPage.waitForLoadState('domcontentloaded');
  
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SEED_PHRASE);

  const chainId = parseInt(process.env.CHAIN_ID || '31337');
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:8545';
  
  try {
    await metamask.addNetwork({
      name: 'Anvil Localnet',
      rpcUrl: rpcUrl,
      chainId: chainId,
      symbol: 'ETH',
    });
  } catch {
    console.log('Anvil network may already be added, continuing...');
  }

  // Add Jeju Testnet if configured
  const jejuRpcUrl = process.env.NEXT_PUBLIC_JEJU_RPC_URL;
  if (jejuRpcUrl) {
    try {
      await metamask.addNetwork({
        name: 'Jeju Testnet',
        rpcUrl: jejuRpcUrl,
        chainId: 10242,
        symbol: 'JEJU',
      });
      console.log('Added Jeju Testnet');
    } catch {
      console.log('Jeju network may already be added, continuing...');
    }
  }

  try {
    await metamask.switchNetwork('Anvil Localnet');
  } catch {
    console.log('Could not switch network, continuing...');
  }
});

export const walletPassword = PASSWORD;
export const seedPhrase = SEED_PHRASE;
export default setupWallet;

