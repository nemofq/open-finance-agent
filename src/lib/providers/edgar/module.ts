import { Type } from "typebox";
import type { StructuredDetails } from "@/lib/evidence/types";
import type { SymbolHit } from "@/lib/tickers/types";
import { settingString } from "@/lib/tools/config";
import type { CoverageDomain, FinanceTool, Module, ToolMeta } from "@/lib/tools/contracts";
import { errorMessage } from "@/lib/utils";
import { edgarJson, padCik } from "./client";
import {
  type FinancialsDetails,
  filingsDetails,
  financialsDetails,
  lookupDetails,
  type ReadFilingDetails,
  readFilingDetails,
  searchDetails,
} from "./evidence";
import { readFiling } from "./filing";
import { capSearchToAsOf, formatFilingHits, searchFilings } from "./search";
import { formatFilings, formatProfile, loadSubmissions, recentFilings } from "./submissions";
import { loadTickerMap, requireCik, searchTickers, toSymbolHit } from "./tickers";
import type { CompanyFacts } from "./xbrl/metrics";
import { renderStatement } from "./xbrl/render";
import { buildStatementData, statementCatalog } from "./xbrl/statements";

async function loadFacts(cik: string, contact: string, signal?: AbortSignal): Promise<CompanyFacts> {
  return edgarJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`, contact, signal);
}

/**
 * Everything EDGAR returns is a filing or a fact inside one, read straight from the SEC:
 * a tier 1 primary source.
 */
function edgarMeta(coverage: CoverageDomain[], supportsAsOf: boolean): ToolMeta {
  return {
    class: "data",
    effect: "read",
    source: { id: "edgar", name: "SEC EDGAR", tier: 1, coverage },
    supportsAsOf,
  };
}

/* -------------------------------------------------------------- the tools */

const lookupParameters = Type.Object({
  query: Type.String({ description: "A ticker such as NVDA, or part of a company name such as 'Nvidia'." }),
});

function lookupTool(contact: string): FinanceTool<typeof lookupParameters, StructuredDetails> {
  return {
    name: "edgar_lookup_company",
    // A filer profile is whatever EDGAR holds today, not a point-in-time record.
    meta: edgarMeta(["filings"], false),
    label: "Look up a company on EDGAR",
    description:
      "Resolve a ticker or company name to the SEC filer behind it: legal name, CIK, tickers, exchanges and industry. Use this first when the company is ambiguous, or when a later tool reports an unknown ticker.",
    parameters: lookupParameters,
    async execute(_id, params, signal) {
      const matches = searchTickers(params.query, await loadTickerMap(contact, signal), 8);
      if (matches.length === 0) {
        const text = `No SEC filer matches "${params.query}". Only companies with a listed ticker are in EDGAR's ticker map; try a shorter part of the name.`;
        return { content: [{ type: "text", text }], details: lookupDetails(text) };
      }
      const submissions = await loadSubmissions(matches[0].cik, contact, signal);
      const profile = formatProfile(submissions);
      const others = matches
        .slice(1)
        .map((match) => `- ${match.ticker} — ${match.name} (CIK ${match.cik})`);
      const text = others.length ? `${profile}\n\nOther matches:\n${others.join("\n")}` : profile;
      return {
        content: [{ type: "text", text }],
        details: lookupDetails(text, { ticker: matches[0].ticker, submissions }),
      };
    },
  };
}

const filingsParameters = Type.Object({
  ticker: Type.String({ description: "Ticker symbol of the filer, e.g. NVDA." }),
  forms: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Form types to keep, e.g. ['8-K'], ['10-Q','10-K'], ['4'] for insider trades. Each matches its form family: the form itself and any form continuing it after '-' or '/', so '13F' finds 13F-HR and 13F-HR/A and '10-K' finds 10-K/A but not 10-KT. Omit for every recent filing.",
    }),
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 15, description: "How many filings to return." })),
});

function filingsTool(contact: string, asOf?: string): FinanceTool<typeof filingsParameters, StructuredDetails> {
  return {
    name: "edgar_filings",
    meta: edgarMeta(["filings"], true),
    label: "Recent SEC filings",
    description: `List a company's most recent SEC filings with their form type, filing date, period, 8-K items and document URLs.

To find an earnings press release: call this with forms ['8-K'], pick the filing whose items include 2.02 (results of operations), then call edgar_read_filing on that filing's index URL to list its exhibits and read Exhibit 99.1.`,
    parameters: filingsParameters,
    async execute(_id, params, signal) {
      const entry = await requireCik(params.ticker, contact, signal);
      const submissions = await loadSubmissions(entry.cik, contact, signal);
      const filings = recentFilings(submissions, { forms: params.forms, limit: params.limit ?? 15, asOf });
      const text = formatFilings(entry.ticker, submissions, filings, { asOf });
      return { content: [{ type: "text", text }], details: filingsDetails(text, entry.ticker, submissions, filings) };
    },
  };
}

const financialsParameters = Type.Object({
  ticker: Type.String({ description: "Ticker symbol of the filer, e.g. AAPL." }),
  statement: Type.Union(
    [
      Type.Literal("income"),
      Type.Literal("balance"),
      Type.Literal("cashflow"),
      Type.Literal("key_metrics"),
    ],
    {
      description: `Which table to build. Each comes quarterly or annual with these lines: ${statementCatalog}.`,
    },
  ),
  period: Type.Union([Type.Literal("quarterly"), Type.Literal("annual")], {
    description: "Fiscal quarters or fiscal years.",
  }),
  limit: Type.Optional(
    Type.Number({ minimum: 1, maximum: 20, default: 8, description: "How many periods to show, newest first." }),
  ),
});

function financialsTool(
  contact: string,
  asOf?: string,
): FinanceTool<typeof financialsParameters, FinancialsDetails> {
  return {
    name: "edgar_financials",
    meta: edgarMeta(["fundamentals", "earnings"], true),
    label: `As-reported financials, quarterly or annual (${statementCatalog})`,
    description: `Build a statement table straight from a company's XBRL facts in its own SEC filings: the authoritative, as-reported numbers, with the accession number behind each column.

Fiscal periods, not calendar ones, and no restatement smoothing, except that per-share and share-count lines are put on one share basis: after a stock split, figures filed before it are restated by the split ratio, as later filings restate comparatives, and a note names the split. Most filers never report a standalone fourth quarter, so quarterly Q4 columns are reconstructed as the fiscal year minus its first three quarters. Cash-flow lines are filed year to date, so their Q2 and Q3 are each the year-to-date figure minus the one a quarter earlier. The source line says when either happened. For a just-reported quarter, look first at the newest column here; if that quarter is not there yet (XBRL facts appear only once its 10-Q or 10-K is filed), fall back to its press release through edgar_filings plus edgar_read_filing.`,
    parameters: financialsParameters,
    async execute(_id, params, signal) {
      const entry = await requireCik(params.ticker, contact, signal);
      const facts = await loadFacts(entry.cik, contact, signal);
      const statement = buildStatementData(facts, params.statement, params.period, params.limit ?? 8, { asOf });
      const text = `${entry.ticker}\n\n${renderStatement(statement)}`;
      return { content: [{ type: "text", text }], details: financialsDetails(text, statement, entry) };
    },
  };
}

const searchParameters = Type.Object({
  query: Type.String({ description: "Exact phrase to find in the text of filings, e.g. 'data center revenue'." }),
  forms: Type.Optional(
    Type.Array(Type.String(), { description: "Restrict to these form types, e.g. ['8-K'] or ['10-K','10-Q']." }),
  ),
  from: Type.Optional(Type.String({ description: "Earliest filing date, YYYY-MM-DD." })),
  to: Type.Optional(Type.String({ description: "Latest filing date, YYYY-MM-DD." })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, default: 10, description: "How many hits to return." })),
});

function searchTool(contact: string, asOf?: string): FinanceTool<typeof searchParameters, StructuredDetails> {
  return {
    name: "edgar_search_filings",
    meta: edgarMeta(["filings"], true),
    label: "Search filing text",
    description: `Full-text search across every SEC filing document since 2001, including exhibits. The query is matched as an exact phrase, so keep it short and literal.

Use it to find which companies said something, or to locate a filing when you do not know the filer: for one company's own filings, edgar_filings is faster and complete.`,
    parameters: searchParameters,
    async execute(_id, params, signal) {
      const { params: window, capped } = capSearchToAsOf(params, asOf);
      const result = await searchFilings(window, contact, signal);
      const text = formatFilingHits(window, result, { cappedTo: capped ? asOf : undefined });
      return { content: [{ type: "text", text }], details: searchDetails(text, result) };
    },
  };
}

const readParameters = Type.Object({
  url: Type.String({
    description:
      "A sec.gov document URL from edgar_filings or edgar_search_filings. Pass the filing index URL (ending in -index.htm) to list a filing's exhibits first.",
  }),
  query: Type.Optional(
    Type.String({
      description:
        "What you are looking for, e.g. 'outlook guidance' or 'data center revenue'. Returns the matching passages instead of the top of the document.",
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({ minimum: 1000, maximum: 100000, default: 20000, description: "Character budget when no query is given." }),
  ),
});

function readTool(contact: string): FinanceTool<typeof readParameters, ReadFilingDetails> {
  return {
    name: "edgar_read_filing",
    // It reads whatever URL it is given; it cannot filter a document by date.
    meta: edgarMeta(["filings", "earnings"], false),
    label: "Read a filing",
    description: `Read an SEC filing document as plain text: 10-K and 10-Q sections, 8-K bodies, and exhibits such as an earnings press release.

Give a filing index URL and you get the list of documents in that filing, which is how you find Exhibit 99.1 on an earnings 8-K. Give a document URL and you get its text; filings are long, so pass a query and read the passages that match rather than the first 20,000 characters.`,
    parameters: readParameters,
    async execute(_id, params, signal) {
      const read = await readFiling(params.url, contact, {
        query: params.query,
        maxChars: params.maxChars,
        signal,
      });
      return {
        content: [{ type: "text", text: read.text }],
        details: readFilingDetails(params.url, read),
      };
    },
  };
}

/* ------------------------------------------------------------ the module */

export const edgarModule: Module = {
  id: "edgar",
  name: "SEC EDGAR",
  kind: "data-provider",
  description:
    "Authoritative as-reported financials (XBRL), filings and full-text search straight from the SEC. Free, no key.",
  settings: [
    {
      key: "contact",
      label: "Contact",
      type: "text",
      required: true,
      help: "The SEC requires a descriptive User-Agent with a contact for automated access, e.g. `Jane Doe jane@example.com`",
      helpUrl: "https://www.sec.gov/os/accessing-edgar-data",
    },
  ],
  defaultConfig: { enabled: true, contact: "" },
  async validate(cfg) {
    const contact = settingString(cfg, "contact");
    if (!contact) {
      return { ok: false, message: "SEC EDGAR needs a contact. Add your name and email in Settings › Data connections › SEC EDGAR." };
    }
    try {
      const map = await loadTickerMap(contact);
      return { ok: true, message: `EDGAR reachable; ${map.length.toLocaleString("en-US")} tickers loaded.` };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  },
  async createTools(cfg, ctx) {
    const contact = settingString(cfg, "contact");
    // Enabled but not configured: contribute nothing rather than a tool that always fails.
    if (!contact) return [];
    const { asOf } = ctx;
    return [
      lookupTool(contact),
      filingsTool(contact, asOf),
      financialsTool(contact, asOf),
      searchTool(contact, asOf),
      readTool(contact),
    ];
  },
  ui: {
    async searchSymbols(query, cfg): Promise<SymbolHit[]> {
      const contact = settingString(cfg, "contact");
      if (!contact) return [];
      const map = await loadTickerMap(contact);
      return searchTickers(query, map, 8).map(toSymbolHit);
    },
  },
};
