import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SourceRequest, type SourceSnapshot, withSourceSnapshot } from "@/lib/data/source-snapshot";
import type { ModuleContext } from "@/lib/tools/contracts";
import { offlineContext } from "@/lib/tools/testing";
import { companyListHtml, noCompanyHtml } from "./companies.fixture";
import type { Submissions } from "./submissions";
import { statementLines } from "./xbrl/statements";
import { edgarModule } from "./module";

describe("edgar_financials tool text", () => {
  it("lists every line of every statement, read from the definitions", async () => {
    const tools = await edgarModule.createTools({ enabled: true, contact: "Test test@example.com" }, {} as ModuleContext);
    const tool = tools.find((t) => t.name === "edgar_financials")!;
    const statement = (tool.parameters as { properties: { statement: { description: string } } }).properties.statement.description;
    for (const [id, lines] of Object.entries(statementLines)) {
      expect(lines.length, id).toBeGreaterThan(0);
      expect(statement, id).toContain(`${id}: ${lines.join(", ")}`);
      expect(tool.label, id).toContain(`${id}: ${lines.join(", ")}`);
    }
    expect(statement).toContain("cashflow: operatingCashFlow, capex, freeCashFlow");
    expect(tool.description).toMatch(/just-reported quarter, look first at the newest column here/);
  });
});

describe("an EDGAR module without a contact", () => {
  it("contributes no tools, and Validate says what is missing", async () => {
    expect(await edgarModule.createTools({ enabled: true, contact: "" }, {} as ModuleContext)).toEqual([]);
    expect(await edgarModule.validate?.({ enabled: true, contact: "" })).toEqual({ ok: false, message: expect.stringMatching(/needs a contact/) });
  });
});

describe("edgar_lookup_company beyond the ticker map", () => {
  const tickerMap = { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } };
  const profile = (cik: string, name: string, formerNames: Submissions["formerNames"] = []) =>
    ({ cik, name, tickers: [], exchanges: [], sic: "5961", sicDescription: "Retail-Catalog & Mail-Order Houses", formerNames,
      filings: { recent: { accessionNumber: ["0001254699-25-000010"], filingDate: ["2025-11-06"], reportDate: ["2025-09-30"], form: ["10-Q"],
        items: [""], primaryDocument: ["qvc-20250930.htm"], primaryDocDescription: ["10-Q"] } } });
  let home: string;
  beforeAll(() => { home = mkdtempSync(path.join(tmpdir(), "ofa-edgar-module-")); process.env.OFA_HOME = home; });
  afterAll(() => { delete process.env.OFA_HOME; rmSync(home, { recursive: true, force: true }); });

  /** Tools whose EDGAR requests are answered by `answer`, with nothing reaching the network or the cache. */
  async function withEdgar(answer: (url: string) => unknown) {
    const snapshot: SourceSnapshot = { async resolve<T>(request: SourceRequest): Promise<T> {
      const url = String(request.args.url);
      if (url.includes("company_tickers")) return JSON.stringify(tickerMap) as T;
      const value = answer(url);
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error(`unexpected ${url}`);
      return value as T;
    } };
    const tools = await withSourceSnapshot(snapshot, () => edgarModule.createTools({ enabled: true, contact: "Test test@example.com" }, offlineContext()));
    const call = (name: string, args: Record<string, unknown>) => withSourceSnapshot(snapshot, () => tools.find((t) => t.name === name)!.execute("t", args));
    return call;
  }
  const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((c) => c.text ?? "").join("");

  it("says the company index could not be searched rather than that no filer exists", async () => {
    const call = await withEdgar(() => new Error("SEC EDGAR request failed with HTTP 503"));
    const text = textOf(await call("edgar_lookup_company", { query: "QVC Inc" }));
    expect(text).toContain(`No listed ticker matches "QVC Inc", and EDGAR's company index could not be searched`);
    expect(text).not.toContain("No SEC filer matches");
  });

  it("profiles the operating registrants first and lists the rest", async () => {
    const call = await withEdgar((url) => url.includes("browse-edgar") ? companyListHtml
      : url.includes("CIK0001355096") ? JSON.stringify(profile("0001355096", "Old QVC Group, Inc.", [{ name: "Qurate Retail, Inc.", from: "2018-04-09T00:00:00.000Z", to: "2025-02-24T00:00:00.000Z" }]))
      : url.includes("CIK0001254699") ? JSON.stringify(profile("0001254699", "QVC Group, Inc.")) : undefined);
    const result = await call("edgar_lookup_company", { query: "QVC" });
    const text = textOf(result);
    expect(text.indexOf("**Old QVC Group, Inc.**")).toBeGreaterThan(0);
    expect(text.indexOf("**QVC Group, Inc.**")).toBeGreaterThan(text.indexOf("**Old QVC Group, Inc.**"));
    expect(text).toContain("- Former names: Qurate Retail, Inc. (until 2025-02-24)");
    expect(text).toContain("Also matching:\n- QVC Deutschland GP, Inc. (CIK 0001787724)");
    expect(text).toMatch(/Pass a CIK to edgar_filings or edgar_financials for a filer with no listed ticker\.$/);
    expect(result.details).toMatchObject({ entity: { cik: "0001355096", name: "Old QVC Group, Inc.", formerNames: ["Qurate Retail, Inc. (until 2025-02-24)"] } });
    expect((result.details as { entity: { ticker?: string } }).entity.ticker).toBeUndefined();
  });

  it("retries the company index without a legal form the index does not spell out", async () => {
    const searched: string[] = [];
    const call = await withEdgar((url) => {
      if (url.includes("browse-edgar")) {
        const company = new URL(url).searchParams.get("company") ?? "";
        searched.push(company);
        return company === "QVC Group" ? companyListHtml : noCompanyHtml;
      }
      return url.includes("CIK0001355096") ? JSON.stringify(profile("0001355096", "Old QVC Group, Inc."))
        : url.includes("CIK0001254699") ? JSON.stringify(profile("0001254699", "QVC Group, Inc.")) : undefined;
    });
    const text = textOf(await call("edgar_lookup_company", { query: "QVC Group Incorporated" }));
    expect(searched).toEqual(["QVC Group Incorporated", "QVC Group"]);
    expect(text).toContain("**Old QVC Group, Inc.**");
  });

  it("lists the filings of a filer with no listed ticker by its CIK", async () => {
    const call = await withEdgar((url) => url.includes("CIK0001254699") ? JSON.stringify(profile("0001254699", "QVC Group, Inc.")) : undefined);
    const result = await call("edgar_filings", { ticker: "CIK 1254699" });
    expect(textOf(result)).toContain("**QVC Group, Inc. (CIK 0001254699) — 1 filings**");
    expect(result.details).toMatchObject({ entity: { cik: "0001254699", name: "QVC Group, Inc." } });
    expect((result.details as { entity: { ticker?: string } }).entity.ticker).toBeUndefined();
  });
});
