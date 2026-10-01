import { describe, expect, it } from "vitest";
import { approxTokens, columnsLine, columnType, digestOf, fullText, markdownCell, outlineLines, partsLabel, tableDigest } from "./digest";
import { describe as descriptorOf, tablePart, textParse } from "./testing";
import type { ParsedAttachment } from "./types";

const holdings = tablePart(
  "Holdings",
  ["date", "ticker", "shares", "note"],
  [
    ["2026-01-02", "NVDA", 400, "core"],
    ["2026-02-02", "MSFT", 120, null],
  ],
  4_210,
);

const deck: ParsedAttachment = {
  version: 1,
  kind: "document",
  parts: [
    { type: "text", label: "Slide 1", markdown: "# Results\n\nRevenue rose 12%." },
    { type: "text", label: "Slide 2", markdown: "Cloud grew fastest." },
  ],
  outline: [
    { part: 0, level: 1, title: "Results" },
    { part: 1, level: 2, title: "Cloud" },
  ],
  warnings: [],
};

describe("partsLabel", () => {
  it("names the parts the way the document does", () => {
    expect(partsLabel(deck)).toBe("2 slides");
    expect(partsLabel({ ...deck, parts: [{ type: "text", label: "Page 1", markdown: "x" }] })).toBe("1 page");
    expect(partsLabel({ ...deck, kind: "table", parts: [holdings] })).toBe("1 sheet");
  });

  it("falls back to sections for a document whose parts are not numbered", () => {
    expect(partsLabel(textParse("a memo"))).toBe("1 section");
  });
});

describe("markdownCell", () => {
  it("escapes backslashes before pipes, so a cell cannot open an extra column", () => {
    expect(markdownCell("a|b")).toBe("a\\|b");
    expect(markdownCell("a\\|b")).toBe("a\\\\\\|b");
    expect(markdownCell("C:\\x")).toBe("C:\\\\x");
  });

  it("flattens line breaks and leaves an empty cell empty", () => {
    expect(markdownCell("one\r\ntwo\nthree")).toBe("one two three");
    expect(markdownCell(null)).toBe("");
    expect(markdownCell(undefined)).toBe("");
    expect(markdownCell(12.5)).toBe("12.5");
  });
});

describe("columnType", () => {
  it("reads a column's type off the cells rather than the file", () => {
    expect(columnType(holdings.rows, 0)).toBe("date");
    expect(columnType(holdings.rows, 1)).toBe("text");
    expect(columnType(holdings.rows, 2)).toBe("number");
    expect(columnType(holdings.rows, 3)).toBe("text");
    expect(columnType([[null], [""]], 0)).toBe("empty");
  });

  it("calls a column text as soon as one cell is not a number", () => {
    expect(columnType([[1], [2], ["n/a"]], 0)).toBe("text");
  });

  it("names an unnamed column by its position", () => {
    expect(columnsLine(tablePart("S", [""], [[1]]))).toBe("column 1 (number)");
  });
});

describe("tableDigest", () => {
  it("gives the schema, the size, a first look and the id that loads it", () => {
    const text = tableDigest(holdings, "U7");

    expect(text).toContain("### Holdings");
    expect(text).toContain("4,210 rows × 4 columns.");
    expect(text).toContain("Columns: date (date), ticker (text), shares (number), note (text)");
    expect(text).toContain("Loaded as evidence U7. Pass it to financial_calculator.");
    expect(text).toContain("| 2026-01-02 | NVDA | 400 | core |");
    expect(text).toContain("_First 2 of 4,210 rows._");
  });

  it("leaves the evidence line out when the table was never registered", () => {
    expect(tableDigest(holdings)).not.toContain("Loaded as evidence");
  });

  it("escapes a pipe so one cell cannot invent a column", () => {
    expect(tableDigest(tablePart("S", ["a"], [["x|y"]]))).toContain("| x\\|y |");
  });
});

describe("digestOf", () => {
  const stored = descriptorOf(deck, "deck.pptx", { tokens: 31_000 });

  it("says how big the document is, lists its headings and quotes the top of it", () => {
    const long = { ...deck, parts: [{ type: "text" as const, label: "Slide 1", markdown: "Revenue rose. ".repeat(200) }] };
    const text = digestOf(long, stored);

    expect(text).toContain("1 slide, about 31k tokens of text.");
    expect(text).toContain("Outline:\n- Results\n  - Cloud");
    expect(text).toContain("Beginning of the text:");
    expect(text).toContain("Use read_attachment to read the rest");
  });

  it("does not promise a rest that is not there", () => {
    expect(digestOf(deck, stored)).not.toContain("Use read_attachment");
  });

  it("says which pages were never read, so a gap is not mistaken for silence", () => {
    const text = digestOf(deck, { ...stored, scannedParts: [3, 7] });
    expect(text).toContain("Pages with no text layer (scanned images, not read): 3, 7");
  });

  it("says when a parser cap cut the file short", () => {
    expect(digestOf(deck, { ...stored, truncated: true })).toContain("larger than this reader's limits");
  });

  it("gives a spreadsheet its schema and nothing about tokens of prose", () => {
    const sheet: ParsedAttachment = { version: 1, kind: "table", parts: [holdings], outline: [], warnings: [] };
    const text = digestOf(sheet, descriptorOf(sheet, "book.xlsx"), () => "U3");

    expect(text).toContain("1 sheet.");
    expect(text).toContain("Loaded as evidence U3.");
    expect(text).not.toContain("tokens of text");
  });
});

describe("fullText", () => {
  it("quotes the prose whole and still keeps a table to its schema", () => {
    const mixed: ParsedAttachment = { ...deck, parts: [deck.parts[0], holdings] };
    const text = fullText(mixed, descriptorOf(mixed, "memo.docx"), () => "U2");

    expect(text).toContain("## Slide 1");
    expect(text).toContain("Revenue rose 12%.");
    expect(text).toContain("Loaded as evidence U2.");
    expect(text).not.toContain("2026-02-02 | MSFT | 120 | | 2026");
  });

  it("gives a one-part document no heading to outrank its own title", () => {
    const parse = textParse("# Q3 memo\n\nRevenue rose 12%.");
    expect(fullText(parse, descriptorOf(parse, "memo.md"))).toBe("# Q3 memo\n\nRevenue rose 12%.");
  });
});

describe("outlineLines and approxTokens", () => {
  it("indents the outline by heading level", () => {
    expect(outlineLines(deck)).toEqual(["Outline:", "- Results", "  - Cloud"]);
    expect(outlineLines(textParse("no headings"))).toEqual([]);
  });

  it("stops a runaway outline and says how much it dropped", () => {
    const many = { ...deck, outline: Array.from({ length: 60 }, (_, i) => ({ part: 0, level: 1, title: `H${i}` })) };
    expect(outlineLines(many).at(-1)).toBe("  …20 further headings");
  });

  it("rounds a token count to something worth reading", () => {
    expect(approxTokens(8_412)).toBe("8k");
    expect(approxTokens(450)).toBe("450");
  });
});
