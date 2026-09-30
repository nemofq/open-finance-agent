import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import type { ToolMeta } from "@/lib/tools/contracts";
import { bestTier, normalizeWeb, PRESS_DOMAINS, tierOfUrl, urlsOf } from "./web";

const meta: ToolMeta = { class: "general", effect: "external", supportsAsOf: false };

const searchText = `Results for "nvidia q2 fy25 revenue":

1. Nvidia beats estimates — https://www.reuters.com/technology/nvidia-q2 (2024-08-28)
   Revenue rose to $30.04 billion, up 122% from a year earlier.

2. A blogger's take — https://someblog.example/nvidia
   The author reckons the stock is worth 45x forward earnings.`;

const search = (details: unknown): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: searchText }],
  details,
});

describe("normalizeWeb", () => {
  it("takes the best tier among the result URLs", () => {
    const entry = normalizeWeb({ name: "web_search", meta }, { query: "nvidia" }, search({
      query: "nvidia q2 fy25 revenue",
      urls: ["https://www.reuters.com/technology/nvidia-q2", "https://someblog.example/nvidia"],
    }));
    expect(entry.source).toEqual({ id: "web", name: "Web", tier: 3 });
    expect(entry.summary).toContain('"nvidia q2 fy25 revenue"');
    expect(entry.summary).toContain("best tier 3");
  });

  it("names the source by the same host its tier is read from", () => {
    // A copied URL can carry a no-break space, which `new URL` does not strip but `tierOfUrl` trims.
    const entry = normalizeWeb({ name: "web_fetch", meta }, {}, search({ fetched: ["\u00a0https://WWW.Reuters.com/a\u00a0"] }));
    expect(entry.source).toEqual({ id: "web", name: "reuters.com", tier: 3 });
  });

  it("treats a filing on sec.gov as primary and an issuer page too", () => {
    expect(bestTier(["https://blog.example/x", "https://www.sec.gov/Archives/x.htm"])).toBe(1);
    expect(bestTier(["https://blog.example/x", "https://investor.nvidia.com/x"])).toBe(1);
    expect(bestTier(["https://blog.example/x"])).toBe(4);
    expect(bestTier([])).toBe(4);
  });

  it("dates the entry from a published date, never from a number in the page", () => {
    const entry = normalizeWeb({ name: "web_search", meta }, {}, search({ urls: [] }));
    expect(entry.asOf).toBe("2024-08-28");

    const undated = normalizeWeb({ name: "web_fetch", meta }, {}, {
      content: [{ type: "text", text: "Notes maturing in 2031 carry a 4.25% coupon." }],
      details: { fetched: ["https://someblog.example/x"] },
    });
    expect(undated.asOf).toBeUndefined();
  });

  it("keeps the numbers with the line they came from", () => {
    const entry = normalizeWeb({ name: "web_search", meta }, {}, search({ urls: [] }));
    const revenue = entry.numbers?.find((number) => number.value === 30_040_000_000);
    expect(revenue?.unit).toBe("USD");
    expect(revenue?.context).toContain("Revenue rose to");
    expect(entry.numbers?.map((number) => number.value)).toContain(45);
  });

  it("falls back to the URLs printed in the text", () => {
    const entry = normalizeWeb({ name: "web_fetch", meta }, {}, search({}));
    expect(urlsOf(search({}), searchText)).toEqual([
      "https://www.reuters.com/technology/nvidia-q2",
      "https://someblog.example/nvidia",
    ]);
    expect(entry.source?.tier).toBe(3);
  });

  it("names the single host it read", () => {
    const entry = normalizeWeb({ name: "web_fetch", meta }, {}, {
      content: [{ type: "text", text: "## Q2 results\nhttps://www.sec.gov/a.htm\n\nRevenue $30,040M." }],
      details: { fetched: ["https://www.sec.gov/a.htm"] },
    });
    expect(entry.source).toEqual({ id: "web", name: "sec.gov", tier: 1 });
  });
});

describe("tierOfUrl", () => {
  it("makes the SEC and issuer pages primary", () => {
    expect(tierOfUrl("https://www.sec.gov/Archives/edgar/data/1045810/x.htm")).toBe(1);
    expect(tierOfUrl("https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json")).toBe(1);
    expect(tierOfUrl("https://investor.nvidia.com/financial-info/quarterly-results")).toBe(1);
    expect(tierOfUrl("https://ir.tesla.com/press-release")).toBe(1);
  });

  it("puts the allowlisted press at tier 3 and everything else at tier 4", () => {
    expect(tierOfUrl("https://www.reuters.com/markets/x")).toBe(3);
    expect(tierOfUrl("https://www.cnbc.com/2024/08/28/nvidia.html")).toBe(3);
    expect(tierOfUrl("https://seekingalpha.com/article/1")).toBe(4);
    expect(tierOfUrl("https://reddit.com/r/stocks")).toBe(4);
    expect(tierOfUrl("not a url")).toBe(4);
    // A lookalike domain must not inherit the allowlist.
    expect(tierOfUrl("https://reuters.com.example.net/x")).toBe(4);
  });

  it("lists the press it trusts", () => {
    expect(PRESS_DOMAINS).toContain("bloomberg.com");
  });
});
