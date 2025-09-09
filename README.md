## Eliza OTC Desk Agent

Production-ready starter that demonstrates an Eliza agent negotiating OTC token deals as a discount from spot for 1–52 week lockups. It includes a modern Next.js app, a negotiation agent, local smart contracts, and end‑to‑end workflows from quote to on‑chain acceptance.

### Highlights
- **Agent negotiation**: Discount-from-spot quotes (2%–25%) with 1–52w lockups
- **Eliza plugin architecture**: Purpose-built OTC Desk plugin with actions
- **On-chain demo**: Local Hardhat network and OTC contracts
- **Web3 UI**: Wallet connect, quote views, and acceptance flows
- **Robust backend**: API routes, background worker, and persistence (Drizzle)
- **Testing**: Cypress E2E plus unit tests

## What’s inside
- `src/lib/agent.ts`: Eliza character, style, and negotiation examples (uses REPLY and CREATE_OTC_QUOTE)
- `src/lib/plugin-otc-desk`: Provider graph, quote logic, actions, and helpers
- `src/app/api/*`: HTTP endpoints for quotes, notifications, health checks, workers, etc.
- `contracts`: Hardhat project with local OTC contracts and deploy scripts
- `drizzle/*`: Schema and migrations (Drizzle ORM)

## Goals
- Showcase an opinionated, production-grade pattern for agent-driven negotiation
- Keep user experience fast, resilient, and clear (short responses, focused on deals)
- Demonstrate safe handling of trolling/prompt injection while steering back to the deal
- Provide a complete local workflow: chat → quote → accept → background processing

## Prerequisites
- Node.js 18+ (or Bun)
- Docker (optional; for local Postgres via `scripts/start-postgres.sh`)
- No global Hardhat install required (handled via `npx`)

## Quick start
```bash
git clone <your-repo-url>
cd eliza-nextjs-starter
npm install

# (Optional) set Postgres URL or start local Postgres
# export POSTGRES_URL=postgres://eliza:password@localhost:5439/eliza
# ./scripts/start-postgres.sh

# Prepare database (Drizzle)
npm run db:push

# Start local chain and the app
npm run rpc:start        # starts Hardhat at 127.0.0.1:8545
npm run rpc:deploy       # deploys OTC contracts to local chain
npm run dev              # starts Next.js on http://localhost:2222
```

Open the app at `http://localhost:2222`.

## Environment
Create `.env.local` and set only what you need. Common options:

```env
# App
NEXT_PUBLIC_NODE_ENV=development
NEXT_TELEMETRY_DISABLED=true

# Agent/LLM providers (as needed by your plugins)
GROQ_API_KEY=your-groq-api-key

# Database (optional; falls back to defaults if unset)
POSTGRES_URL=postgres://eliza:password@localhost:5439/eliza
POSTGRES_DEV_PORT=5439
```

## How it works
1. You chat with the agent in the UI.
2. The agent replies concisely and, when appropriate, emits `CREATE_OTC_QUOTE`.
3. Quote providers compute a discount band from spot given lockup (1–52w).
4. The UI shows the quote; you can accept on-chain via the local OTC contract.
5. A background worker (`quoteApprovalWorker`) monitors and finalizes deal flow.

### Architecture (high level)
```
[Next.js UI] → [API Routes] → [Agent Runtime + OTC Plugin] → [Quote Providers]
      ↓                                                             ↑
  [Wallet/Wagmi] → [OTC Contract on Hardhat] ← [Worker + DB]
```

## Useful scripts
- `npm run dev`: Next.js dev on 2222 and local chain via `dev:full`
- `npm run rpc:start`: Start Hardhat node
- `npm run rpc:deploy`: Deploy OTC contracts to local chain
- `npm run db:push`: Apply Drizzle schema
- `npm run db:studio`: Drizzle Studio
- `npm run worker:start`: Start the quote approval worker
- `npm run test`: Unit tests (Vitest)
- `npm run cypress:run`: E2E tests

Convenience: `./scripts/run-otc-desk.sh` starts the full local stack and prints URLs/logs.

## Testing
```bash
npm run test           # unit tests
npm run cypress:run    # E2E tests
```

## Troubleshooting
- App builds but APIs fail: ensure local chain is running and contracts are deployed (`rpc:start`, `rpc:deploy`).
- DB errors: run `npm run db:push` and verify `POSTGRES_URL` or use the included SQLite/Drizzle defaults.
- Quotes look off: confirm you’re using week-based lockups (1–52w) and discounts (not APR).

## Production
```bash
npm run build
npm start   # serves on port 2222 by default
```
Deploy to your platform of choice (Vercel, Netlify, etc.). Provide production env vars (DB, provider keys, etc.).

## License
MIT

---

Built for agent-driven OTC deal flows with ElizaOS and a clean Next.js app.