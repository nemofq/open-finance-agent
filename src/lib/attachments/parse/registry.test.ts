import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPES } from "../formats";
import { type ParserLoader, type ParserLoaders, PARSERS } from "./registry";

describe("the parser registry", () => {
  it("has one loader for every parser id the format table names, and no other", () => {
    const named = new Set(Object.values(DOCUMENT_TYPES).map((type) => type.parser));
    expect(new Set(Object.keys(PARSERS))).toEqual(named);
  });

  it("refuses at compile time a loader map that misses a parser id", () => {
    const loader: ParserLoader = () => Promise.reject(new Error("never called"));
    // @ts-expect-error `pdf` is missing, so this is not a `ParserLoaders`.
    const missing: ParserLoaders = { text: loader, html: loader, docx: loader, "legacy-doc": loader, tabular: loader, pptx: loader };
    expect(Object.keys(missing)).not.toContain("pdf");
  });
});
