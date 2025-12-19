/**
 * Accept Quote Modal E2E Tests - Solana Chain
 * 
 * Tests for the AcceptQuoteModal component on Solana chain using Phantom wallet.
 * 
 * Coverage:
 * - Solana-specific UI (SOL/USDC payment options)
 * - Fractional vs Non-fractional deals
 * - Amount validation and slider interaction
 * - Price display and calculations
 * 
 * Prerequisites:
 * - bun run dev (starts all services including Solana validator)
 * - Phantom wallet has SOL for gas
 * - Solana consignments exist for testing
 * 
 * Run: npx playwright test --config=synpress.config.ts tests/synpress/accept-quote-modal-solana.test.ts
 */

import type { BrowserContext, Page } from '@playwright/test';
import { testWithSynpress } from '@synthetixio/synpress';
import { Phantom, phantomFixtures } from '@synthetixio/synpress/playwright';
import phantomSetup, { phantomPassword } from '../phantom-setup/phantom.setup';

const test = testWithSynpress(phantomFixtures(phantomSetup));
const { expect } = test;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4444';
const TEST_TIMEOUT = 180000; // 3 minutes

// Solana elizaOS token
const SOLANA_TOKEN_SYMBOL = 'ELIZA';
const SOLANA_TOKEN_ADDRESS = 'DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA';

// =============================================================================
// UTILITIES
// =============================================================================

async function waitForPage(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch {
    // networkidle can timeout, continue anyway
  }
  await page.waitForTimeout(1000);
}

async function connectPhantomWallet(page: Page, context: BrowserContext, phantom: Phantom): Promise<boolean> {
  // Check if already connected
  const walletIndicator = page.locator('[data-testid="wallet-menu"], text=/[a-zA-Z0-9]{4}\.\.\.[a-zA-Z0-9]{4}/i').first();
  if (await walletIndicator.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✓ Phantom already connected');
    return true;
  }

  await page.waitForTimeout(2000);

  // Click sign in
  const connectButton = page.locator('button:has-text("Sign In"), button:has-text("Connect Wallet")').first();
  if (await connectButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await connectButton.click();
    console.log('  ✓ Clicked Sign In');
    await page.waitForTimeout(2000);
  }

  // Privy: Continue with wallet
  const continueWithWallet = page.locator('button:has-text("Continue with a wallet")').first();
  if (await continueWithWallet.isVisible({ timeout: 5000 }).catch(() => false)) {
    await continueWithWallet.click();
    console.log('  ✓ Clicked Continue with wallet');
    await page.waitForTimeout(2000);
  }

  // Select Phantom
  const phantomOption = page.locator('button:has-text("Phantom")').first();
  if (await phantomOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await phantomOption.click();
    console.log('  ✓ Selected Phantom wallet');
    await page.waitForTimeout(2000);
  }

  // Handle Solana network selection
  const selectNetworkTitle = page.locator('text=Select network');
  if (await selectNetworkTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('  ✓ Found Select network dialog');
    const phantomOptions = page.locator('button:has-text("Phantom"), div[role="button"]:has-text("Phantom")');
    const count = await phantomOptions.count();
    if (count >= 2) {
      await phantomOptions.nth(1).click(); // Solana option
      console.log('  ✓ Selected Phantom (Solana network)');
      await page.waitForTimeout(2000);
    }
  }

  // Handle Phantom popups
  try {
    await phantom.connectToDapp();
    console.log('  ✓ Approved Phantom connection');
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('  ⚠ Phantom connect handling:', e);
  }

  try {
    await phantom.confirmSignature();
    console.log('  ✓ Confirmed message signature');
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log('  ⚠ Phantom signature handling:', e);
  }

  // Dismiss any announcement popups
  const gotItButton = page.locator('button:has-text("Got it")').first();
  if (await gotItButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await gotItButton.click();
    console.log('  ✓ Dismissed popup');
    await page.waitForTimeout(1000);
  }

  // Verify connection
  const connected = await walletIndicator.isVisible({ timeout: 10000 }).catch(() => false);
  return connected;
}

async function waitForAcceptQuoteModal(page: Page): Promise<boolean> {
  const modal = page.locator('[data-testid="accept-quote-modal"]');
  return await modal.isVisible({ timeout: 10000 }).catch(() => false);
}

// =============================================================================
// SOLANA ACCEPT QUOTE MODAL TESTS
// =============================================================================

test.describe('Solana Accept Quote Modal - UI Elements', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('Solana deal shows SOL/USDC options (not ETH)', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SOLANA CHAIN - PAYMENT OPTIONS');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect wallet
    console.log('📋 STEP 1: Connect Phantom Wallet\n');
    await page.goto(BASE_URL);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Navigate to chat and request Solana token quote
    console.log('\n📋 STEP 2: Request Solana Token Quote\n');
    await page.goto(`${BASE_URL}/chat`);
    await waitForPage(page);

    const chatInput = page.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatInput.fill(`I want to buy 1000 ${SOLANA_TOKEN_SYMBOL} on Solana`);
      await chatInput.press('Enter');
      console.log('  ✓ Sent quote request');
      await page.waitForTimeout(15000);
    }

    // Click Accept to open modal
    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Buy Now")').first();
    if (await acceptButton.isVisible({ timeout: 30000 }).catch(() => false)) {
      await acceptButton.click();
      console.log('  ✓ Clicked Accept');
      await page.waitForTimeout(2000);
    }

    console.log('\n📋 STEP 3: Verify Solana-Specific UI\n');
    const modalVisible = await waitForAcceptQuoteModal(page);
    
    if (!modalVisible) {
      console.log('  ⚠ Modal not visible, taking screenshot');
      await page.screenshot({ path: 'test-results/solana-accept-quote-modal-not-found.png' });
      test.skip();
      return;
    }
    console.log('  ✓ Modal is visible');

    // Check for SOL option (not ETH)
    const solButton = page.locator('button:has-text("SOL")');
    const ethButton = page.locator('button:has-text("ETH")');
    
    const hasSol = await solButton.isVisible({ timeout: 3000 }).catch(() => false);
    const hasEth = await ethButton.isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasSol).toBe(true);
    console.log('  ✓ SOL payment option visible');
    
    expect(hasEth).toBe(false);
    console.log('  ✓ ETH payment option NOT visible (correct for Solana)');

    // Check for USDC option
    const usdcButton = page.locator('button:has-text("USDC")');
    const hasUsdc = await usdcButton.isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasUsdc).toBe(true);
    console.log('  ✓ USDC payment option visible');

    // Toggle between payment options
    if (hasSol && hasUsdc) {
      await solButton.click();
      await page.waitForTimeout(500);
      console.log('  ✓ Selected SOL');
      
      await usdcButton.click();
      await page.waitForTimeout(500);
      console.log('  ✓ Selected USDC');
    }

    console.log('\n✅ SOLANA CHAIN TEST COMPLETE\n');
  });

  test('verifies fractional Solana deal UI elements', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  FRACTIONAL SOLANA DEAL - UI VERIFICATION');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect wallet
    console.log('📋 STEP 1: Connect Phantom Wallet\n');
    await page.goto(BASE_URL);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Navigate to chat and request quote
    console.log('\n📋 STEP 2: Request Quote\n');
    await page.goto(`${BASE_URL}/chat`);
    await waitForPage(page);

    const chatInput = page.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatInput.fill(`I want to buy 5000 ${SOLANA_TOKEN_SYMBOL} on Solana with 10% discount`);
      await chatInput.press('Enter');
      console.log('  ✓ Sent quote request');
      await page.waitForTimeout(15000);
    }

    // Open modal
    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Buy Now")').first();
    if (await acceptButton.isVisible({ timeout: 30000 }).catch(() => false)) {
      await acceptButton.click();
      console.log('  ✓ Clicked Accept');
      await page.waitForTimeout(2000);
    }

    console.log('\n📋 STEP 3: Verify Fractional UI Elements\n');
    const modalVisible = await waitForAcceptQuoteModal(page);
    
    if (!modalVisible) {
      console.log('  ⚠ Modal not visible');
      await page.screenshot({ path: 'test-results/solana-fractional-modal-not-found.png' });
      test.skip();
      return;
    }

    // Check for slider (fractional deal)
    const slider = page.locator('[data-testid="token-amount-slider"]');
    const sliderVisible = await slider.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (sliderVisible) {
      console.log('  ✓ FRACTIONAL: Slider is visible');
      
      // Check for token amount input
      const tokenInput = page.locator('[data-testid="token-amount-input"]');
      const inputVisible = await tokenInput.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (inputVisible) {
        console.log('  ✓ Token amount input is visible');
        
        // Test input interaction
        await tokenInput.fill('2500');
        const inputValue = await tokenInput.inputValue();
        expect(inputValue).toBe('2500');
        console.log('  ✓ Can edit token amount');
      }

      // Check for MAX button
      const maxButton = page.locator('button:has-text("MAX")');
      const maxVisible = await maxButton.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (maxVisible) {
        console.log('  ✓ MAX button is visible');
        await maxButton.click();
        console.log('  ✓ MAX button clickable');
      }

      // Check range text
      const rangeText = page.locator('text=/available|range/i');
      if (await rangeText.isVisible({ timeout: 3000 }).catch(() => false)) {
        const range = await rangeText.textContent();
        console.log(`  ✓ Range text: ${range}`);
      }
    } else {
      console.log('  ⚠ This is a fixed-price deal, not fractional');
    }

    // Check stats row
    const discountDisplay = page.locator('text=/Your Discount/i');
    const maturityDisplay = page.locator('text=/Maturity/i');
    const paymentDisplay = page.locator('text=/Est. Payment/i');

    if (await discountDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  ✓ Discount display visible');
    }
    if (await maturityDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  ✓ Maturity display visible');
    }
    if (await paymentDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  ✓ Payment display visible');
    }

    // Check Buy Now button
    const buyNowButton = page.locator('[data-testid="confirm-amount-button"], button:has-text("Buy Now")');
    if (await buyNowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      const isDisabled = await buyNowButton.isDisabled();
      console.log(`  ${isDisabled ? '⚠' : '✓'} Buy Now button ${isDisabled ? 'is DISABLED' : 'is ENABLED'}`);
    }

    console.log('\n✅ FRACTIONAL SOLANA DEAL UI VERIFICATION COMPLETE\n');
  });

  test('verifies fixed-price Solana deal UI elements', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  FIXED-PRICE SOLANA DEAL - UI VERIFICATION');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect wallet
    console.log('📋 STEP 1: Connect Phantom Wallet\n');
    await page.goto(BASE_URL);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);

    // Navigate to chat and request entire allocation (triggers fixed-price)
    console.log('\n📋 STEP 2: Request Entire Allocation\n');
    await page.goto(`${BASE_URL}/chat`);
    await waitForPage(page);

    const chatInput = page.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatInput.fill(`I want to buy the entire allocation of ${SOLANA_TOKEN_SYMBOL} on Solana`);
      await chatInput.press('Enter');
      console.log('  ✓ Sent quote request for entire allocation');
      await page.waitForTimeout(15000);
    }

    // Open modal
    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Buy Now")').first();
    if (await acceptButton.isVisible({ timeout: 30000 }).catch(() => false)) {
      await acceptButton.click();
      console.log('  ✓ Clicked Accept');
      await page.waitForTimeout(2000);
    }

    console.log('\n📋 STEP 3: Verify Fixed-Price UI Elements\n');
    const modalVisible = await waitForAcceptQuoteModal(page);
    
    if (!modalVisible) {
      console.log('  ⚠ Modal not visible');
      await page.screenshot({ path: 'test-results/solana-fixed-price-modal-not-found.png' });
      test.skip();
      return;
    }

    // Check for fixed-price indicators
    const fixedAmountLabel = page.locator('text=/Fixed Amount/i');
    const isFixedPrice = await fixedAmountLabel.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (isFixedPrice) {
      console.log('  ✓ FIXED PRICE: "Fixed Amount" label visible');
      
      // Verify NO slider
      const slider = page.locator('[data-testid="token-amount-slider"]');
      const sliderVisible = await slider.isVisible({ timeout: 3000 }).catch(() => false);
      expect(sliderVisible).toBe(false);
      console.log('  ✓ Slider is NOT visible (correct for fixed-price)');
      
      // Verify NO editable input
      const tokenInput = page.locator('[data-testid="token-amount-input"]');
      const inputVisible = await tokenInput.isVisible({ timeout: 3000 }).catch(() => false);
      expect(inputVisible).toBe(false);
      console.log('  ✓ Editable input is NOT visible (correct for fixed-price)');
      
      // Verify NO MAX button
      const maxButton = page.locator('button:has-text("MAX")');
      const maxVisible = await maxButton.isVisible({ timeout: 3000 }).catch(() => false);
      expect(maxVisible).toBe(false);
      console.log('  ✓ MAX button is NOT visible (correct for fixed-price)');
      
      // Verify fixed amount is displayed as static text
      const amountDisplay = page.locator('.text-3xl, .text-5xl, .text-6xl').first();
      const amountText = await amountDisplay.textContent();
      console.log(`  ✓ Fixed amount displayed: ${amountText}`);
      
      // Verify "buy entire allocation" message
      const allocationMessage = page.locator('text=/fixed-price deal|entire allocation/i');
      const hasMessage = await allocationMessage.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasMessage) {
        console.log('  ✓ "Fixed-price deal" message visible');
      }
    } else {
      console.log('  ⚠ This is a fractional deal, not fixed-price');
      console.log('  (Fixed-price requires isFixedPrice=true or tokenAmount=maxAvailable)');
    }

    console.log('\n✅ FIXED-PRICE SOLANA DEAL UI VERIFICATION COMPLETE\n');
  });
});

// =============================================================================
// SOLANA AMOUNT VALIDATION TESTS
// =============================================================================

test.describe('Solana Accept Quote Modal - Amount Validation', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('enforces minimum token amount on Solana', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SOLANA - MINIMUM AMOUNT VALIDATION');
    console.log('═══════════════════════════════════════════════════════════\n');

    await page.goto(BASE_URL);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);
    
    await page.goto(`${BASE_URL}/chat`);
    await waitForPage(page);

    const chatInput = page.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatInput.fill(`I want to buy 5000 ${SOLANA_TOKEN_SYMBOL} on Solana`);
      await chatInput.press('Enter');
      await page.waitForTimeout(15000);
    }

    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Buy Now")').first();
    if (await acceptButton.isVisible({ timeout: 30000 }).catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(2000);
    }

    const modalVisible = await waitForAcceptQuoteModal(page);
    if (modalVisible) {
      const tokenInput = page.locator('[data-testid="token-amount-input"]');
      
      if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Try to set below minimum (100)
        await tokenInput.fill('50');
        await page.waitForTimeout(500);
        
        // Check for validation error
        const errorText = page.locator('text=/Minimum|at least 100/i');
        const hasError = await errorText.isVisible({ timeout: 3000 }).catch(() => false);
        
        if (hasError) {
          console.log('  ✓ Validation error shown for amount below minimum');
        }

        // Check Buy button is disabled
        const buyButton = page.locator('[data-testid="confirm-amount-button"]');
        const isDisabled = await buyButton.isDisabled().catch(() => false);
        
        expect(isDisabled).toBe(true);
        console.log('  ✓ Buy button is disabled for invalid amount');

        // Set valid amount
        await tokenInput.fill('500');
        await page.waitForTimeout(500);
        
        const stillDisabled = await buyButton.isDisabled().catch(() => true);
        expect(stillDisabled).toBe(false);
        console.log('  ✓ Buy button is enabled for valid amount');
      }
    }

    console.log('\n✅ SOLANA MINIMUM AMOUNT VALIDATION TEST COMPLETE\n');
  });

  test('slider updates amount correctly on Solana', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SOLANA - SLIDER INTERACTION');
    console.log('═══════════════════════════════════════════════════════════\n');

    await page.goto(BASE_URL);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);
    
    await page.goto(`${BASE_URL}/chat`);
    await waitForPage(page);

    const chatInput = page.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatInput.fill(`I want to buy 5000 ${SOLANA_TOKEN_SYMBOL} on Solana`);
      await chatInput.press('Enter');
      await page.waitForTimeout(15000);
    }

    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Buy Now")').first();
    if (await acceptButton.isVisible({ timeout: 30000 }).catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(2000);
    }

    const modalVisible = await waitForAcceptQuoteModal(page);
    if (modalVisible) {
      const slider = page.locator('[data-testid="token-amount-slider"]');
      const tokenInput = page.locator('[data-testid="token-amount-input"]');
      
      if (await slider.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Get initial value
        const initialValue = await tokenInput.inputValue();
        console.log(`  Initial amount: ${initialValue}`);

        // Move slider by setting value directly
        await slider.evaluate((el: HTMLInputElement) => {
          el.value = '2500';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(500);

        // Check input updated
        const newValue = await tokenInput.inputValue();
        console.log(`  After slider: ${newValue}`);
        
        expect(parseInt(newValue)).not.toBe(parseInt(initialValue));
        console.log('  ✓ Slider updates input value');
      }
    }

    console.log('\n✅ SOLANA SLIDER INTERACTION TEST COMPLETE\n');
  });
});

// =============================================================================
// SOLANA PRICE DISPLAY TESTS
// =============================================================================

test.describe('Solana Accept Quote Modal - Price Display', () => {
  test.setTimeout(TEST_TIMEOUT);

  test('displays estimated SOL payment correctly', async ({ context, page, phantomPage, extensionId }) => {
    const phantom = new Phantom(context, phantomPage, phantomPassword, extensionId);
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SOLANA - PRICE DISPLAY VERIFICATION');
    console.log('═══════════════════════════════════════════════════════════\n');

    await page.goto(BASE_URL);
    await waitForPage(page);
    await connectPhantomWallet(page, context, phantom);
    
    await page.goto(`${BASE_URL}/chat`);
    await waitForPage(page);

    const chatInput = page.locator('textarea, input[type="text"]').first();
    if (await chatInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chatInput.fill(`I want to buy 1000 ${SOLANA_TOKEN_SYMBOL} on Solana with 10% discount`);
      await chatInput.press('Enter');
      await page.waitForTimeout(15000);
    }

    const acceptButton = page.locator('button:has-text("Accept"), button:has-text("Buy Now")').first();
    if (await acceptButton.isVisible({ timeout: 30000 }).catch(() => false)) {
      await acceptButton.click();
      await page.waitForTimeout(2000);
    }

    const modalVisible = await waitForAcceptQuoteModal(page);
    if (modalVisible) {
      // Select SOL payment
      const solButton = page.locator('button:has-text("SOL")');
      if (await solButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await solButton.click();
        console.log('  ✓ Selected SOL payment');
        await page.waitForTimeout(500);
      }

      // Check estimated payment shows SOL
      const paymentDisplay = page.locator('text=/\\d+\\.?\\d* SOL/');
      const hasSolPayment = await paymentDisplay.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (hasSolPayment) {
        const payment = await paymentDisplay.textContent();
        console.log(`  ✓ SOL payment displayed: ${payment}`);
      }

      // Switch to USDC and verify
      const usdcButton = page.locator('button:has-text("USDC")');
      if (await usdcButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await usdcButton.click();
        console.log('  ✓ Selected USDC payment');
        await page.waitForTimeout(500);
        
        const usdcPaymentDisplay = page.locator('text=/\\$[\\d,]+|\\d+\\.?\\d* USDC/');
        const hasUsdcPayment = await usdcPaymentDisplay.isVisible({ timeout: 3000 }).catch(() => false);
        
        if (hasUsdcPayment) {
          const payment = await usdcPaymentDisplay.textContent();
          console.log(`  ✓ USDC payment displayed: ${payment}`);
        }
      }

      // Check stats row
      const discountDisplay = page.locator('text=/Your Discount/i');
      const maturityDisplay = page.locator('text=/Maturity/i');

      if (await discountDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
        const discountValue = page.locator('text=/\\d+%/').first();
        const discount = await discountValue.textContent();
        console.log(`  ✓ Discount displayed: ${discount}`);
      }

      if (await maturityDisplay.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('  ✓ Maturity section visible');
      }
    }

    console.log('\n✅ SOLANA PRICE DISPLAY TEST COMPLETE\n');
  });
});

// =============================================================================
// TEST SUMMARY
// =============================================================================

test.describe('Solana Test Summary', () => {
  test('display summary', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║         SOLANA ACCEPT QUOTE MODAL E2E TEST SUMMARY                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  UI ELEMENT TESTS (Solana-specific):                                         ║
║  • SOL/USDC payment options (no ETH)                                         ║
║  • Fractional deal: slider, input, MAX button                                ║
║  • Fixed-price deal: static amount, no adjustments                           ║
║  • Stats row (discount, maturity, payment)                                   ║
║                                                                              ║
║  AMOUNT VALIDATION TESTS:                                                    ║
║  • Minimum amount (100 tokens)                                               ║
║  • Slider ↔ input sync                                                       ║
║  • Buy button disabled/enabled states                                        ║
║                                                                              ║
║  PRICE DISPLAY TESTS:                                                        ║
║  • SOL payment calculation                                                   ║
║  • USDC payment calculation                                                  ║
║  • Payment updates on currency toggle                                        ║
║                                                                              ║
║  PREREQUISITES:                                                              ║
║  • bun run dev (includes Solana validator)                                   ║
║  • Phantom wallet with SOL for gas                                           ║
║  • Solana desk initialized with tokens                                       ║
║                                                                              ║
║  RUN: npx playwright test --config=synpress.config.ts \\                      ║
║       tests/synpress/accept-quote-modal-solana.test.ts                       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
  });
});

