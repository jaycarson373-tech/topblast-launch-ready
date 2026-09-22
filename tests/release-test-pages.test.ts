import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import TestPage from "@/app/test/page";
import TestLaunchPage from "@/app/launch/test/page";
afterEach(() => vi.unstubAllEnvs());
it("removes both direct test pages after public release", () => {
  vi.stubEnv("LAUNCHES_ENABLED", "true");
  expect(() => TestPage()).toThrow("404");
  expect(() => TestLaunchPage()).toThrow("404");
});
it("keeps the existing pre-launch bookmark usable through the normal form", () => {
  vi.stubEnv("LAUNCHES_ENABLED", "false");
  expect(() => TestLaunchPage()).toThrow("redirect:/launch");
});
