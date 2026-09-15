import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/db/server";
import { validatePumpImage } from "@/lib/venue/pumpfun-adapter";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "Invalid metadata ID" }, { status: 400 });
  const { data, error } = await getAdminDb().from("launch_metadata").select("metadata,image_data").eq("id", parsed.data).maybeSingle();
  if (error) return NextResponse.json({ error: "Metadata temporarily unavailable" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Metadata not found" }, { status: 404 });
  const headers = { "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
  if (new URL(request.url).searchParams.get("image") === "1") {
    const image = validatePumpImage(data.image_data);
    return new Response(new Uint8Array(image.bytes), { headers: { ...headers, "Content-Type": image.contentType } });
  }
  return NextResponse.json(data.metadata, { headers });
}
