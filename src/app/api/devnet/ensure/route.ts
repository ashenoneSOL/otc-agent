import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";

async function readAddressFromFile(root: string): Promise<string> {
  const raw = await fs.readFile(
    path.join(
      root,
      "contracts/ignition/deployments/chain-31337/deployed_addresses.json",
    ),
    "utf8",
  );
  const json = JSON.parse(raw);
  const addr =
    json["OTCModule#OTC"] ||
    json["OTCDeskModule#OTC"] ||
    json["ElizaOTCModule#ElizaOTC"] ||
    json["OTCModule#desk"];
  if (!addr) throw new Error("No OTC address found in deployment file");
  return addr;
}

export async function POST() {
  const override = process.env.NEXT_PUBLIC_OTC_ADDRESS;
  if (override) return NextResponse.json({ address: override });

  const root = process.cwd();
  const addr = await readAddressFromFile(root);
  return NextResponse.json({ address: addr });
}
