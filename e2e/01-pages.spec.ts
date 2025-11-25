/**
 * Page Load and Navigation Tests
 * Tests all pages can load and basic navigation works
 */

import { test, expect } from '@playwright/test';

// Set a desktop viewport for all tests to ensure consistent behavior
test.use({ viewport: { width: 1280, height: 720 } });

// Helper to wait for page to be interactive
async function waitForPageReady(page: ReturnType<typeof test.extend>) {
  await page.waitForLoadState('domcontentloaded');
  // Give dynamic components time to hydrate
  await page.waitForTimeout(1000);
}

test.describe('Page Load Tests', () => {
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    await expect(page).toHaveTitle(/OTC/i);
    
    // Should show marketplace header
    await expect(page.getByRole('heading', { name: /OTC Marketplace/i })).toBeVisible({ timeout: 20000 });
    
    // Should show search filter (desktop viewport has the md:flex visible)
    await expect(page.getByPlaceholder(/search tokens/i).first()).toBeVisible({ timeout: 15000 });
    
    // Should show connect button or open menu button
    const hasConnectOrMenu = await page.locator('button:has-text("Connect"), button[aria-label*="menu"]').first().isVisible({ timeout: 10000 }).catch(() => false);
    expect(hasConnectOrMenu).toBe(true);
  });

  test('/how-it-works loads correctly', async ({ page }) => {
    await page.goto('/how-it-works');
    await waitForPageReady(page);
    
    // Should show heading with "Simple, transparent, on-chain" text
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Simple, transparent, on-chain')).toBeVisible({ timeout: 10000 });
    
    // Should show step cards
    await expect(page.locator('text=Connect your wallet')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Negotiate a deal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Buy and hold')).toBeVisible({ timeout: 10000 });
  });

  test('/consign loads correctly', async ({ page }) => {
    await page.goto('/consign');
    await waitForPageReady(page);
    
    // Should show form heading
    await expect(page.getByRole('heading', { name: /List Your Tokens/i })).toBeVisible({ timeout: 15000 });
    
    // Should show progress steps (use exact match to avoid multiple matches)
    const progressSteps = page.locator('span').filter({ hasText: /^Token$|^Amount$|^Review$/ });
    const count = await progressSteps.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('/my-deals loads correctly', async ({ page }) => {
    await page.goto('/my-deals');
    await waitForPageReady(page);
    
    // Should show heading (use locator for more flexibility)
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
    
    // Page should contain either tabs or a connect prompt
    const pageText = await page.textContent('body');
    const hasExpectedContent = pageText?.includes('My Deals') || 
                               pageText?.includes('Purchases') || 
                               pageText?.includes('Listings') ||
                               pageText?.includes('Connect');
    expect(hasExpectedContent).toBe(true);
  });

  test('/privacy loads correctly', async ({ page }) => {
    await page.goto('/privacy');
    await waitForPageReady(page);
    
    // Should show privacy policy content
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=/privacy/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('/terms loads correctly', async ({ page }) => {
    await page.goto('/terms');
    await waitForPageReady(page);
    
    // Should show terms heading
    await expect(page.getByRole('heading', { name: /Terms of Service/i })).toBeVisible({ timeout: 15000 });
    
    // Should have content
    await expect(page.getByText(/Effective Date/i)).toBeVisible({ timeout: 10000 });
  });

  test('navigation between pages works', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Navigate to How It Works
    await page.getByRole('link', { name: /How It Works/i }).click();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/how-it-works/);
    
    // Navigate to My Deals
    await page.getByRole('link', { name: /My Deals/i }).click();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/my-deals/);
    
    // Navigate back to Trading Desk (home)
    await page.getByRole('link', { name: /Trading Desk/i }).click();
    await waitForPageReady(page);
    await expect(page).toHaveURL(/^https?:\/\/[^\/]+\/?$/);
  });

  test('responsive design - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
    await page.goto('/');
    await waitForPageReady(page);
    
    // Page should load - check for OTC Marketplace heading (present on all viewports)
    await expect(page.getByRole('heading', { name: /OTC Marketplace/i })).toBeVisible({ timeout: 20000 });
    
    // Mobile has filter buttons (the mobile filter bar with chain selector and type toggles)
    // Note: There are two search inputs - desktop (hidden) and mobile (visible)
    // Use :visible pseudo-class to get the actually visible one
    const visibleSearchInput = page.locator('input[placeholder*="Search tokens"]:visible');
    await expect(visibleSearchInput).toBeVisible({ timeout: 15000 });
  });

  test('responsive design - tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto('/');
    await waitForPageReady(page);
    
    // Page should load - check for OTC Marketplace heading
    await expect(page.getByRole('heading', { name: /OTC Marketplace/i })).toBeVisible({ timeout: 20000 });
    
    // Desktop filter bar should be visible at tablet width (768px = md breakpoint)
    await expect(page.getByPlaceholder(/search tokens/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('404 page handling', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist-12345');
    
    // Next.js should handle 404s gracefully
    // Either show 404 page or redirect
    expect(response?.status()).toBeLessThan(500);
  });
});

test.describe('Footer Links', () => {
  test('footer contains legal links', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    
    // Wait for page to fully render
    await page.waitForTimeout(2000);
    
    // Check for footer presence
    const footer = page.locator('footer');
    await expect(footer).toBeVisible({ timeout: 15000 });
    
    // Footer should have Terms and Privacy links
    await expect(page.locator('a[href="/terms"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('a[href="/privacy"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('terms page is accessible via direct navigation', async ({ page }) => {
    // Footer links open in new tab (target="_blank"), so test direct navigation
    await page.goto('/terms');
    await waitForPageReady(page);
    
    await expect(page).toHaveURL(/terms/);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
  });

  test('privacy page is accessible via direct navigation', async ({ page }) => {
    // Footer links open in new tab (target="_blank"), so test direct navigation
    await page.goto('/privacy');
    await waitForPageReady(page);
    
    await expect(page).toHaveURL(/privacy/);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
  });
});
