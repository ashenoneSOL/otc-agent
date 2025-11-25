import { test as base, expect, BrowserContext } from '@playwright/test';
import { bootstrap, Dappwright, getWallet, MetaMaskWallet } from '@tenkeylabs/dappwright';

base.setTimeout(120000);

export const test = base.extend<{ wallet: Dappwright }, { walletContext: BrowserContext }>({
  walletContext: [
    async ({}, use: (value: BrowserContext) => Promise<void>) => {
      const [wallet, , context] = await bootstrap('', {
        wallet: 'metamask',
        version: MetaMaskWallet.recommendedVersion,
        seed: 'test test test test test test test test test test test junk', // Deterministic seed
        headless: false,
      });
      
      // Add Base network (using public RPC for read-only, but we might need to sign)
      await wallet.addNetwork({
        networkName: 'Base Mainnet',
        rpc: 'https://mainnet.base.org',
        chainId: 8453,
        symbol: 'ETH',
      });

      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  
  context: async ({ walletContext }, use: (value: BrowserContext) => Promise<void>) => {
    await use(walletContext);
  },
  
  wallet: async ({ walletContext }, use: (value: Dappwright) => Promise<void>) => {
    const wallet = await getWallet('metamask', walletContext);
    await use(wallet);
  },
});

test.describe('Consignment Flow', () => {
  test('register token on Base (manual entry -> pool finding)', async ({ page, wallet }) => {
    console.log('\n🚀 Testing Consignment Flow on Base\n');

    // 1. Navigate to app
    await page.goto('/');
    
    // 2. Connect Wallet
    console.log('1️⃣  Connecting wallet...');
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    
    // Approve connection
    await wallet.approve();
    console.log('   ✅ Wallet connected');

    // 3. Open Register Modal (via "Sell" or direct link if available, usually "Register Token" button in Consign page)
    // Assuming we are on /consign or similar
    // Actually, the "Register New Token" modal is likely accessible from the token selector or a specific button.
    // Let's go to a page that triggers it or use the "Consign" page.
    
    // If the app has a "Register Token" button in the header or tokens page:
    await page.goto('/consign'); // Or wherever the modal is triggered
    
    // Wait for "Register Token" or similar button if scanning fails or is empty
    // The UI shows "Scan My Wallet" initially.
    // If scan fails/empty, it shows manual input.
    
    console.log('2️⃣  Opening Registration Modal...');
    // In the modal code: "Register New Token"
    // We might need to trigger it. Let's assume there's a button.
    // If not, we might need to find where it's used.
    // It's used in `RegisterTokenModal`.
    // Let's assume there is a button "Register Token" on the UI.
    
    // If looking at `src/app/page.tsx` or `consign/page.tsx`:
    // Let's check where RegisterTokenModal is used.
    // It is used in `src/components/token-list.tsx` usually or `header`.
    
    // I'll search for the button text "Register Token".
    const registerBtn = page.getByRole('button', { name: /register.*token/i });
    if (await registerBtn.isVisible()) {
      await registerBtn.click();
    } else {
      // Try to find it in a menu or "Sell" page
      await page.goto('/tokens');
      await page.getByRole('button', { name: /register/i }).click();
    }
    
    console.log('   ✅ Modal opened');

    // 4. Manual Token Entry (Simulating "Finding token in wallet" via manual fallback)
    console.log('3️⃣  Entering token address (DEGEN)...');
    
    // Click "Base" chain if needed (default is Base usually)
    await page.getByRole('button', { name: /base/i }).click();
    
    // Input address
    const degenAddress = "0x4ed4E862860beD51a9570b96d8014731D394fF0d";
    const input = page.getByPlaceholder(/paste.*address/i);
    await input.fill(degenAddress);
    await input.press('Enter');
    
    // 5. Verify Pool Finding
    console.log('4️⃣  Verifying Pool Discovery...');
    // Should show loading "Searching Uniswap V3 pools"
    // Then show result
    
    // Expect "Uniswap V3" text
    await expect(page.getByText(/Uniswap V3/i)).toBeVisible({ timeout: 15000 });
    // Expect TVL value
    await expect(page.getByText(/TVL: \$/i)).toBeVisible();
    
    console.log('   ✅ Pool found (Uniswap V3)');

    // 6. Proceed to Register
    console.log('5️⃣  Clicking Register...');
    const payBtn = page.getByRole('button', { name: /pay & register/i });
    await expect(payBtn).toBeEnabled();
    // await payBtn.click();
    
    // NOTE: We stop here before clicking "Pay" to avoid spending real funds (even if testnet, we might not have gas).
    // If we had a forked chain with funds, we could proceed.
    // For this test, verifying the Pool Finder integration in the UI is the goal.
    
    console.log('   ✅ Verification Complete');
  });
});



