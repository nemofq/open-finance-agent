import { describe, expect, it } from "vitest";
import { bestChunks, bestPassages, chunkSections, matchingPassages, splitChunks } from "./chunks";

describe("splitChunks", () => {
  it("packs lines up to roughly the target size", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(90)}`).join("\n");
    const chunks = splitChunks(text, 500);
    expect(chunks.length).toBeGreaterThan(4);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(750);
  });

  it("splits a single oversized line", () => {
    expect(splitChunks("y".repeat(5_000), 500).length).toBeGreaterThan(5);
  });
});

describe("bestChunks", () => {
  const text = [
    "The company sells widgets in many countries.",
    "Unrelated discussion of the board of directors and governance.",
    "Outlook: we expect fourth quarter revenue of $5.0 billion, plus or minus two percent.",
    "More governance boilerplate that mentions nothing of interest.",
  ].join("\n\n");

  it("returns the passages that match, tagged with their position", () => {
    const result = bestChunks(text, "fourth quarter revenue outlook", 2);
    expect(result).toContain("$5.0 billion");
    expect(result).toMatch(/\[chunk \d+\/\d+\]/);
  });

  it("says so when nothing matches", () => {
    expect(bestChunks(text, "zirconium refinery")).toContain("No passage in this document");
  });

  it("leaves the fallback to a caller that asks for matches only", () => {
    const chunks = splitChunks(text).map((chunk) => ({ text: chunk }));
    expect(matchingPassages(chunks, "zirconium refinery")).toBeUndefined();
    expect(matchingPassages(chunks, "fourth quarter revenue", 1)).toBe(bestPassages(chunks, "fourth quarter revenue", 1));
  });
});

describe("chunkSections and bestPassages", () => {
  const sections = [
    { label: "Page 1", text: "Nothing of interest on the cover page." },
    { label: "Page 14", text: "Segment revenue for the data center business reached $30.0 billion." },
  ];

  it("keeps the part a chunk came from in its label", () => {
    const chunks = chunkSections(sections);
    expect(chunks.map((chunk) => chunk.label)).toEqual(["Page 1", "Page 14"]);
    expect(bestPassages(chunks, "data center revenue", 1)).toContain("[Page 14 · chunk 2/2]");
  });

  it("falls back to a bare chunk label when a part has no name", () => {
    expect(bestPassages([{ text: "data center revenue" }], "data center", 1)).toContain("[chunk 1/1]");
  });

  it("splits a long part and numbers every chunk across the whole document", () => {
    const long = { label: "Slide 2", text: "revenue ".repeat(1_000) };
    const chunks = chunkSections([sections[0], long]);
    expect(chunks.length).toBeGreaterThan(4);
    expect(bestPassages(chunks, "revenue", 1)).toMatch(/\[Slide 2 · chunk \d+\/\d+\]/);
  });
});
