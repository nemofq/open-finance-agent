/**
 * A complete data connection for a made-up vendor, Acme, kept compiled and tested so the recipe in
 * docs/extending.md cannot drift from the contract. It is deliberately NOT in `builtinModules`
 * (src/lib/tools/registry.ts): nothing in the app loads it, and api.acme.test does not exist.
 *
 * To start a real provider, copy this folder to `src/lib/providers/<name>/`, rename, and add the
 * module to `builtinModules`. `module.test.ts` beside it shows how to test one without a network.
 */
import { Type } from "typebox";
import { sourceRequest } from "@/lib/data/source-snapshot";
import type { StructuredDetails } from "@/lib/evidence/types";
import { settingString } from "@/lib/tools/config";
import type { FinanceTool, Module, ToolMeta } from "@/lib/tools/contracts";
import { errorMessage } from "@/lib/utils";

const API = "https://api.acme.test/v1";

/** What Acme returns for one ticker: daily closes, oldest first. */
interface AcmeClose {
  date: string;
  close: number;
}

const meta: ToolMeta = {
  class: "data",
  // A data connection reads, even over the network; `external` is for general tools (ToolEffect).
  effect: "read",
  // A promise that the tool drops anything dated after `ctx.asOf`; `execute` keeps it.
  supportsAsOf: true,
  source: { id: "acme", name: "Acme", tier: 2, coverage: ["prices"] },
};

const parameters = Type.Object({
  ticker: Type.String({ description: "Ticker symbol, e.g. NVDA." }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 250, default: 30, description: "How many recent trading days to return." })),
});

/** Errors the model and the user can act on, not "request failed". */
function acmeError(status: number): Error {
  if (status === 401 || status === 403) return new Error("Acme rejected the API key. Check it in Settings › Data connections.");
  if (status === 429) return new Error("Acme returned 429, rate limited (free tier: 100 calls a day). Try again later or use another source.");
  return new Error(`Acme returned HTTP ${status}.`);
}

async function fetchCloses(apiKey: string, ticker: string, asOf: string | undefined, signal?: AbortSignal): Promise<AcmeClose[]> {
  const url = `${API}/prices?symbol=${encodeURIComponent(ticker)}${asOf ? `&before=${asOf}` : ""}`;
  // The benchmark's source seam: JSON-safe canonical arguments, never the key.
  return sourceRequest({ source: "acme", operation: "prices", args: { ticker, before: asOf ?? null } }, async () => {
    // The signal is what lets Stop cancel the request.
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
    if (!res.ok) throw acmeError(res.status);
    return (await res.json()) as AcmeClose[];
  });
}

function pricesTool(apiKey: string, asOf?: string): FinanceTool<typeof parameters, StructuredDetails> {
  return {
    name: "acme_prices",
    label: "Acme price history",
    description: "Daily closing prices for one ticker, split-adjusted, most recent last.",
    parameters,
    meta,
    async execute(_toolCallId, params, signal) {
      const ticker = params.ticker.trim().replace(/^\$/, "").toUpperCase();
      const fetched = await fetchCloses(apiKey, ticker, asOf, signal);
      // Do not trust the vendor's filter alone: `supportsAsOf` is our promise, not theirs.
      const closes = fetched.filter((row) => !asOf || row.date <= asOf).slice(-(params.limit ?? 30));
      if (closes.length === 0) throw new Error(`Acme has no prices for ${ticker}${asOf ? ` on or before ${asOf}` : ""}.`);
      const lines = closes.map((row) => `| ${row.date} | ${row.close.toFixed(2)} |`);
      return {
        content: [{ type: "text", text: [`${ticker} daily closes (USD)`, "", "| Date | Close |", "| :--- | ---: |", ...lines].join("\n") }],
        // Structured details are what the evidence ledger indexes exactly, instead of reading the text.
        details: {
          summary: `Acme daily closes, $${ticker}, ${closes.length} days`,
          asOf: closes.at(-1)?.date,
          entity: { ticker },
          unit: "USD",
          currency: "USD",
          periods: closes.map((row) => row.date),
          facts: closes.map((row) => ({ metric: "close", period: row.date, periodType: "instant", value: row.close, unit: "USD", end: row.date })),
          table: { columns: ["date", "close"], rows: closes.map((row) => [row.date, row.close]), index: "date" },
        },
      };
    },
  };
}

export const acmeModule: Module = {
  id: "acme",
  name: "Acme prices",
  kind: "data-provider",
  description: "Daily closing prices from Acme, split-adjusted.",
  settings: [
    { key: "apiKey", label: "API key", type: "secret", required: true, help: "Free tier: 100 calls a day.", helpUrl: "https://acme.test/keys" },
  ],
  defaultConfig: { enabled: false, apiKey: "" },
  async validate(cfg) {
    const apiKey = settingString(cfg, "apiKey");
    if (!apiKey) return { ok: false, message: "Enter an API key first." };
    try {
      await fetchCloses(apiKey, "IBM", undefined, AbortSignal.timeout(10_000));
      return { ok: true, message: "Acme key works." };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  },
  async createTools(cfg, ctx) {
    const apiKey = settingString(cfg, "apiKey");
    // Enabled but not configured: contribute nothing rather than a tool that always fails.
    if (!apiKey) return [];
    return [pricesTool(apiKey, ctx.asOf)];
  },
};
