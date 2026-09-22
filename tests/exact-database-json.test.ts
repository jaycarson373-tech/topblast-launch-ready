import { expect, it } from "vitest";
import { preserveLargeJsonIntegers } from "../lib/db/exact-json";
it("preserves 39-digit integer amounts before JavaScript can round them", () => {
  const parsed = JSON.parse(preserveLargeJsonIntegers('{"amount":999999999999999999999999999999999999999,"slot":449451608,"usd":0.000001,"nested":[9007199254740992,-9007199254740993]}'));
  expect(parsed.amount).toBe("999999999999999999999999999999999999999");
  expect(parsed.slot).toBe(449451608); expect(parsed.usd).toBe(0.000001);
  expect(parsed.nested).toEqual(["9007199254740992", "-9007199254740993"]);
});
it("never rewrites integer-looking text, escaped JSON, wallet strings or small counters", () => {
  const input = JSON.stringify({ memo: '900719925474099999, "amount":99999999999999999', path: "\\90071992547409999", count: 4, zero: 0, safe: Number.MAX_SAFE_INTEGER });
  expect(preserveLargeJsonIntegers(input)).toBe(input);
});
