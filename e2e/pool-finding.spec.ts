import { test, expect } from '@playwright/test';
import { findBestPool, CONFIG } from '../src/utils/pool-finder-base';

test('pool finding works correctly for known tokens', async () => {
  console.log('\n🔍 Testing Pool Finder Integration\n');
  
  // Test Case 1: High liquidity token on Base (Virtual Protocol)
  // 0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b
  const tokenAddress = "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b";
  const chainId = 8453;
  
  console.log(`   Searching for pools for token ${tokenAddress} on Chain ${chainId}...`);
  
  try {
    const pool = await findBestPool(tokenAddress, chainId);
    
    if (pool) {
      console.log("   ✅ Best pool found:");
      console.log(`      Protocol: ${pool.protocol}`);
      console.log(`      Address: ${pool.address}`);
      console.log(`      Base Token: ${pool.baseToken}`);
      console.log(`      TVL (USD): $${Math.floor(pool.tvlUsd).toLocaleString()}`);
      
      expect(pool).toBeDefined();
      expect(pool.protocol).toBeDefined();
      expect(pool.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(pool.tvlUsd).toBeGreaterThan(0);
    } else {
      console.log("   ⚠️  No pool found (unexpected for high liquidity token)");
      // We expect to find a pool for this token
      expect(pool).toBeDefined(); 
    }
  } catch (error) {
    console.error("   ❌ Error finding pool:", error);
    // Fail test if pool finder crashes
    expect(error).toBeUndefined();
  }
});
