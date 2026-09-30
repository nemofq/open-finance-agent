import { describe, expect, it } from "vitest";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { MOCK_TOOL_NAMES, MockMcpBridge } from "./mock-mcp-bridge";
import { MOCK_MCP_FORMAT_VERSION } from "./mock-mcp-data";
import { loadDataset, datasetPath, datasetTaskHash, validateDatasetScopes, validateDatasetTasks } from "./dataset";

describe("the offline dataset behind the canonical mock MCP", () => {
  it("contains a hashed scope for every active task", () => {
    expect(validateDatasetScopes(RETAIL_EVAL_TASKS.map((task) => task.id))).toEqual([]);
    expect(datasetPath()).toMatch(/db\.json\.gz$/);
    const db = loadDataset();
    expect(db.version).toBe(MOCK_MCP_FORMAT_VERSION);
    expect(Object.keys(db.scopes)).toHaveLength(12);
    for (const task of RETAIL_EVAL_TASKS) expect(datasetTaskHash(task.id)).toMatch(/^[a-f0-9]{64}$/);
    expect(db.financialFacts.some((fact) => fact.ticker === "NVDA" && fact.metric === "assets" && fact.concept === "Assets" && fact.sourceUrl?.includes("companyfacts"))).toBe(true);
  });

  it("validates the database it is given, as the compiler does for the one it just wrote", () => {
    const [task] = RETAIL_EVAL_TASKS;
    const db = loadDataset();
    const scopes = Object.fromEntries(Object.entries(db.scopes).filter(([id]) => id !== task.id));
    expect(validateDatasetTasks([task], { ...db, scopes })).toContain(`${task.id}: missing canonical mock MCP task scope`);
  });

  it("exposes the production-facing tool names through MCP", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-01-nvda-beat-and-drop");
    expect(new Set(await bridge.listTools())).toEqual(MOCK_TOOL_NAMES);
  });

  it("handles semantic web and quote calls without a recorded request key", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-03-nuclear-thematic-purity");
    const search = await bridge.call("web_search", { query: "Three Mile Island Microsoft power deal", topic: "news", max_results: 5 });
    expect(search.content[0]).toMatchObject({ type: "text" });
    expect(String((search.content[0] as { text?: string }).text)).toMatch(/Results for|No results/);

    const quoteBridge = new MockMcpBridge(loadDataset(), "retail-12-concentration-profile-fit");
    const quotes = await quoteBridge.call("market_quotes", { symbols: ["nvda", "AAPL"] });
    expect(String((quotes.content[0] as { text?: string }).text)).toContain("NVDA");
  });

  it("allows an explicit, as-of-safe peer comparison without exposing the whole DB", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-01-nvda-beat-and-drop");
    const lookup = await bridge.call("edgar_lookup_company", { query: "Intel" });
    expect(String((lookup.content[0] as { text?: string }).text)).toContain("INTC");
    const facts = await bridge.call("edgar_financials", { ticker: "INTC", statement: "income", period: "quarterly", limit: 2 });
    expect(String((facts.content[0] as { text?: string }).text)).toContain("INTC");
  });

  it("builds ONON annual IFRS figures in CHF from SEC companyfacts", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-02-nike-moat-erosion");
    const result = await bridge.call("edgar_financials", { ticker: "ONON", statement: "income", period: "annual", limit: 3 });
    const details = result.details as { periods: string[]; facts: Array<{ metric: string; period: string; value: number; unit: string }> };
    expect(details.periods).toEqual(["2023-12-31", "2022-12-31", "2021-12-31"]);
    expect(details.facts).toContainEqual(expect.objectContaining({ metric: "revenue", period: "2023-12-31", value: 1_792_100_000, unit: "CHF" }));
    expect(String((result.content[0] as { text?: string }).text)).toContain("CHF millions");
  });

  it("marks historical Alpha-shaped overviews as synthetic and resolves share-class ticker aliases", async () => {
    const nike = new MockMcpBridge(loadDataset(), "retail-02-nike-moat-erosion");
    const overview = await nike.call("alphavantage__COMPANY_OVERVIEW", { symbol: "NKE" });
    const payload = JSON.parse(String((overview.content[0] as { text?: string }).text));
    expect(payload).toMatchObject({ Symbol: "NKE", LatestTradingDay: "2024-07-05", _offline_benchmark: { synthetic: true } });
    expect(payload).not.toHaveProperty("MarketCapitalization");

    const holdings = new MockMcpBridge(loadDataset(), "retail-12-concentration-profile-fit");
    const filings = await holdings.call("edgar_filings", { ticker: "BRK.B", limit: 1 });
    expect(filings.details).toMatchObject({ entity: { ticker: "BRK-B" } });
  });

  it("finds the pre-cutoff SEC TQQQ prospectus for portfolio leverage questions", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-12-concentration-profile-fit");
    const result = await bridge.call("web_search", { query: "TQQQ leveraged ETF daily target risk", max_results: 5 });
    const urls = (result.details as { urls: string[] }).urls;
    expect(urls).toContain("https://www.sec.gov/Archives/edgar/data/1174610/000168386323006700/f36277d1.htm");
    expect(bridge.audit().events.some((event) => event.kind === "not_captured")).toBe(false);
  });

  it("treats Cameco form and date filters as a genuine corpus no-match", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-03-nuclear-thematic-purity");
    const result = await bridge.call("edgar_search_filings", { query: "Cameco", forms: ["6-K"], from: "2024-09-01", limit: 10 });
    expect(result.details).toMatchObject({ hits: [], coverageState: "empty" });
    expect(bridge.audit().events.at(-1)).toMatchObject({ kind: "empty_result" });
  });

  it("exposes globally retained issuers without a peer allowlist", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-01-nvda-beat-and-drop");
    const lookup = await bridge.call("edgar_lookup_company", { query: "Nike" });
    expect(String((lookup.content[0] as { text?: string }).text).toUpperCase()).toContain("NIKE");
    const missing = await bridge.call("edgar_lookup_company", { query: "NOT-A-REAL-TICKER" });
    expect(missing.details).toMatchObject({ empty: true });
  });

  it("returns mixed web fetch results and records non-fatal audit events", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-01-nvda-beat-and-drop");
    const search = await bridge.call("web_search", { query: "nvidia earnings" });
    const urls = (search.details as { urls: string[] }).urls;
    const fetched = await bridge.call("web_fetch", { urls: [urls[0] ?? "https://example.invalid/missing", "https://example.invalid/missing"] });
    expect((fetched.details as { fetched: string[]; failed: string[] }).failed).toContain("https://example.invalid/missing");
    expect((fetched.details as { fetched: string[] }).fetched).toContain(urls[0]);
    expect(bridge.audit().events.some((event) => event.kind === "out_of_scope")).toBe(true);
  });

  it("full-text searches only captured filing bodies and associates unhyphenated SEC accessions", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-10-smci-accounting-red-flag");
    const result = await bridge.call("edgar_search_filings", {
      query: "no basis to agree or disagree",
      forms: ["8-K"],
      from: "2024-10-30",
      to: "2024-10-30",
    });
    const details = result.details as { hits: Array<{ url: string; form: string }> };

    expect(details.hits.some((hit) => hit.url.endsWith("lettertothesectobeattach.htm") && hit.form === "8-K")).toBe(true);
    expect(String((result.content[0] as { text?: string }).text)).toContain("matching captured document bodies");
  });

  it("serves retail-04 filing indexes, prospectuses, and the dated distribution announcement", async () => {
    const db = loadDataset();
    const taskId = "retail-04-dividend-yield-trap";
    const release = db.documents.find((item) => item.taskIds.includes(taskId) && item.canonicalUrl.includes("globenewswire.com/news-release/2024/06/05/"));
    const tslyIndex = db.documents.find((item) => item.taskIds.includes(taskId) && item.canonicalUrl.includes("0001999371-24-002901-index.html"));
    const tslyProspectus = db.documents.find((item) => item.taskIds.includes(taskId) && item.canonicalUrl.endsWith("tsly-497k_022824.htm"));
    expect(release).toBeDefined();
    expect(tslyIndex).toBeDefined();
    expect(tslyProspectus).toBeDefined();
    if (!release || !tslyIndex || !tslyProspectus) return;

    const bridge = new MockMcpBridge(db, taskId);
    const filings = await bridge.call("edgar_filings", { ticker: "TSLY", forms: ["497K"] });
    const index = await bridge.call("edgar_read_filing", { url: tslyIndex.canonicalUrl });
    const prospectus = await bridge.call("edgar_read_filing", { url: tslyProspectus.canonicalUrl });
    const fetched = await bridge.call("web_fetch", { urls: [release.canonicalUrl], query: "return of investor capital total return" });

    expect(String((filings.content[0] as { text?: string }).text)).toContain("yes");
    expect(String((index.content[0] as { text?: string }).text)).toContain("tsly-497k_022824.htm");
    expect(String((prospectus.content[0] as { text?: string }).text)).toContain("TSLA Option Income Strategy ETF");
    expect(String((fetched.content[0] as { text?: string }).text)).toContain("does not represent its total return");
    expect(String((fetched.content[0] as { text?: string }).text)).toContain("return of investor capital");
  });

  it("marks filing reads as served only when source text reaches the model", async () => {
    const db = loadDataset();
    const taskId = "retail-11-nike-earnings-review-report";
    const document = db.documents.find((item) => item.taskIds.includes(taskId) && item.canonicalUrl.endsWith("q4fy24exhibit991er.htm"));
    expect(document).toBeDefined();
    if (!document) return;
    const bridge = new MockMcpBridge(db, taskId);
    const read = await bridge.call("edgar_read_filing", { url: document.canonicalUrl }, "read-source");
    const miss = await bridge.call("edgar_read_filing", { url: document.canonicalUrl, query: "zzq-no-passage" }, "read-no-match");

    expect(bridge.audit().outcomes["read-source"]).toBe("served");
    expect(bridge.audit().outcomes["read-no-match"]).toBe("empty");
    expect(String((miss.content[0] as { text?: string }).text)).toContain("No passage in this document mentions");
    expect(bridge.audit().events.at(-1)).toMatchObject({ kind: "empty_result" });
    expect(read.details).toMatchObject({ url: document.canonicalUrl });
  });

  it("labels metadata matches as not captured when no filing body is retained", async () => {
    const db = loadDataset();
    const taskId = "retail-01-nvda-beat-and-drop";
    const filing = db.filings.find((item) => item.ticker === "NVDA" && item.filedAt === "2024-07-02");
    expect(filing).toBeDefined();
    if (!filing) return;
    const accessionPath = `/${filing.accession.replaceAll("-", "")}/`;
    const testDb = { ...db, documents: db.documents.filter((document) => !document.canonicalUrl.includes(accessionPath)) };
    const bridge = new MockMcpBridge(testDb, taskId);
    const result = await bridge.call("edgar_search_filings", {
      query: filing.accession,
      forms: [filing.form],
      from: filing.filedAt,
      to: filing.filedAt,
    });

    expect(result.details).toMatchObject({ coverageState: "not_captured" });
    expect(bridge.audit().events.at(-1)).toMatchObject({ kind: "not_captured" });
  });

  it("handles legitimate SEC URL variants without guessing outside the corpus", async () => {
    const nuclear = new MockMcpBridge(loadDataset(), "retail-03-nuclear-thematic-purity");
    const peer = await nuclear.call("edgar_financials", { ticker: "VRT", statement: "key_metrics", period: "quarterly", limit: 2 });
    expect(String((peer.content[0] as { text?: string }).text)).toContain("VRT");

    const nike = new MockMcpBridge(loadDataset(), "retail-11-nike-earnings-review-report");
    const fetched = await nike.call("web_fetch", {
      urls: [
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320187&type=8-K&dateb=&owner=include&count=5",
        "https://www.sec.gov/Archives/edgar/data/320187/000032018724000028/index.html",
      ],
      query: "guidance",
    });
    expect(String((fetched.content[0] as { text?: string }).text)).toContain("Filing index");
    expect((fetched.details as { fetched: string[] }).fetched).toContain("https://www.sec.gov/Archives/edgar/data/320187/000032018724000028/0000320187-24-000028-index.htm");
  });

  it("honors the pre-open cutoff and returns the prior completed session", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-14-apple-pre-open-timing");
    const quotes = await bridge.call("market_quotes", { symbols: ["AAPL"] });
    expect(String((quotes.content[0] as { text?: string }).text)).toContain("230.1");
    expect(String((quotes.content[0] as { text?: string }).text)).not.toContain("225.91");
  });

  it("blocks a known task document that is published after the task cutoff", async () => {
    const db = loadDataset();
    const taskId = "retail-03-nuclear-thematic-purity";
    const future = { ...db.documents[0], id: "future-test-doc", availableAt: "2099-01-01", publishedAt: "2099-01-01", taskIds: [taskId], body: "future-only body" };
    const testDb = { ...db, documents: [...db.documents, future] };
    const bridge = new MockMcpBridge(testDb, taskId);
    const result = await bridge.call("web_fetch", { urls: [future.canonicalUrl] });
    expect(String((result.content[0] as { text?: string }).text)).toContain("NotAvailableAsOf");
    expect(String((result.content[0] as { text?: string }).text)).not.toContain(future.body.slice(0, 40));
    expect(bridge.audit().events.some((event) => event.kind === "not_available_as_of")).toBe(true);
  });

  it("returns honest empty results for exploratory and unrelated misses", async () => {
    const bridge = new MockMcpBridge(loadDataset(), "retail-04-dividend-yield-trap");
    const empty = await bridge.call("web_search", { query: "hyperscaler capex allocation Q3" });
    expect(String((empty.content[0] as { text?: string }).text)).toContain("No results");
    const unrelated = await bridge.call("web_search", { query: "unrelated crypto exchange collapse" });
    expect(String((unrelated.content[0] as { text?: string }).text)).toContain("No results");
    const unknown = await bridge.call("web_fetch", { urls: ["https://example.invalid/not-in-corpus"] });
    expect(String((unknown.content[0] as { text?: string }).text)).toContain("UnavailableInOfflineCorpus");
    expect(unknown.details).toEqual({ fetched: [], failed: ["https://example.invalid/not-in-corpus"] });
    expect(bridge.audit().events.map((event) => event.kind)).toContain("out_of_scope_query");
    expect(bridge.audit().events.map((event) => event.kind)).toContain("out_of_scope");
  });

  it("distinguishes a corpus no-match from an uncaptured source set", async () => {
    const sourced = new MockMcpBridge(loadDataset(), "retail-01-nvda-beat-and-drop");
    const empty = await sourced.call("web_search", { query: "zzqntestword" });
    expect(empty.details).toMatchObject({ urls: [] });
    expect(sourced.audit().events.at(-1)).toMatchObject({ kind: "empty_result" });
    expect(String((empty.content[0] as { text?: string }).text)).toContain("does not establish that no real-world source exists");

    const db = loadDataset();
    const noDocuments = new MockMcpBridge({ ...db, documents: db.documents.filter((document) => !document.taskIds.includes("retail-12-concentration-profile-fit")) }, "retail-12-concentration-profile-fit");
    const missing = await noDocuments.call("web_search", { query: "Apple annual results" });
    expect(missing.details).toMatchObject({ urls: [] });
    expect(noDocuments.audit().events.at(-1)).toMatchObject({ kind: "not_captured" });
    expect(String((missing.content[0] as { text?: string }).text)).toContain("source bodies are not captured");
  });
});
