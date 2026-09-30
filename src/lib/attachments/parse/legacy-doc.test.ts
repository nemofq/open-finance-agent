import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_TEXT_CHARS } from "../limits";
import { parse } from "./legacy-doc";

/**
 * A real `.doc` is an OLE2 compound file holding a Word 97 FIB and a piece table; no library in the
 * tree can write one, so extraction is tested against a stubbed `word-extractor` and the rejection
 * paths are tested against the real one, with real bytes.
 */

/** An OLE2 header, which is as far as the signature check reads. */
function ole2(): Uint8Array {
  const bytes = new Uint8Array(1536);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return bytes;
}

/** Runs the parser against a `word-extractor` that returns `body`, as it would from a real file. */
async function parseBody(body: string, name = "memo.doc"): ReturnType<typeof parse> {
  vi.resetModules();
  vi.doMock("word-extractor", () => ({
    default: class {
      extract = async (): Promise<{ getBody: () => string }> => ({ getBody: () => body });
    },
  }));
  const { parse: parseMocked } = await import("./legacy-doc");
  return parseMocked(ole2(), name);
}

afterEach(() => {
  vi.doUnmock("word-extractor");
  vi.resetModules();
});

describe("parse", () => {
  it("returns the body as one unstructured part, and says it is best effort", async () => {
    const parsed = await parseBody("Quarterly memo\rRevenue rose 12%.");
    expect(parsed).toEqual({
      version: 1,
      kind: "document",
      parts: [{ type: "text", label: "Document", markdown: "Quarterly memo\nRevenue rose 12%." }],
      outline: [],
      warnings: [expect.stringContaining("Save it as .docx")],
    });
  });

  it("drops the control characters Word leaves behind and collapses blank runs", async () => {
    const parsed = await parseBody("\u0001Segment\tRevenue\n\n\n\n\u0013Cloud  \n46743\u0002\n\n");
    expect(parsed.parts[0]).toMatchObject({ markdown: "Segment\tRevenue\n\nCloud\n46743" });
  });

  it("names a file with no text in a warning", async () => {
    const parsed = await parseBody("\u0001\u0002 \n", "blank.doc");
    expect(parsed.parts[0]).toMatchObject({ markdown: "" });
    expect(parsed.warnings).toContain("blank.doc has no text.");
  });

  it("truncates an oversized document rather than throwing", async () => {
    const parsed = await parseBody("x".repeat(MAX_TEXT_CHARS + 10), "huge.doc");
    expect((parsed.parts[0] as { markdown: string }).markdown).toHaveLength(MAX_TEXT_CHARS);
    expect(parsed.warnings).toEqual([expect.any(String), expect.stringContaining("2,000,000")]);
    expect(parsed.truncated).toBe(true);
  });

  it("reports a damaged or password-protected file cleanly", async () => {
    await expect(parse(ole2(), "locked.doc")).rejects.toThrow(/damaged or password-protected/);
  });
});
