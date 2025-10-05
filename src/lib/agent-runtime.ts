// Serverless-compatible agent runtime with Drizzle ORM for Next.js
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
// DO NOT replace with an agent-simple.ts, it won't work!
import { AgentRuntime, ChannelType, EventType, Memory, elizaLogger, stringToUuid } from "@elizaos/core";
import {
  db,
  messages,
  rooms,
} from "../db";
import agent from "./agent";

const globalAny = globalThis as any;
if (typeof globalAny.__elizaMigrationsRan === "undefined")
  globalAny.__elizaMigrationsRan = false;
if (typeof globalAny.__elizaManagerLogged === "undefined")
  globalAny.__elizaManagerLogged = false;

async function tableExists(table: string): Promise<boolean> {
  try {
    const res = await (db as any).execute?.(
      sql.raw(`SELECT to_regclass('public.${table}') IS NOT NULL AS exists`),
    );
    const rows = (res as any)?.rows;
    return !!rows?.[0]?.exists;
  } catch {
    return false;
  }
}

class AgentRuntimeManager {
  private static instance: AgentRuntimeManager;
  public runtime: AgentRuntime | null = null;
  private hasRunMigrations = false;

  private constructor() {
    // Configure the elizaLogger to use console
    if (elizaLogger) {
      elizaLogger.log = console.log.bind(console);
      elizaLogger.info = console.info.bind(console);
      elizaLogger.warn = console.warn.bind(console);
      elizaLogger.error = console.error.bind(console);
      elizaLogger.debug = console.debug.bind(console);
      elizaLogger.success = (msg: string) => console.log(`✓ ${msg}`);
      (elizaLogger as any).notice = console.info.bind(console);
    }

    // Also configure global console if needed
    if (typeof globalThis !== "undefined" && !globalAny.logger) {
      globalAny.logger = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
      };
    }

    if (!globalAny.__elizaManagerLogged) {
      // Silence noisy init log; keep flag to avoid repeated work
      globalAny.__elizaManagerLogged = true;
    }
  }

  public static getInstance(): AgentRuntimeManager {
    if (!AgentRuntimeManager.instance) {
      AgentRuntimeManager.instance = new AgentRuntimeManager();
    }
    return AgentRuntimeManager.instance;
  }

  public isReady(): boolean {
    return true;
  }

  // Helper method to get or create the runtime instance
  async getRuntime(): Promise<AgentRuntime> {
    if (!this.runtime) {
      // Reuse a cached singleton runtime across warm invocations
      if ((globalThis as any).__elizaRuntime) {
        this.runtime = (globalThis as any).__elizaRuntime as AgentRuntime;
        return this.runtime;
      }

      // Initialize runtime without database adapter - we handle persistence separately
      this.runtime = new AgentRuntime({
        ...agent,
        settings: {
          GROQ_API_KEY: process.env.GROQ_API_KEY,
          SMALL_GROQ_MODEL:
            process.env.SMALL_GROQ_MODEL || "llama-3.1-8b-instant",
          LARGE_GROQ_MODEL:
            process.env.LARGE_GROQ_MODEL || "llama-3.1-8b-instant",
          ...agent.character.settings,
        },
        // adapter is optional - we're managing persistence through Drizzle
      } as any);

      // Cache globally for reuse in warm container
      (globalThis as any).__elizaRuntime = this.runtime;

      // Ensure runtime has a logger with all required methods
      if (!this.runtime.logger || !this.runtime.logger.log) {
        this.runtime.logger = {
          log: console.log.bind(console),
          info: console.info.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
          debug: console.debug.bind(console),
          success: (message: string) => console.log(`✓ ${message}`),
          notice: console.info.bind(console),
        } as any;
      }

      // Ensure SQL plugin built-in tables exist (idempotent)
      try {
        await this.ensureBuiltInTables();
      } catch (migrationError) {
        console.warn(
          "[AgentRuntime] Built-in table migration warning:",
          migrationError,
        );
      }

      // Try to initialize, but continue if there are DB-related errors
      try {
        await this.runtime.initialize();
      } catch (error) {
        console.warn("Runtime initialization warning:", error);
        // Continue anyway - some initialization errors are expected without full DB
      }
    }
    return this.runtime;
  }

  private async ensureBuiltInTables(): Promise<void> {
    if (this.hasRunMigrations || (globalThis as any).__elizaMigrationsRan)
      return;
    try {
      // Try to ensure pgvector extension exists (if available)
      try {
        await (db as any).execute?.(
          sql.raw("CREATE EXTENSION IF NOT EXISTS vector"),
        );
      } catch (extErr) {
        console.warn(
          "[AgentRuntime] Could not create pgvector extension (may not be installed):",
          extErr,
        );
      }

      // Ensure core app tables exist (idempotent)
      try {
        await (db as any).execute?.(
          sql.raw(`
          CREATE TABLE IF NOT EXISTS rooms (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            title text,
            last_message_at timestamp,
            created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `),
        );
        await (db as any).execute?.(
          sql.raw(`
          CREATE TABLE IF NOT EXISTS messages (
            id text PRIMARY KEY,
            conversation_id text NOT NULL REFERENCES rooms(id),
            user_id text NOT NULL,
            agent_id text,
            content text NOT NULL,
            is_agent boolean DEFAULT false NOT NULL,
            created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
          )
        `),
        );
      } catch (coreErr) {
        console.warn(
          "[AgentRuntime] Failed ensuring core tables (rooms/messages):",
          coreErr,
        );
      }

      // Run plugin migrations only when a compatible database adapter is detected.
      // The @elizaos/plugin-sql package also self-manages migrations when its adapter is registered,
      // so we skip our manual path when running with libsql/SQLite or when no execute method exists.
      try {
        const hasExecute = typeof (db as any)?.execute === "function";
        const usingSqlite =
          process.env.DRIZZLE_SQLITE === "true" || process.env.USE_SQLITE === "true";
        if (hasExecute && !usingSqlite) {
          const { DatabaseMigrationService } = await import("@elizaos/plugin-sql");
          const migrationService = new DatabaseMigrationService();
          await migrationService.initializeWithDatabase(db as unknown as any);
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - plugin typing is not critical here
          migrationService.discoverAndRegisterPluginSchemas(agent.plugins || []);
          await migrationService.runAllPluginMigrations();
          console.log(
            "[AgentRuntime] Ensured built-in plugin tables via migrations",
          );
        } else {
          console.log(
            "[AgentRuntime] Skipping manual plugin migrations (adapter will self-manage or not compatible)",
          );
        }
      } catch (pluginMigErr) {
        console.warn(
          "[AgentRuntime] Plugin migration step skipped due to adapter constraints:",
          pluginMigErr,
        );
      }

      // Ensure app tables (quotes, user_sessions) exist (idempotent)
      try {
        // quotes table
        if (!(await tableExists("quotes"))) {
          await (db as any).execute?.(
            sql.raw(`
            CREATE TABLE IF NOT EXISTS quotes (
              id text PRIMARY KEY,
              quote_id text UNIQUE NOT NULL,
              user_id text NOT NULL,
              beneficiary text,
              token_amount text NOT NULL,
              discount_bps integer NOT NULL,
              apr real NOT NULL,
              lockup_months integer NOT NULL,
              lockup_days integer NOT NULL,
              payment_currency text NOT NULL,
              price_usd_per_token real NOT NULL,
              total_usd real NOT NULL,
              discount_usd real NOT NULL,
              discounted_usd real NOT NULL,
              payment_amount text NOT NULL,
              status text NOT NULL DEFAULT 'active',
              signature text,
              created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
              expires_at timestamp NOT NULL,
              executed_at timestamp,
              rejected_at timestamp,
              approved_at timestamp,
              offer_id text,
              transaction_hash text,
              block_number integer,
              rejection_reason text,
              approval_note text
            )
          `),
          );
        }

        // user_sessions table
        if (!(await tableExists("user_sessions"))) {
          await (db as any).execute?.(
            sql.raw(`
            CREATE TABLE IF NOT EXISTS user_sessions (
              id text PRIMARY KEY,
              user_id text UNIQUE NOT NULL,
              wallet_address text,
              quotes_created integer NOT NULL DEFAULT 0,
              last_quote_at timestamp,
              daily_quote_count integer NOT NULL DEFAULT 0,
              daily_reset_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
              total_deals integer NOT NULL DEFAULT 0,
              total_volume_usd real NOT NULL DEFAULT 0,
              total_saved_usd real NOT NULL DEFAULT 0,
              created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
              updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
            )
          `),
          );
        }
      } catch (appTableErr) {
        console.warn(
          "[AgentRuntime] Failed ensuring app tables (quotes/user_sessions):",
          appTableErr,
        );
      }

      this.hasRunMigrations = true;
      (globalThis as any).__elizaMigrationsRan = true;
    } catch (error) {
      console.warn(
        "[AgentRuntime] Failed to ensure built-in plugin tables:",
        error,
      );
      // Fallback: minimally ensure agents table exists to allow runtime init to proceed
      try {
        await (db as any).execute?.(
          sql.raw(`
          CREATE TABLE IF NOT EXISTS agents (
            id uuid PRIMARY KEY,
            name text NOT NULL,
            bio jsonb
          )
        `),
        );
      } catch (fallbackError) {
        console.warn(
          "[AgentRuntime] Fallback agents table creation failed:",
          fallbackError,
        );
      }
    }
  }

  // Helper method to handle messages
  public async handleMessage(
    roomId: string,
    userId: string,
    content: { text?: string; attachments?: any[] },
    agentId?: string,
    clientMessageId?: string,
  ): Promise<Memory> {
    // store raw input; display sanitization occurs in providers

    // Get the runtime instance
    const runtime = await this.getRuntime();

    await runtime.ensureRoomExists({
      id: roomId as `${string}-${string}-${string}-${string}-${string}`,
      source: "web",
      type: ChannelType.DM,
      channelId: roomId,
      serverId: "otc-desk-server",
      worldId: stringToUuid("otc-desk-world"),
      agentId: runtime.agentId,
    });

    console.log("Room exists for sure now:", roomId);

    // Create user message
    const userMessage: Memory = {
      roomId: roomId as `${string}-${string}-${string}-${string}-${string}`,
      entityId: userId as `${string}-${string}-${string}-${string}-${string}`,
      agentId: (agentId || stringToUuid("otc-desk-agent")) as `${string}-${string}-${string}-${string}-${string}`,
      content: {
        text: content.text || "",
        attachments: content.attachments || [],
      },
    };

    // Store user message in database
    console.log("[AgentRuntime] Inserting user message:", userMessage);
    let insertedUserMessage;
    try {
      const result = await db.insert(messages).values(userMessage).returning();
      insertedUserMessage = result[0];
      console.log(
        "[AgentRuntime] User message inserted:",
        insertedUserMessage?.id,
      );
    } catch (error) {
      console.error("[AgentRuntime] Error inserting user message:", error);
      throw error;
    }

    // Emit MESSAGE_RECEIVED and delegate handling to plugins
    console.log("[AgentRuntime] Emitting MESSAGE_RECEIVED event to plugins");

    let agentResponded = false;
    await runtime.emitEvent(EventType.MESSAGE_RECEIVED, {
      runtime,
      message: {
        id: userMessage.id,
        content: {
          text: content.text || "",
          attachments: content.attachments || [],
        },
        userId,
        agentId: runtime.agentId,
        roomId: roomId,
        createdAt: Date.now(),
      },
      callback: async (result: { text?: string; attachments?: any[] }) => {
        const responseText = result?.text || "";

        const agentMessage: Memory = {
          id: uuidv4() as `${string}-${string}-${string}-${string}-${string}`,
          roomId: roomId as `${string}-${string}-${string}-${string}-${string}`,
          entityId: stringToUuid("otc-desk-agent") as `${string}-${string}-${string}-${string}-${string}`,
          agentId: runtime.agentId as `${string}-${string}-${string}-${string}-${string}`,
          content: {
            text: responseText,
            type: "agent",
          },
        };

        try {
          console.log(
            "[AgentRuntime] Inserting agent message:",
            agentMessage.id,
          );
          await db.insert(messages).values(agentMessage);
          console.log("[AgentRuntime] Agent message inserted successfully");
          agentResponded = true;
        } catch (error) {
          console.error(
            "[AgentRuntime] Error inserting agent message:",
            error,
          );
        }

        try {
          await db
            .update(rooms)
            .set({ lastMessageAt: new Date(), updatedAt: new Date() })
            .where(eq(rooms.id, roomId));
          console.log("[AgentRuntime] Updated conversation timestamp");
        } catch (error) {
          console.error("[AgentRuntime] Error updating conversation:", error);
        }
      },
    });

    return insertedUserMessage;
  }

  // Get messages for a conversation
  public async getConversationMessages(
    roomId: string,
    limit = 50,
    afterTimestamp?: number,
  ): Promise<Memory[]> {
    const baseWhere = eq(messages.roomId, roomId);
    const whereClause = afterTimestamp
      ? and(baseWhere, gte(messages.createdAt, new Date(afterTimestamp)))
      : baseWhere;

    const results = await db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(asc(messages.createdAt))
      .limit(limit);

    return results; // Already chronological
  }

  // Create a new conversation
  public async createConversation(userId: string): Promise<string> {
    const roomId = uuidv4();

    const newConversation = {
      id: roomId,
      userId,
      title: "New Conversation",
    };

    await db.insert(rooms).values(newConversation);

    return roomId;
  }

  // Get user's rooms
  public async getUserConversations(userId: string): Promise<Memory[]> {
    const userConversations = await db
      .select()
      .from(rooms)
      .where(eq(rooms.userId, userId))
      .orderBy(
        desc(rooms.lastMessageAt),
        desc(rooms.createdAt),
      );

    return userConversations;
  }

  public async getConversation(
    roomId: string,
  ): Promise<Memory | undefined> {
    const [conversation] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId));

    return conversation;
  }
}

// Export singleton instance
export const agentRuntime = AgentRuntimeManager.getInstance();
