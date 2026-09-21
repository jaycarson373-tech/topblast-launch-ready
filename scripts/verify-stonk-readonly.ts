// Uses the production instruction builder but never persists a launch, signs or broadcasts.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { StonkFunAdapter } from "../lib/venue/stonkfun-adapter";
import { simulateStonkLaunch } from "../lib/solana/stonk-launchlab";

async function main() {
  const creatorWallet = process.argv[2];
  if (!creatorWallet) throw new Error("Usage: pnpm exec tsx scripts/verify-stonk-readonly.ts CREATOR_PUBLIC_ADDRESS");
  process.env.SOLANA_RPC_URL ??= "https://api.mainnet-beta.solana.com";
  // Random public bytes only. No corresponding secret key is generated or held.
  let mint = new PublicKey(randomBytes(32));
  while (!PublicKey.isOnCurve(mint.toBytes())) mint = new PublicKey(randomBytes(32));
  const quoteMint = process.env.STONK_QUOTE_MINT ?? "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
  const config = await new StonkFunAdapter().getCreationConfig(quoteMint);
  const { prepared } = await simulateStonkLaunch({ creatorWallet, launchMint: mint.toBase58(), venue: "stonkfun", isTest: true,
    name: "TopBlast Stonk Test", symbol: "TBSTST", description: "Read-only simulation, not a live token",
    logo: `data:image/png;base64,${readFileSync(new URL("../public/topblast-mark.png", import.meta.url)).toString("base64")}`,
    quoteMint, quoteSymbol: "STONK", feeTier: "1%", allocation: { topblastPercent: 70, creatorPercent: 20, protocolPercent: 10 },
  }, config);
  console.log(JSON.stringify({ simulation: prepared.raw.simulation, slot: prepared.raw.simulationSlot, creatorWallet,
    cost: prepared.payment, platform: prepared.raw.platform, venueFees: prepared.raw.venueFees, persisted: false, signed: false, submitted: false }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Stonk read-only verification failed"); process.exitCode = 1; });
