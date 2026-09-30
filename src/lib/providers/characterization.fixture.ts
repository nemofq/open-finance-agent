/**
 * Provider responses for `characterization.test.ts`: what SEC EDGAR, the Alpha Vantage MCP server,
 * Tavily, Yahoo Finance and the example Acme provider answer at the `sourceRequest` seam, small but shaped like the real thing. The company
 * facts are the synthetic filer from `src/lib/providers/edgar/facts.fixture.ts`.
 */
import type { SourceRequest } from "@/lib/data/source-snapshot";
import type { AssetProfile, LiveQuote } from "@/lib/quotes/types";
import { fixtureFacts } from "@/lib/providers/edgar/facts.fixture";

const CIK = "0001234567";
const ARCHIVE = "https://www.sec.gov/Archives/edgar/data/1234567";

export const edgarUrls = {
  tickers: "https://www.sec.gov/files/company_tickers.json",
  submissions: `https://data.sec.gov/submissions/CIK${CIK}.json`,
  facts: `https://data.sec.gov/api/xbrl/companyfacts/CIK${CIK}.json`,
  index: `${ARCHIVE}/000000000025000030/0000000000-25-000030-index.htm`,
  document: `${ARCHIVE}/000000000025000030/fixt-20250729.htm`,
};

const tickers = {
  "0": { cik_str: 1234567, ticker: "FIXT", title: "Fixture Corp" },
  "1": { cik_str: 7654321, ticker: "FIXB", title: "Fixture Bancorp" },
};

const submissions = {
  cik: CIK,
  name: "Fixture Corp",
  tickers: ["FIXT"],
  exchanges: ["Nasdaq"],
  sic: "3674",
  sicDescription: "Semiconductors & Related Devices",
  fiscalYearEnd: "1231",
  category: "Large accelerated filer",
  website: "https://www.fixture.example",
  filings: {
    recent: {
      accessionNumber: ["0000000000-25-000031", "0000000000-25-000030", "0000000000-25-000020", "0000000000-25-000010"],
      filingDate: ["2025-08-12", "2025-07-30", "2025-05-01", "2025-02-15"],
      reportDate: ["2025-08-11", "2025-07-29", "2025-03-31", "2024-12-31"],
      form: ["4", "8-K", "10-Q", "10-K"],
      items: ["", "2.02,9.01", "", ""],
      primaryDocument: ["form4.xml", "fixt-20250729.htm", "fixt-20250331.htm", "fixt-20241231.htm"],
      primaryDocDescription: ["FORM 4", "8-K", "10-Q", "10-K"],
    },
  },
};

const search = {
  hits: {
    total: { value: 37 },
    hits: [
      {
        _id: "0000000000-25-000030:fixt-ex991.htm",
        _source: {
          ciks: [CIK],
          display_names: ["Fixture Corp  (FIXT)  (CIK 0001234567)"],
          file_date: "2025-07-30",
          form: "8-K",
          file_type: "EX-99.1",
          period_ending: "2025-07-29",
          items: ["2.02", "9.01"],
        },
      },
      {
        _id: "0000000000-25-000020:fixt-20250331.htm",
        _source: {
          ciks: [CIK],
          display_names: ["Fixture Corp  (FIXT)  (CIK 0001234567)"],
          file_date: "2025-05-01",
          form: "10-Q",
          file_type: "10-Q",
          period_ending: "2025-03-31",
        },
      },
    ],
  },
};

const indexHtml = `<html><body>
<div class="formGrouping"><div class="infoHead">Filing Date</div><div class="info">2025-07-30</div></div>
<table class="tableFile" summary="Document Format Files">
<tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
<tr><td>1</td><td>8-K</td><td><a href="/ix?doc=/Archives/edgar/data/1234567/000000000025000030/fixt-20250729.htm">fixt-20250729.htm</a></td><td>8-K</td><td>41234</td></tr>
<tr><td>2</td><td>PRESS RELEASE</td><td><a href="/Archives/edgar/data/1234567/000000000025000030/fixt-ex991.htm">fixt-ex991.htm</a></td><td>EX-99.1</td><td>90210</td></tr>
</table></body></html>`;

const documentHtml = `<html><body>
<p>Fixture Corp Reports Second Quarter 2025 Results</p>
<p>Revenue was $330 million, up 32% from a year ago. Diluted EPS was $1.24.</p>
<table><tr><td>Gross margin</td><td>61.5%</td></tr><tr><td>Operating income</td><td>$88 million</td></tr></table>
<p>Outlook: third-quarter revenue is expected to be $350 million, plus or minus 2%.</p>
</body></html>`;

/* ----------------------------------------------------------- Alpha Vantage */

/** What the Alpha Vantage MCP server lists; each takes a symbol and, where it can, a datatype. */
const alphaVantageTools = [
  "GLOBAL_QUOTE",
  "TIME_SERIES_DAILY",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "EARNINGS",
  "COMPANY_OVERVIEW",
  "NEWS_SENTIMENT",
  "TREASURY_YIELD",
  "ETF_PROFILE",
  "EARNINGS_CALENDAR",
  "INSIDER_TRANSACTIONS",
  "SYMBOL_SEARCH",
].map((name) => ({
  name,
  description: `Alpha Vantage ${name}`,
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string" },
      tickers: { type: "string" },
      keywords: { type: "string" },
      maturity: { type: "string" },
      datatype: { type: "string" },
    },
  },
}));

const daily = (from: number, days: number) =>
  Object.fromEntries(
    Array.from({ length: days }, (_, index) => {
      const day = `2024-08-${String(from - index).padStart(2, "0")}`;
      const close = 120 + index * 1.5;
      return [day, { "1. open": String(close - 1), "2. high": String(close + 2), "3. low": String(close - 3), "4. close": close.toFixed(2), "5. volume": String(300_000_000 + index) }];
    }),
  );

const report = (fiscalDateEnding: string, revenue: number) => ({
  fiscalDateEnding,
  reportedCurrency: "USD",
  totalRevenue: String(revenue),
  grossProfit: String(Math.round(revenue * 0.75)),
  operatingIncome: String(Math.round(revenue * 0.62)),
  netIncome: String(Math.round(revenue * 0.55)),
  ebitda: "None",
  researchAndDevelopment: "3090000000",
});

const alphaVantageBodies: Record<string, unknown> = {
  GLOBAL_QUOTE: {
    "Global Quote": {
      "01. symbol": "NVDA", "02. open": "128.1200", "03. high": "129.2000", "04. low": "123.8800", "05. price": "125.6100",
      "06. volume": "448101087", "07. latest trading day": "2024-08-28", "08. previous close": "128.3000",
      "09. change": "-2.6900", "10. change percent": "-2.0966%",
    },
  },
  TIME_SERIES_DAILY: {
    "Meta Data": { "1. Information": "Daily Prices", "2. Symbol": "NVDA", "3. Last Refreshed": "2024-08-30" },
    "Time Series (Daily)": daily(30, 12),
  },
  INCOME_STATEMENT: {
    symbol: "NVDA",
    annualReports: [report("2024-01-28", 60_922_000_000)],
    quarterlyReports: [report("2024-07-28", 30_040_000_000), report("2024-04-28", 26_044_000_000)],
  },
  BALANCE_SHEET: {
    symbol: "NVDA",
    annualReports: [{ fiscalDateEnding: "2024-01-28", reportedCurrency: "USD", totalAssets: "65728000000", totalLiabilities: "22750000000", totalShareholderEquity: "42978000000" }],
    quarterlyReports: [],
  },
  EARNINGS: {
    symbol: "NVDA",
    annualEarnings: [{ fiscalDateEnding: "2024-01-31", reportedEPS: "1.93" }],
    quarterlyEarnings: [
      { fiscalDateEnding: "2024-07-31", reportedDate: "2024-08-28", reportedEPS: "0.68", estimatedEPS: "0.64", surprise: "0.04", surprisePercentage: "6.25", reportTime: "post-market" },
      { fiscalDateEnding: "2024-04-30", reportedDate: "2024-05-22", reportedEPS: "0.61", estimatedEPS: "0.56", surprise: "0.05", surprisePercentage: "8.9286", reportTime: "post-market" },
    ],
  },
  COMPANY_OVERVIEW: {
    Symbol: "NVDA", Name: "NVIDIA Corporation", Currency: "USD", Sector: "TECHNOLOGY", LatestQuarter: "2024-07-28",
    MarketCapitalization: "3087000000000", PERatio: "58.4", EPS: "2.14", ProfitMargin: "0.553", DividendYield: "0.0003",
  },
  NEWS_SENTIMENT: {
    items: "2",
    sentiment_score_definition: "x <= -0.35: Bearish",
    feed: [
      { title: "Nvidia beats with $30 billion quarter", url: "https://news.example/a", time_published: "20240828T203000", summary: "Revenue rose 122% to $30.04 billion; guidance of $32.5 billion.", overall_sentiment_score: 0.21 },
      { title: "Chip stocks slide", url: "https://news.example/b", time_published: "20240827T140000", summary: "The index fell 1.8% ahead of results.", overall_sentiment_score: -0.12 },
    ],
  },
  TREASURY_YIELD: {
    name: "10-Year Treasury Constant Maturity Rate",
    interval: "daily",
    unit: "percent",
    data: [
      { date: "2024-08-28", value: "3.84" },
      { date: "2024-08-27", value: "3.83" },
      { date: "2024-08-26", value: "." },
    ],
  },
  ETF_PROFILE: {
    net_assets: "300000000000", net_expense_ratio: "0.002", portfolio_turnover: "0.08", dividend_yield: "0.0061", as_of_date: "2024-08-27",
    holdings: [
      { symbol: "NVDA", description: "NVIDIA CORP", weight: "0.088" },
      { symbol: "MSFT", description: "MICROSOFT CORP", weight: "0.087" },
    ],
  },
  SYMBOL_SEARCH: {
    bestMatches: [{ "1. symbol": "NVDA", "2. name": "NVIDIA Corp", "3. type": "Equity", "9. matchScore": "1.0000" }],
  },
};

/** Functions the MCP server answers in CSV. */
const alphaVantageCsv: Record<string, string> = {
  EARNINGS_CALENDAR: "symbol,name,reportDate,fiscalDateEnding,estimate,currency\nNVDA,NVIDIA CORP,2024-08-28,2024-07-31,0.64,USD\nNVDA,NVIDIA CORP,2024-11-20,2024-10-31,0.74,USD\n",
  INSIDER_TRANSACTIONS: "transaction_date,ticker,executive,executive_title,security_type,acquisition_or_disposal,shares,share_price\n2024-08-29,NVDA,HUANG JEN HSUN,CEO,Common Stock,D,120000,121.5\n2024-08-27,NVDA,HUANG JEN HSUN,CEO,Common Stock,D,120000,128.3\n2024-08-20,NVDA,KRESS COLETTE,CFO,Common Stock,D,5000,126.1\n",
};

/* ------------------------------------------------------------------- web */

const webSearch = {
  query: "Nvidia second quarter results",
  results: [
    { title: "NVIDIA Announces Financial Results for Second Quarter Fiscal 2025", url: "https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2025/", content: "Record quarterly revenue of $30.0 billion, up 15% from Q1 and up 122% from a year ago.", publishedDate: "2024-08-28" },
    { title: "Nvidia shares fall despite beat", url: "https://www.reuters.com/technology/nvidia-results-2024-08-28/", content: "Shares fell 6.9% in extended trading.", publishedDate: "2024-08-28" },
  ],
};

const webExtract = {
  results: [
    { url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581024000264/q2fy25pr.htm", title: "Exhibit 99.1", rawContent: "NVIDIA Announces Financial Results for Second Quarter Fiscal 2025\n\nRevenue of $30.0 billion, up 122% from a year ago. GAAP earnings per diluted share of $0.67. Outlook: revenue is expected to be $32.5 billion, plus or minus 2%." },
  ],
  failedResults: [{ url: "https://blocked.example/page", error: "403" }],
};

/** Answer one request at the seam, or undefined when the corpus has no answer for it. */
/** Yahoo Finance's last trade after the close, and the profiles `market_quotes` asks for beside it. */
const yahooQuotes: Record<string, LiveQuote> = {
  NVDA: { symbol: "NVDA", name: "NVIDIA Corporation", price: 125.61, previousClose: 128.3, change: -2.69, changePercent: -2.0966,
    currency: "USD", asOf: "2024-08-28T20:00:01.000Z" },
  AAPL: { symbol: "AAPL", name: "Apple Inc.", price: 226.49, previousClose: 227.18, change: -0.69, changePercent: -0.3037,
    currency: "USD", asOf: "2024-08-28T20:00:02.000Z" },
};
const yahooProfiles: Record<string, AssetProfile> = {
  NVDA: { symbol: "NVDA", name: "NVIDIA Corporation", sector: "Technology", industry: "Semiconductors" },
  AAPL: { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics" },
};

/** Only the requested symbols the fixture knows, as the quote service returns them. */
const pick = <T,>(records: Record<string, T>, symbols: unknown): Record<string, T> =>
  Object.fromEntries((Array.isArray(symbols) ? symbols : []).flatMap((symbol) => records[String(symbol)] ? [[String(symbol), records[String(symbol)]]] : []));

export function respond(request: SourceRequest): unknown {
  const { source, operation, args } = request;
  if (source === "edgar") {
    const url = String(args.url);
    if (url === edgarUrls.tickers) return JSON.stringify(tickers);
    if (url === edgarUrls.submissions) return JSON.stringify(submissions);
    if (url === "https://data.sec.gov/submissions/CIK0007654321.json") {
      return JSON.stringify({ cik: "0007654321", name: "Fixture Bancorp", tickers: ["FIXB"], exchanges: ["NYSE"], filings: { recent: {} } });
    }
    if (url === edgarUrls.facts) return JSON.stringify(fixtureFacts);
    if (url.startsWith("https://efts.sec.gov/")) return JSON.stringify(search);
    if (url === edgarUrls.index) return indexHtml;
    if (url === edgarUrls.document) return documentHtml;
    return undefined;
  }
  if (source === "mcp:alphavantage") {
    if (operation === "list-tools") return alphaVantageTools;
    if (operation in alphaVantageCsv) return alphaVantageCsv[operation];
    const body = alphaVantageBodies[operation];
    return body === undefined ? undefined : JSON.stringify(body, null, 2);
  }
  if (source === "tavily") return operation === "search" ? webSearch : webExtract;
  if (source === "yahoo-finance") return pick<LiveQuote | AssetProfile>(operation === "quotes" ? yahooQuotes : yahooProfiles, args.symbols);
  if (source === "acme") return [{ date: "2024-08-27", close: 128.3 }, { date: "2024-08-28", close: 125.61 }];
  return undefined;
}
