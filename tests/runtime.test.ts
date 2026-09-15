import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

describe("deployment runtime compatibility", () => {
  it("provides the native WebSocket required by the installed Supabase client", () => {
    expect(typeof globalThis.WebSocket).toBe("function");
  });

  it("initializes the worker database client without network access", () => {
    expect(() => createClient("https://runtime-check.supabase.co", "test-only-not-a-real-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })).not.toThrow();
  });
});
