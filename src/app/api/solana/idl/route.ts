import { NextResponse } from "next/server";
import idl from "../../../../contracts/solana-otc.idl.json";

export function GET() {
  return NextResponse.json(idl);
}
