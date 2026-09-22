/** Postgres numeric(39,0) exceeds JavaScript's safe integer range. Preserve its
 * original decimal digits before Supabase's response.json() can round them. */
export function preserveLargeJsonIntegers(json: string): string {
  return json.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) => {
    if (token.startsWith('"') || !/^-?\d+$/.test(token)) return token;
    const value = BigInt(token);
    return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? JSON.stringify(token) : token;
  });
}

export const exactDatabaseFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (!response.headers.get("content-type")?.includes("application/json") || response.status === 204) return response;
  const text = preserveLargeJsonIntegers(await response.text());
  const headers = new Headers(response.headers);
  headers.delete("content-length"); headers.delete("content-encoding");
  return new Response(text, { status: response.status, statusText: response.statusText, headers });
};
