import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { archiveUrl, edgarFetch, filingIndexUrl, padCik, resourceOf, trimCik } from "./client";

describe("CIK formatting", () => {
  it("pads to ten digits for the JSON APIs", () => {
    expect(padCik(320193)).toBe("0000320193");
    expect(padCik("CIK0000320193")).toBe("0000320193");
  });

  it("strips leading zeros for archive paths", () => {
    expect(trimCik("0000320193")).toBe("320193");
  });
});

describe("URL builders", () => {
  it("builds a document URL from a dashed accession number", () => {
    expect(archiveUrl("0001045810", "0001045810-26-000073", "q2fy27pr.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm",
    );
  });

  it("builds the filing index URL", () => {
    expect(filingIndexUrl(1045810, "0001045810-26-000073")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/0001045810-26-000073-index.htm",
    );
  });
});

describe("resourceOf", () => {
  it("maps each endpoint to its cache bucket", () => {
    expect(resourceOf("https://www.sec.gov/files/company_tickers.json")).toBe("tickers");
    expect(resourceOf("https://data.sec.gov/submissions/CIK0000320193.json")).toBe("submissions");
    expect(resourceOf("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json")).toBe("companyfacts");
    expect(resourceOf("https://efts.sec.gov/LATEST/search-index?q=x")).toBe("search");
    expect(resourceOf("https://www.sec.gov/Archives/edgar/data/1/2/a.htm")).toBe("document");
  });
});

describe("edgarFetch", () => {
  it("cancels a request still queued for the rate limit as soon as its run stops", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "ofa-edgar-"));
    process.env.OFA_HOME = home;
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    try {
      const url = (n: number) => `https://www.sec.gov/Archives/edgar/data/1/2/${n}.htm`;
      await Promise.all(Array.from({ length: 8 }, (_, n) => edgarFetch(url(n), "Test test@example.com")));
      const controller = new AbortController();
      const queued = edgarFetch(url(8), "Test test@example.com", controller.signal);
      // Long enough for the ninth request to be asleep in the limiter, well short of its slot.
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      await expect(queued).rejects.toThrow("Request aborted.");
      expect(fetch).toHaveBeenCalledTimes(8);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.OFA_HOME;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
