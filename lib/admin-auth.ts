import { timingSafeEqual } from "node:crypto";

export function isAdminRequest(request: Request): boolean {
  const expected = process.env.ADMIN_API_TOKEN;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && Buffer.byteLength(expected) === Buffer.byteLength(actual)
    && timingSafeEqual(Buffer.from(expected), Buffer.from(actual)));
}
