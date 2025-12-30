#!/usr/bin/env bun

/**
 * Migration fix script
 *
 * Fixes inconsistent migration state in the database by:
 * 1. Dropping all Eliza system tables (they will be recreated fresh)
 * 2. Resetting the migration tracker for @elizaos/plugin-sql
 * 3. Allowing the system to create tables from scratch
 *
 * Usage: bun scripts/fix-migrations.ts
 */

import dotenv from "dotenv";
import pg from "pg";

// Load env
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const port = process.env.POSTGRES_DEV_PORT || process.env.VENDOR_OTC_DESK_DB_PORT || 5439;
const DEFAULT_POSTGRES_URL = `postgres://eliza:password@localhost:${port}/eliza`;

let postgresUrl: string;
if (process.env.DATABASE_POSTGRES_URL) {
  postgresUrl = process.env.DATABASE_POSTGRES_URL;
} else if (process.env.DATABASE_URL_UNPOOLED) {
  postgresUrl = process.env.DATABASE_URL_UNPOOLED;
} else if (process.env.POSTGRES_URL) {
  postgresUrl = process.env.POSTGRES_URL;
} else if (process.env.POSTGRES_DATABASE_URL) {
  postgresUrl = process.env.POSTGRES_DATABASE_URL;
} else {
  postgresUrl = DEFAULT_POSTGRES_URL;
}

if (!postgresUrl) {
  throw new Error(
    "Database URL is required. Set one of: DATABASE_POSTGRES_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL, or POSTGRES_DATABASE_URL",
  );
}

const isRemote = !postgresUrl.includes("localhost") && !postgresUrl.includes("127.0.0.1");

console.log(`🔧 Migration Fix Script (Nuclear Reset)`);
console.log(`📍 Database: ${isRemote ? "Remote (Vercel/Neon)" : `Local (port ${port})`}`);
console.log("");

async function main() {
  const pool = new pg.Pool({
    connectionString: postgresUrl,
    ssl: isRemote ? { rejectUnauthorized: false } : false,
    max: 1,
  });

  const client = await pool.connect();

  // Step 1: Reset migration tracker for plugin-sql
  console.log("1️⃣  Resetting migration tracker...");

  const migrationSchemaResult = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'migrations'
    `);

  if (migrationSchemaResult.rows.length > 0) {
    console.log("   migrations schema exists, clearing all entries...");
    await client.query(
      `DELETE FROM migrations._migrations WHERE plugin_name = '@elizaos/plugin-sql'`,
    );
    await client.query(`DELETE FROM migrations._journal WHERE plugin_name = '@elizaos/plugin-sql'`);
    await client.query(
      `DELETE FROM migrations._snapshots WHERE plugin_name = '@elizaos/plugin-sql'`,
    );
    console.log("   Cleared @elizaos/plugin-sql migration history");
  } else {
    console.log("   migrations schema does not exist (will be created on first run)");
  }

  // Step 2: Drop ALL Eliza system tables (they will be recreated fresh)
  console.log("\n2️⃣  Dropping Eliza system tables (will be recreated fresh)...");

  // These are the Eliza plugin-sql tables - drop in correct order for FK constraints
  const elizaTables = [
    "embeddings",
    "logs",
    "memories",
    "participants",
    "components",
    "tasks",
    "relationships",
    "channel_participants",
    "central_messages",
    "channels",
    "rooms",
    "entities",
    "worlds",
    "message_server_agents",
    "server_agents",
    "message_servers",
    "agents",
    "cache",
  ];

  for (const table of elizaTables) {
    const tableExists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (tableExists.rows.length > 0) {
      console.log(`   Dropping ${table}...`);
      await client.query(`DROP TABLE IF EXISTS public.${table} CASCADE`);
    }
  }
  console.log("   Done dropping Eliza tables");

  // Step 3: Drop orphaned indexes
  console.log("\n3️⃣  Checking for orphaned indexes...");

  const indexesResult = await client.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND (indexname LIKE '%server_agents%' 
             OR indexname LIKE '%eliza%'
             OR indexname LIKE 'idx_memories%'
             OR indexname LIKE 'idx_participants%'
             OR indexname LIKE 'idx_relationships%'
             OR indexname LIKE 'idx_embedding%'
             OR indexname LIKE 'idx_fragments%')
    `);

  if (indexesResult.rows.length > 0) {
    console.log(`   Found ${indexesResult.rows.length} index(es) to drop:`);
    for (const idx of indexesResult.rows) {
      console.log(`   - ${idx.indexname}`);
      await client.query(`DROP INDEX IF EXISTS public."${idx.indexname}" CASCADE`);
    }
  } else {
    console.log("   No orphaned indexes found");
  }

  // Step 4: Check what OTC tables remain (these are OUR tables, not Eliza's)
  console.log("\n4️⃣  Checking OTC application tables...");

  const otcTables = ["tokens", "consignments", "purchases", "quotes", "user_sessions"];
  for (const table of otcTables) {
    const tableExists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (tableExists.rows.length > 0) {
      const countResult = await client.query(`SELECT COUNT(*) as count FROM public.${table}`);
      const count = parseInt(countResult.rows[0].count, 10);
      console.log(`   ${table}: ${count} rows (preserved)`);
    } else {
      console.log(`   ${table}: does not exist`);
    }
  }

  console.log("\n✅ Migration fix complete");
  console.log("   All Eliza tables dropped - they will be recreated on next startup.");
  console.log("   Your OTC application data (tokens, consignments, etc.) has been preserved.");
  console.log("   Run your development server again to apply migrations cleanly.");

  client.release();
  await pool.end();
}

main();
