import { describe, expect, it } from "vitest";
import { deepEqual, deepMerge, errorMessage } from "./utils";

describe("deepEqual", () => {
  it("ignores key order and undefined keys", () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, allowTools: undefined }, { a: 1 })).toBe(true);
  });

  it("compares arrays in order", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: null }, { a: {} })).toBe(false);
  });
});

describe("errorMessage", () => {
  it("reads an Error's message and stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("deepMerge", () => {
  it("merges nested objects key by key", () => {
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } })).toEqual({ a: { b: 1, c: 3 } });
  });

  it("replaces arrays instead of merging them element-wise", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] });
  });

  it("leaves the base untouched for undefined overrides", () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it("does not mutate the base object", () => {
    const base = { a: { b: 1 } };
    deepMerge(base, { a: { b: 2 } });
    expect(base.a.b).toBe(1);
  });
});
