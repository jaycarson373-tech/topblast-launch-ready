import { PublicKey } from "@solana/web3.js";
import { getAdminDb } from "@/lib/db/server";

export async function reserveStonkReceiver(mint: string) {
  new PublicKey(mint);
  const treasury = process.env.TOPBLAST_TREASURY_ADDRESS;
  if (!treasury) throw new Error("TopBlast treasury is not configured");
  const result = await getAdminDb().rpc("reserve_stonk_fee_receiver", { p_mint: mint, p_treasury: treasury });
  if (result.error) throw new Error("Stonk fee-wallet provisioning is unavailable. No launch was submitted.");
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as { id?: string; address?: string; mint?: string; treasury_address?: string } | null;
  if (!row?.id || !row.address || row.mint !== mint || row.treasury_address !== treasury || row.address === treasury || !PublicKey.isOnCurve(new PublicKey(row.address).toBytes())) throw new Error("Stonk fee wallets are being prepared. Retry shortly; no payment was taken.");
  return { id: row.id, address: row.address };
}
