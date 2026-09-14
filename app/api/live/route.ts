import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ live: true, service: "topblast-launchpad" });
}
