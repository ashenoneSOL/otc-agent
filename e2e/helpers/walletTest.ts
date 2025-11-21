import { BrowserContext, test as baseTest } from "@playwright/test";
import dappwright, { Dappwright, MetaMaskWallet } from "@tenkeylabs/dappwright";

// Use Anvil for testing (default network)
const ANVIL_RPC = process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545';
const ANVIL_CHAIN_ID = 31337;

let sharedContext: BrowserContext | undefined;
let sharedWallet: Dappwright | undefined;

export const test = baseTest.extend<{
  context: BrowserContext;
  wallet: Dappwright;
}>({
  // Provide a browser context that has the wallet extension loaded
  context: async ({}, use) => {
    if (!sharedContext) {
      const [wallet, _page, context] = await dappwright.bootstrap("", {
        wallet: "metamask",
        version: MetaMaskWallet.recommendedVersion,
        seed: "test test test test test test test test test test test junk",
        headless: false,
        // Speed up extension boot
        args: ["--disable-features=IsolateOrigins,site-per-process"],
      } as any);

      // Add Anvil network (primary test network)
      await wallet.addNetwork({
        networkName: "Anvil Local",
        rpc: ANVIL_RPC,
        chainId: ANVIL_CHAIN_ID,
        symbol: "ETH",
      });

      // Ensure wallet is unlocked and on the right network
      await wallet.signin();
      await wallet.switchNetwork("Anvil Local");

      sharedContext = context;
      sharedWallet = wallet;
    }

    await use(sharedContext);
  },

  wallet: async ({}, use) => {
    if (!sharedWallet) throw new Error("Wallet not initialized");
    await use(sharedWallet);
  },
});

export const expect = baseTest.expect;


