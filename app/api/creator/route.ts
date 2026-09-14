import { NextResponse } from "next/server";
import { getAdminDb, isDatabaseConfigured } from "@/lib/db/server";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  if (!isDatabaseConfigured()) return NextResponse.json({ launches: [], configured: false });
  const db = getAdminDb();
  const { data, error } = await db.from("launches").select("id,mint,name,symbol,status,volume_24h_usd,launch_configs(*),reward_epochs(id),reward_distributions(amount_atoms,status),fee_events(amount_atoms,status)").eq("creator_wallet", wallet).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ launches: data ?? [], configured: true });
}
