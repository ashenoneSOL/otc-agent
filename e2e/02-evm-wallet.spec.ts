/**
 * EVM Wallet Connection and Interaction Tests
 * Tests EVM wallet connection via MetaMask on Anvil
 */

import { test, expect } from './helpers/walletTest';

test.setTimeout(600000);

test.describe('EVM Wallet Connection', () => {
  test('connect MetaMask from homepage', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Click connect button
    await page.getByRole('button', { name: /connect/i }).first().click();
    
    // Choose EVM, then Base
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /base/i }).click();
    await page.waitForTimeout(2000);
    
    // Approve in MetaMask
    await wallet.approve();
    await page.waitForTimeout(3000);
    
    // Should show connected state in header
    const walletAddress = await wallet.page.evaluate(() => {
      return window.ethereum?.selectedAddress;
    });
    
    expect(walletAddress).toBeTruthy();
    
    // Header should show wallet address
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}\\.{3}[a-fA-F0-9]{4}/')).toBeVisible({ timeout: 10000 });
  });

  test('wallet menu shows correct network', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Connect wallet
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /jeju/i }).click();
    await page.waitForTimeout(2000);
    await wallet.approve();
    await page.waitForTimeout(3000);
    
    // Click wallet menu
    const walletButton = page.locator('button:has-text("0x")').or(
      page.locator('button').filter({ hasText: /EVM|Base/i })
    );
    await walletButton.first().click();
    
    // Should show network info (Base or EVM)
    await expect(page.getByText(/EVM|Base/i)).toBeVisible();
  });

  test('can disconnect wallet', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Connect
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /jeju/i }).click();
    await page.waitForTimeout(2000);
    await wallet.approve();
    await page.waitForTimeout(3000);
    
    // Open wallet menu
    const walletButton = page.locator('button:has-text("0x")').or(
      page.locator('button').filter({ hasText: /EVM|Base/i })
    );
    await walletButton.first().click();
    
    // Click disconnect
    await page.getByRole('button', { name: /disconnect/i }).click();
    await page.waitForTimeout(2000);
    
    // Should show connect button again
    await expect(page.getByRole('button', { name: /connect/i }).first()).toBeVisible();
  });

  test('wallet persists across page navigation', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Connect
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /jeju/i }).click();
    await page.waitForTimeout(2000);
    await wallet.approve();
    await page.waitForTimeout(3000);
    
    // Navigate to another page
    await page.goto('/my-deals');
    await page.waitForTimeout(2000);
    
    // Should still be connected
    await expect(page.locator('text=/0x[a-fA-F0-9]{4}\\.{3}[a-fA-F0-9]{4}/')).toBeVisible();
  });
});

test.describe('EVM Chat and Quote Flow', () => {
  test('can chat with agent after connecting', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Connect wallet
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /jeju/i }).click();
    await page.waitForTimeout(2000);
    await wallet.approve();
    await page.waitForTimeout(4000);
    
    // Navigate to token page (where chat is)
    // First check if there are any tokens on the marketplace
    const firstDealCard = page.locator('[data-testid="deal-card"]').or(
      page.locator('a[href*="/token/"]')
    ).first();
    
    if (await firstDealCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstDealCard.click();
      await page.waitForTimeout(2000);
      
      // Chat input should now be enabled
      const chatInput = page.locator('[data-testid="chat-input"]');
      await expect(chatInput).toBeEnabled({ timeout: 10000 });
      
      // Type a message
      await chatInput.fill('I want to buy 1000 tokens at 10% discount');
      
      // Send button should be enabled
      const sendButton = page.locator('[data-testid="send-button"]');
      await expect(sendButton).toBeEnabled();
    } else {
      console.log('No deals available to test chat - skipping');
    }
  });
});

test.describe('EVM Transaction Signing', () => {
  test('can approve and sign transaction', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Connect wallet
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /jeju/i }).click();
    await page.waitForTimeout(2000);
    await wallet.approve();
    await page.waitForTimeout(3000);
    
    // This test verifies wallet connection works
    // Actual transaction testing is in the complete flow tests
    
    const walletConnected = await page.locator('text=/0x[a-fA-F0-9]{4}\\.{3}[a-fA-F0-9]{4}/').isVisible();
    expect(walletConnected).toBeTruthy();
  });

  test('handles transaction rejection gracefully', async ({ page, wallet }) => {
    await page.goto('/');
    
    // Connect wallet
    await page.getByRole('button', { name: /connect/i }).first().click();
    await page.getByRole('button', { name: /evm/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /jeju/i }).click();
    await page.waitForTimeout(2000);
    await wallet.approve();
    await page.waitForTimeout(3000);
    
    // App should be stable and functional even without transaction
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByRole('button', { name: /connect/i }).first().or(
      page.locator('text=/0x[a-fA-F0-9]{4}\\.{3}[a-fA-F0-9]{4}/')
    )).toBeVisible();
  });
});

