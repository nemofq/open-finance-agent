import { describe, expect, it } from "vitest";
import { stableStringify } from "./stable-json";

describe("stableStringify", () => {
  it("is insensitive to key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
    expect(stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });

  it("keeps array order significant", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("writes an undefined key as null by default, and leaves it out when asked", () => {
    const value = { symbol: "NVDA", limit: undefined, list: [undefined, 1] };
    expect(stableStringify(value)).toBe('{"limit":null,"list":[null,1],"symbol":"NVDA"}');
    expect(stableStringify(value, { omitUndefined: true })).toBe('{"list":[null,1],"symbol":"NVDA"}');
    expect(stableStringify(value, { omitUndefined: true })).toBe(stableStringify({ symbol: "NVDA", list: [undefined, 1] }, { omitUndefined: true }));
  });

  it("writes a bare undefined as null either way", () => {
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify(undefined, { omitUndefined: true })).toBe("null");
  });
});
