/**
 * The one place the holdings vocabulary is spelled out for the UI. Every list is typed against a
 * union in the contracts, so renaming a member there breaks this build instead of silently
 * leaving a dead option behind.
 */
import type { Option } from "@/components/shared/field-row";
import type { AccountType, CostBasisMethod, InstrumentKind, TransactionType } from "@/lib/portfolio/types";

export const accountTypes: Option<AccountType>[] = [
  { value: "taxable", label: "Taxable (brokerage)" },
  { value: "ira", label: "IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "isa", label: "ISA (UK)" },
  { value: "sipp", label: "SIPP (UK)" },
  { value: "tfsa", label: "TFSA (Canada)" },
  { value: "other", label: "Other" },
];

export const costBasisMethods: Option<CostBasisMethod>[] = [
  { value: "fifo", label: "FIFO — oldest lots first" },
  { value: "lifo", label: "LIFO — newest lots first" },
  { value: "average", label: "Average cost" },
];

export const instrumentKinds: Option<InstrumentKind>[] = [
  { value: "equity", label: "Stock" },
  { value: "etf", label: "ETF" },
  { value: "fund", label: "Fund" },
  { value: "bond", label: "Bond" },
  { value: "option", label: "Option" },
  { value: "crypto", label: "Crypto" },
  { value: "cash", label: "Cash" },
];

/** The subset of the ledger's transaction types the manual form writes. */
export type ManualTransactionType = Extract<TransactionType, "buy" | "sell" | "dividend">;

export const manualTransactionTypes: Option<ManualTransactionType>[] = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
];
