import { Type } from "typebox";
import type { EvidenceDetails, EvidenceEntry } from "@/lib/evidence/types";
import { portfolioDir } from "@/lib/paths";
import { resolveTimeContext } from "@/lib/time";
import type { FinanceTool, Module, ModuleContext } from "@/lib/tools/contracts";
import { formatMoney, formatQuantity } from "./format";
import { compareHoldings, type HoldingChange, type HoldingComparison, replayLedger } from "./holdings";
import { createPortfolioStore } from "./store";
import type { Account, ImportBatch, InstrumentKind, PortfolioSnapshot, PortfolioStore, Position } from "./types";

const parameters = Type.Object({
  mode: Type.Optional(
    Type.Union([Type.Literal("current"), Type.Literal("history"), Type.Literal("compare")], {
      description:
        "current (default): what is held now or on `asOf`. history: when holdings files were imported. compare: what changed between `beforeAsOf` and `afterAsOf`.",
    }),
  ),
  accountId: Type.Optional(
    Type.String({ description: "Limit the answer to one account, by its id. Omit for every account." }),
  ),
  asOf: Type.Optional(
    Type.String({
      description:
        "Point-in-time date (YYYY-MM-DD): holdings as they were after the last transaction on or before it. Defaults to the turn's date.",
    }),
  ),
  beforeAsOf: Type.Optional(Type.String({ description: "compare mode: the earlier date (YYYY-MM-DD)." })),
  afterAsOf: Type.Optional(Type.String({ description: "compare mode: the later date (YYYY-MM-DD)." })),
});

const description = `Read the user's own holdings from their local ledger: accounts, positions, quantity, cost basis, average cost, weight by cost, cash balances and realized gains.

This is the only way holdings reach you, and each call is visible to the user as a tool card, so call it when the question is about what they hold and not otherwise.

Three modes: \`current\` (the default) reads holdings now or on \`asOf\`; \`history\` lists the holdings files the user has imported and when; \`compare\` reports how positions changed between \`beforeAsOf\` and \`afterAsOf\`, as quantity and cost differences only.

It returns no market prices and no valuations, in any mode, and it never infers a trade or a return from a change. Fetch quotes with a data tool when you need current value, and compute the value with the calculator so the arithmetic is checked.`;

function portfolioGet(ctx: ModuleContext): FinanceTool<typeof parameters, EvidenceDetails> {
  return {
    name: "portfolio_get",
    label: "Read holdings",
    description,
    parameters,
    meta: { class: "general", effect: "read", supportsAsOf: true },
    async execute(_toolCallId, params) {
      // The ledger lives in the data folder's `portfolio/` subfolder, and `portfolioDir()` is the
      // single definition of where that is.
      const store = createPortfolioStore(portfolioDir());
      const accounts = await store.listAccounts();
      if (accounts.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No accounts yet. The user adds them on the Portfolio page; until then you have no view of what they hold.",
            },
          ],
          details: {},
        };
      }

      const scoped = params.accountId ? accounts.filter((account) => account.id === params.accountId) : accounts;
      if (scoped.length === 0) {
        const known = accounts.map((account) => `${account.name} (${account.id})`).join(", ");
        return {
          content: [{ type: "text", text: `No account with id ${params.accountId}. Accounts: ${known}.` }],
          details: {},
        };
      }

      if (params.mode === "history") {
        return { content: [{ type: "text", text: await renderHistory(store, scoped) }], details: {} };
      }

      if (params.mode === "compare") {
        const { beforeAsOf, afterAsOf } = params;
        if (!beforeAsOf || !afterAsOf) {
          return {
            content: [{ type: "text", text: "compare mode needs both beforeAsOf and afterAsOf as YYYY-MM-DD dates." }],
            details: {},
          };
        }
        const evidence: EvidenceEntry[] = [];
        const register = registrar(ctx, evidence);
        const comparisons = await Promise.all(
          scoped.map((account) => compareHoldings(store, account.id, { asOf: beforeAsOf }, { asOf: afterAsOf })),
        );
        const text = renderComparisons(scoped, comparisons, register);
        return { content: [{ type: "text", text }], details: { evidence } };
      }

      // Outside a turn there is no user's date to use, so the server's stands in.
      const { snapshot } = await replayLedger(store, params.asOf ?? ctx.localDate ?? resolveTimeContext().localDate);

      const evidence: EvidenceEntry[] = [];
      const text = render(snapshot, scoped, registrar(ctx, evidence));

      return { content: [{ type: "text", text }], details: { evidence } };
    },
  };
}

/** One U entry per figure, so the model can cite a holding the same way it cites a filing. */
type RegisterEntry = (entry: Omit<EvidenceEntry, "id" | "fetchedAt">) => string;

function registrar(ctx: ModuleContext, collected: EvidenceEntry[]): RegisterEntry {
  return (entry) => {
    const added = ctx.evidence.add(entry);
    collected.push(added);
    return ` [${added.id}]`;
  };
}

function render(snapshot: PortfolioSnapshot, accounts: Account[], register: RegisterEntry): string {
  const lines = [`Holdings as of ${snapshot.asOf}, from the user's own ledger.`];

  for (const account of accounts) {
    const positions = snapshot.positions.filter((position) => position.accountId === account.id);
    const cash = snapshot.cash.filter((balance) => balance.accountId === account.id);
    const gains = snapshot.realizedGains.filter((gain) => gain.accountId === account.id);
    const totalCost = positions.reduce((sum, position) => sum + position.costBasis, 0);

    lines.push("");
    lines.push(
      `${account.name}${account.institution ? ` · ${account.institution}` : ""} — ${account.type}, base currency ${account.baseCurrency}, ${account.costBasisMethod} cost basis`,
    );

    if (positions.length === 0) lines.push("  No open positions.");
    for (const position of positions) {
      lines.push(`  ${positionLine(position, account, totalCost, snapshot.asOf, register)}`);
    }

    for (const balance of cash) {
      lines.push(`  Cash: ${formatMoney(balance.amount, balance.currency)}`);
    }
    if (positions.length > 0) {
      lines.push(`  Total cost basis: ${formatMoney(totalCost, account.baseCurrency)}`);
    }
    if (gains.length > 0) {
      const realized = gains.reduce((sum, gain) => sum + gain.amount, 0);
      lines.push(
        `  Realized gains to ${snapshot.asOf}: ${formatMoney(realized, account.baseCurrency)} over ${gains.length} disposal${gains.length === 1 ? "" : "s"}`,
      );
    }
  }

  lines.push("");
  lines.push(
    "No market prices or valuations are included: fetch a quote with a data tool (it arrives as an E entry) and value the position with the calculator.",
  );
  return lines.join("\n");
}

function positionLine(
  position: Position,
  account: Account,
  totalCost: number,
  asOf: string,
  register: RegisterEntry,
): string {
  const symbol = position.instrument.symbol;
  const units = unitLabel(position.instrument.kind);
  const quantityId = register({
    kind: "U",
    origin: "holdings",
    name: `${symbol} quantity`,
    value: position.quantity,
    summary: `${symbol}: ${formatQuantity(position.quantity)} ${units} held in ${account.name}`,
    asOf,
    entity: { ticker: symbol },
  });
  const costId = register({
    kind: "U",
    origin: "holdings",
    name: `${symbol} cost basis`,
    value: position.costBasis,
    summary: `${symbol}: cost basis ${formatMoney(position.costBasis, account.baseCurrency)} in ${account.name}`,
    asOf,
    currency: account.baseCurrency,
    entity: { ticker: symbol },
  });
  const cost = formatMoney(position.costBasis, account.baseCurrency);
  const average = formatMoney(position.averageCost, account.baseCurrency);
  const weight = totalCost > 0 ? ` ${((position.costBasis / totalCost) * 100).toFixed(1)}% of account cost` : "";
  return `${symbol}  ${formatQuantity(position.quantity)} ${units}${quantityId}  cost ${cost}${costId}  avg ${average}${weight}`;
}

/**
 * When holdings files were imported. Metadata, not figures, so nothing here becomes an evidence
 * entry: there is no number a user could be identified by in a date and a row count.
 */
async function renderHistory(store: PortfolioStore, accounts: Account[]): Promise<string> {
  const lines = ["Holdings imports in the user's own ledger."];
  for (const account of accounts) {
    const batches = [...(await store.listImportBatches(account.id))].sort((a, b) =>
      b.fetchedAt.localeCompare(a.fetchedAt),
    );
    lines.push("");
    lines.push(accountLine(account));
    if (batches.length === 0) {
      lines.push("  No imports; anything held here was entered by hand on the Portfolio page.");
      continue;
    }
    for (const batch of batches) lines.push(`  ${batchLine(batch)}`);
  }
  lines.push("");
  lines.push(
    "An import states what the account held on its date. Use compare mode to see what changed between two of them.",
  );
  return lines.join("\n");
}

function batchLine(batch: ImportBatch): string {
  const positions = `${batch.count} position${batch.count === 1 ? "" : "s"}`;
  return `${batch.from} — ${positions} from ${batch.provider} (imported ${batch.fetchedAt})`;
}

/**
 * What changed between two dates. Quantities and costs only: a change in a holding is not a trade,
 * and the difference between two cost bases is not a return.
 */
function renderComparisons(
  accounts: Account[],
  comparisons: HoldingComparison[],
  register: RegisterEntry,
): string {
  const byAccount = new Map(comparisons.map((comparison) => [comparison.accountId, comparison]));
  const [first] = comparisons;
  const lines = [`Change in the user's own holdings between ${first.beforeAsOf} and ${first.afterAsOf}.`];

  for (const account of accounts) {
    const comparison = byAccount.get(account.id);
    lines.push("");
    lines.push(accountLine(account));
    if (!comparison || (comparison.changes.length === 0 && comparison.cash.length === 0)) {
      lines.push("  No change.");
      continue;
    }
    for (const change of comparison.changes) {
      lines.push(`  ${changeLine(change, account, comparison, register)}`);
    }
    for (const movement of comparison.cash) {
      lines.push(
        `  Cash ${movement.currency}: ${formatMoney(movement.before, movement.currency)} → ${formatMoney(movement.after, movement.currency)} (${signed(movement.delta)})`,
      );
    }
  }

  lines.push("");
  lines.push(
    "These are differences in what is held, not trades: the ledger records no sale unless the user entered one, and no valuation is implied.",
  );
  return lines.join("\n");
}

function changeLine(
  change: HoldingChange,
  account: Account,
  comparison: HoldingComparison,
  register: RegisterEntry,
): string {
  const id = register({
    kind: "U",
    origin: "holdings",
    name: `${change.symbol} quantity change`,
    value: change.quantityDelta,
    summary: `${change.symbol}: ${formatQuantity(change.before?.quantity ?? 0)} → ${formatQuantity(change.after?.quantity ?? 0)} in ${account.name}, ${comparison.beforeAsOf} to ${comparison.afterAsOf}`,
    asOf: comparison.afterAsOf,
    entity: { ticker: change.symbol },
  });
  const cost = `cost ${formatMoney(change.before?.costBasis ?? 0, account.baseCurrency)} → ${formatMoney(change.after?.costBasis ?? 0, account.baseCurrency)}`;
  return `${change.symbol}  ${change.status}: ${formatQuantity(change.before?.quantity ?? 0)} → ${formatQuantity(change.after?.quantity ?? 0)} (${signed(change.quantityDelta)})${id}  ${cost}`;
}

function accountLine(account: Account): string {
  return `${account.name}${account.institution ? ` · ${account.institution}` : ""} — ${account.type}, base currency ${account.baseCurrency}`;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatQuantity(value)}`;
}

function unitLabel(kind: InstrumentKind): string {
  if (kind === "option") return "contracts";
  if (kind === "equity" || kind === "etf" || kind === "fund") return "shares";
  return "units";
}

export const portfolioModule: Module = {
  id: "portfolio",
  name: "Holdings",
  kind: "tool",
  description:
    "The user's own accounts and positions, entered on the Portfolio page and stored locally. Holdings reach the model only when it calls portfolio_get, never automatically.",
  settings: [],
  defaultConfig: { enabled: true },
  async createTools(_cfg, ctx) {
    return [portfolioGet(ctx)];
  },
};
