import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accept,
  ATTACHMENT_NAME,
  DOCUMENT_TYPES,
  mimeTypeOfAttachment,
  rejected,
  servedTypeOfAttachment,
  supported,
} from "./formats";

describe("the format table", () => {
  it("builds the composer's accept list from the images and the document rows", () => {
    expect(accept).toBe("image/png,image/jpeg,image/webp,image/gif,.md,.txt,.html,.htm,.docx,.doc,.pptx,.csv,.xlsx,.pdf");
  });

  it("stores only content-addressed names with an extension it knows", () => {
    const hash = "0123456789abcdef0123456789abcdef01234567";
    for (const ext of ["png", "jpg", "webp", "gif", ...Object.keys(DOCUMENT_TYPES)]) expect(ATTACHMENT_NAME.test(`${hash}.${ext}`), ext).toBe(true);
    expect(ATTACHMENT_NAME.test(`${hash}.json`)).toBe(false);
    expect(ATTACHMENT_NAME.test(`${hash}.ppt`)).toBe(false);
    expect(ATTACHMENT_NAME.test(`${hash}.xls`)).toBe(false);
  });

  it("explains .ppt and .xls instead of calling them unsupported", () => {
    expect(supported("deck.ppt")).toBeUndefined();
    expect(rejected("deck.PPT")).toBe("Save as .pptx and attach again");
    expect(rejected("deck.pptx")).toBeUndefined();
    expect(supported("book.xls")).toBeUndefined();
    expect(rejected("book.XLS")).toBe("Save as .xlsx or .csv and attach again");
    expect(rejected("book.xlsx")).toBeUndefined();
  });

  it("serves html as text and everything else as what it is", () => {
    expect(mimeTypeOfAttachment("a.html")).toBe("text/html");
    expect(servedTypeOfAttachment("a.html")).toBe("text/plain; charset=utf-8");
    expect(servedTypeOfAttachment("a.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(servedTypeOfAttachment("a.jpg")).toBe("image/jpeg");
    expect(servedTypeOfAttachment("a.json")).toBeUndefined();
  });

  it("stays browser-safe: formats.ts and limits.ts import no parser and no Node module", () => {
    for (const file of ["formats.ts", "limits.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)];
      for (const [statement, typeOnly, specifier] of imports) {
        expect(typeOnly === undefined ? statement : "", `${file} may only import types`).toBe("");
        expect(specifier, file).not.toMatch(/^node:|parse\/|tables/);
      }
    }
  });
});
