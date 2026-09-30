import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { EvalEvidenceRequirement } from "../types";

export interface ContractDocument {
  url: string;
  kind: string;
  minBodyChars: number;
  exhibits?: string[];
}

export interface ContractFinancialStatement {
  ticker: string;
  statement: "income" | "balance" | "cashflow" | "key_metrics";
  period: "quarterly" | "annual";
  minPeriods: number;
  metrics: string[];
}

export interface ContractMarketRecord {
  symbol: string;
  date: string;
}

export interface TaskEvidenceContract {
  cutoff: string;
  asOfTime?: string;
  coreTickers: string[];
  documents?: ContractDocument[];
  financialStatements?: ContractFinancialStatement[];
  market?: ContractMarketRecord[];
  alpha?: {
    daily: string[];
    earnings: string[];
    news: string[];
    verifiedEmptyNews: string[];
  };
  requiredEvidence?: EvalEvidenceRequirement[];
}

export interface EvidenceContractFile {
  version: number;
  tasks: Record<string, TaskEvidenceContract>;
}

const EVIDENCE_CONTRACT_FILE = new URL("../dataset/coverage-contract.json", import.meta.url);
export const EVIDENCE_CONTRACT = JSON.parse(readFileSync(EVIDENCE_CONTRACT_FILE, "utf8")) as EvidenceContractFile;
export const EVIDENCE_CONTRACT_HASH = createHash("sha256").update(JSON.stringify(EVIDENCE_CONTRACT)).digest("hex");

export function evidenceRequirementsForTask(taskId: string): EvalEvidenceRequirement[] {
  return EVIDENCE_CONTRACT.tasks[taskId]?.requiredEvidence ?? [];
}

/** Periods compare the way report references do: letters and digits only, case-insensitive. */
export function normalizePeriod(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Key metrics is a view over the other statements: revenue and diluted EPS from the income
 * statement, free cash flow from the cash flow statement, and so on. A fact is the same ground
 * truth whichever view served it, so a key-metrics entry satisfies any statement's requirement
 * and the underlying statement satisfies a key-metrics one. The caller still requires the entry
 * to carry the required metric (and period), which is what ties the two views together.
 */
export function sameStatement(wanted: string, actual: string): boolean {
  return wanted === actual || wanted === "key_metrics" || actual === "key_metrics";
}

/**
 * The one URL form the dataset, its contract and the checks compare: no fragment, a lowercase host
 * and no trailing slash. Throws on text that is not a URL.
 */
export function normalizeSourceUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString().replace(/\/$/, "");
}
