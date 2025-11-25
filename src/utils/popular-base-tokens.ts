/**
 * Popular Base tokens for wallet scanning
 * No API key needed - just check balances for these well-known tokens
 */

export interface PopularToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

export const POPULAR_BASE_TOKENS: PopularToken[] = [
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
  },
  {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/2518/standard/weth.png",
  },
  {
    address: "0xea17Df5Cf6D172224892B5477A16ACb111182478",
    symbol: "elizaOS",
    name: "elizaOS",
    decimals: 9,
    logoUrl:
      "https://assets.coingecko.com/coins/images/43976/standard/eliza.png",
  },
  {
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    symbol: "DEGEN",
    name: "Degen",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/34515/standard/degen.png",
  },
  {
    address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
    symbol: "HIGHER",
    name: "Higher",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/36167/standard/higher.png",
  },
  {
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    symbol: "BRETT",
    name: "Brett",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/35755/standard/BRETT.png",
  },
  {
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/9956/standard/Badge_Dai.png",
  },
  {
    address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    symbol: "USDbC",
    name: "USD Base Coin",
    decimals: 6,
    logoUrl: "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
  },
  {
    address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
    symbol: "wstETH",
    name: "Wrapped liquid staked Ether",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/18834/standard/wstETH.png",
  },
  {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH",
    name: "Coinbase Wrapped Staked ETH",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/27008/standard/cbeth.png",
  },
  {
    address: "0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c",
    symbol: "rETH",
    name: "Rocket Pool ETH",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/20764/standard/reth.png",
  },
  {
    address: "0x417Ac0e078398C154EdFadD9Ef675d30Be60Af93",
    symbol: "crvUSD",
    name: "Curve.Fi USD Stablecoin",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/30118/standard/crvusd.png",
  },
  {
    address: "0xfA980cEd6895AC314E7dE34Ef1bFAE90a5AdD21b",
    symbol: "PRIME",
    name: "Prime",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/29053/standard/PRIMELOGOOO.png",
  },
  {
    address: "0x3e7eF8f50246f725885102E8238CBba33F276747",
    symbol: "BOND",
    name: "BarnBridge",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/12811/standard/barnbridge.jpg",
  },
  {
    address: "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b",
    symbol: "tBTC",
    name: "tBTC",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/11224/standard/tBTC.png",
  },
  {
    address: "0x78a087d713Be963Bf307b18F2Ff8122EF9A63ae9",
    symbol: "BSWAP",
    name: "Baseswap",
    decimals: 18,
  },
  {
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    symbol: "TOSHI",
    name: "Toshi",
    decimals: 18,
    logoUrl:
      "https://assets.coingecko.com/coins/images/31188/standard/toshi.png",
  },
  {
    address: "0x7c6b91D9Be155A6Db01f749217d76fF02A7227F2",
    symbol: "MIGGLES",
    name: "Miggles",
    decimals: 18,
  },
  {
    address: "0x5fFD0B2268a6822c5611d1E3f7f8279c6085c501",
    symbol: "MOCHI",
    name: "Mochi",
    decimals: 18,
  },
  {
    address: "0x18dD5B087bCA9920562aFf7A0199b96B9230438b",
    symbol: "NORMIE",
    name: "Normie",
    decimals: 9,
  },
];

/**
 * Get token info by address
 */
export function getTokenByAddress(address: string): PopularToken | undefined {
  return POPULAR_BASE_TOKENS.find(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
}

/**
 * Check if address is a known popular token
 */
export function isPopularToken(address: string): boolean {
  return POPULAR_BASE_TOKENS.some(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
}
