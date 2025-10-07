import { NextResponse } from "next/server";
import { agentRuntime } from "../../../lib/agent-runtime";

export async function GET() {
  const isReady = agentRuntime.isReady();

  return NextResponse.json({
    pong: true,
    status: "ok",
    agentReady: isReady,
    timestamp: new Date().toISOString(),
    environment: {
      hasGroqKey: !!process.env.GROQ_API_KEY,
      database: "Postgres",
    },
  });
}
