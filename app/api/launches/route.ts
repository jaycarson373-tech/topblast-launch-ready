import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db/server";
import { listLaunches } from "@/lib/db/launch-repository";

export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ launches: [], configured: false });
  try { return NextResponse.json({ launches: await listLaunches(), configured: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load launches" }, { status: 500 }); }
}
