import { describe, expect, it } from "vitest";
import { formatExtractResults, formatSearchResults, maxChunks, maxPageChars, truncate, type SearchHit } from "./format";

const hits: SearchHit[] = [
  {
    title: "Nvidia beats on datacentre revenue",
    url: "https://reuters.com/nvda",
    content: "Revenue of $57bn,\n  up 62%  year over year.",
    publishedDate: "2026-08-27",
  },
  { title: "Analyst reaction", url: "https://barrons.com/nvda", content: "Targets raised." },
];

describe("formatSearchResults", () => {
  it("numbers the hits and keeps the published date when there is one", () => {
    const text = formatSearchResults("nvda earnings", hits);
    expect(text).toContain(
      "1. Nvidia beats on datacentre revenue — https://reuters.com/nvda (2026-08-27)",
    );
    expect(text).toContain("2. Analyst reaction — https://barrons.com/nvda");
    expect(text).not.toContain("Analyst reaction — https://barrons.com/nvda (");
  });

  it("collapses whitespace inside snippets", () => {
    expect(formatSearchResults("q", hits)).toContain("Revenue of $57bn, up 62% year over year.");
  });

  it("says so when there is nothing", () => {
    expect(formatSearchResults("obscure", [])).toBe('No results for "obscure".');
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("short", 100)).toBe("short");
  });

  it("cuts at the limit and says it did", () => {
    const out = truncate("x".repeat(50), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("[truncated at 10 characters]");
  });
});

describe("formatExtractResults", () => {
  it("heads each page with its title and URL", () => {
    const text = formatExtractResults(
      [{ url: "https://a.com/1", title: "Press release", rawContent: "Q3 revenue rose." }],
      [],
    );
    expect(text).toContain("## Press release\nhttps://a.com/1");
    expect(text).toContain("Q3 revenue rose.");
  });

  it("falls back to the URL when a page has no title", () => {
    const text = formatExtractResults([{ url: "https://a.com/1", title: null, rawContent: "x" }], []);
    expect(text).toContain("## https://a.com/1");
  });

  it("truncates a long page", () => {
    const text = formatExtractResults(
      [{ url: "https://a.com/1", title: "Long", rawContent: "y".repeat(maxPageChars + 500) }],
      [],
    );
    expect(text).toContain(`[truncated at ${maxPageChars} characters]`);
    expect(text.length).toBeLessThan(maxPageChars + 300);
  });

  it("returns only the passages that match a query, from anywhere on the page, in page order", () => {
    const paragraph = (text: string) => `${text} ${"filler ".repeat(200)}`;
    const rawContent = [
      paragraph("Intro about the company."),
      paragraph("Segment revenue was flat."),
      ...Array.from({ length: 20 }, (_, index) => paragraph(`Unrelated section ${index}.`)),
      paragraph("The outlook for margins is 42% next year."),
    ].join("\n");
    expect(rawContent.length).toBeGreaterThan(maxPageChars);
    const text = formatExtractResults([{ url: "https://a.com/1", title: "Filing", rawContent }], [], "outlook margins");
    expect(text).toContain("The outlook for margins is 42% next year.");
    expect(text).not.toContain("Intro about the company.");
    expect(text).toMatch(/\[chunk \d+\/\d+\]/);
  });

  it("returns at most five passages", () => {
    const rawContent = Array.from({ length: 12 }, (_, index) => `Revenue grew in region ${index}. ${"filler ".repeat(200)}`).join("\n");
    const text = formatExtractResults([{ url: "https://a.com/1", title: "Filing", rawContent }], [], "revenue region");
    expect(text.match(/\[chunk /g)).toHaveLength(maxChunks);
  });

  it("falls back to the top of the page, and says so, when no passage matches", () => {
    const text = formatExtractResults([{ url: "https://a.com/1", title: "Filing index", rawContent: "Documents in this filing." }], [], "zirconium");
    expect(text).toContain('No passage on this page mentions "zirconium"; the top of the page follows.\n\nDocuments in this filing.');
  });

  it("reports the URLs that failed", () => {
    const text = formatExtractResults([], [{ url: "https://b.com", error: "403 Forbidden" }]);
    expect(text).toContain("## Could not be fetched\n- https://b.com: 403 Forbidden");
  });

  it("says so when nothing came back at all", () => {
    expect(formatExtractResults([], [])).toBe("No content could be extracted.");
  });
});
