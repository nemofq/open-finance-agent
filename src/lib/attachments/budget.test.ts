import { describe, expect, it } from "vitest";
import { fitsInline, inlineBudget, MAX_INLINE_TOKENS } from "./budget";
import type { StoredAttachment } from "./types";

const document = (tokens: number, kind: StoredAttachment["kind"] = "document"): StoredAttachment => ({
  attachment: `${"a".repeat(40)}.txt`,
  name: "memo.txt",
  kind,
  bytes: tokens * 4,
  tokens,
  parts: 1,
});

describe("inlineBudget", () => {
  it("gives a message a fifth of the window", () => {
    expect(inlineBudget(200_000)).toBe(40_000);
  });

  it("holds a floor for a small window and a ceiling for a huge one", () => {
    expect(inlineBudget(8_192)).toBe(4_000);
    expect(inlineBudget(1_000_000)).toBe(MAX_INLINE_TOKENS);
  });

  it("assumes little when the endpoint states no window at all", () => {
    expect(inlineBudget(0)).toBe(6_000);
    expect(inlineBudget(undefined)).toBe(6_000);
  });
});

describe("fitsInline", () => {
  it("spends the budget in attachment order", () => {
    expect(fitsInline([document(3_000), document(3_000)], 5_000)).toEqual([true, false]);
  });

  it("lets a small file through behind one that did not fit", () => {
    expect(fitsInline([document(50_000), document(1_000)], 5_000)).toEqual([false, true]);
  });

  it("never inlines a table: the calculator reads those, not the model", () => {
    expect(fitsInline([document(10, "table")], 60_000)).toEqual([false]);
  });

  it("answers nothing for a message with no documents", () => {
    expect(fitsInline([], 4_000)).toEqual([]);
  });
});
