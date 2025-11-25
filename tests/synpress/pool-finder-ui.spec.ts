/**
 * Pool Finder UI Tests with Synpress
 * Tests the token registration and pool discovery flow
 * 
 * Prerequisites:
 * - Dev server running: bun run dev
 */

import { testWithSynpress } from '@synthetixio/synpress';
import { MetaMask, metaMaskFixtures } from '@synthetixio/synpress/playwright';
import basicSetup, { walletPassword } from '../../test/wallet-setup/basic.setup';

const test = testWithSynpress(metaMaskFixtures(basicSetup));
const { expect } = test;

test.describe('Pool Finder UI', () => {
  
  test('should find pool for valid token on Base', async ({ context, page, metamaskPage, extensionId }) => {
    const metamask = new MetaMask(context, metamaskPage, walletPassword, extensionId);

    // 1. Connect wallet
    await page.goto('/');
    
    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible()) {
        await connectButton.click();
        
        // Handle Privy/Connector modal if present
        const evmButton = page.locator('button:has-text("EVM")');
        if (await evmButton.isVisible().catch(() => false)) {
            await evmButton.click();
        }
        
        const metamaskOption = page.locator('text=MetaMask').or(page.locator('button:has-text("MetaMask")'));
        if (await metamaskOption.first().isVisible().catch(() => false)) {
            await metamaskOption.first().click();
        }
        
        await metamask.connectToDapp();
    }

    // 2. Switch to Base Network (if not already)
    // We can try to trigger this via UI or wallet. 
    // Let's try adding/switching via wallet directly for stability
    await metamask.addNetwork({
        name: 'Base',
        rpcUrl: 'https://base.llamarpc.com',
        chainId: 8453,
        symbol: 'ETH'
    });
    await metamask.switchNetwork('Base');

    // 3. Open Register Token Modal
    // Assuming there is a "Register Token" button or link
    // Based on register-token-modal.tsx, it seems to be a main feature
    const registerButton = page.locator('button:has-text("Register Token")').or(page.locator('button:has-text("List Token")')).first();
    
    // If not found on home, maybe in Consign page?
    if (!await registerButton.isVisible()) {
        await page.goto('/consign');
    }
    
    // Wait for button or form
    await expect(page.locator('text=Token').first()).toBeVisible();

    // 4. Enter Token Address
    // Virtual Protocol on Base
    const tokenAddress = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b"; 
    
    // Look for input that accepts address
    const addressInput = page.locator('input[placeholder*="0x"]').or(page.locator('input[name="tokenAddress"]'));
    await addressInput.fill(tokenAddress);
    
    // 5. Trigger Search (Next / Search button)
    const nextButton = page.locator('button:has-text("Next")').or(page.locator('button:has-text("Search")'));
    if (await nextButton.isVisible()) {
        await nextButton.click();
    }

    // 6. Verify Pool Found
    // Should show "Uniswap V3" or "Aerodrome" and TVL
    await expect(page.locator('text=Uniswap V3').or(page.locator('text=Aerodrome'))).toBeVisible({ timeout: 30000 });
    
    // Verify TVL display
    await expect(page.locator('text=TVL')).toBeVisible();
    await expect(page.locator('text=$')).toBeVisible();
    
    console.log('Pool found and displayed correctly');
  });
});
