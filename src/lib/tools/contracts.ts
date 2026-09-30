/**
 * The tool and module contracts every capability builds against. Browser-safe: types only, no I/O
 * and no runtime imports, so the settings UI can use them without pulling in a tool implementation.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import type { StoredAttachment } from "@/lib/attachments/types";
import type { AppConfig, coverageDomains } from "@/lib/config/schema";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { Quote, SymbolHit } from "@/lib/tickers/types";

/* ------------------------------------------------------------ capabilities */

/**
 * What a tool is, so the harness knows how far to trust what it returns.
 * - `data`: a data connection (EDGAR, Alpha Vantage, an MCP server marked as data);
 * - `finance`: a deterministic financial tool (the calculator, `create_report`);
 * - `general`: everything else (web search, memory, skills, evidence_get, portfolio_get, other MCP servers).
 */
export type ToolClass = "data" | "finance" | "general";

/** 1 primary (filings, issuer), 2 licensed vendor, 3 allowlisted press, 4 open web. */
export type SourceTier = 1 | 2 | 3 | 4;

/**
 * Data domains a connection may cover; a domain nothing covers is open to web search. The list
 * lives beside the MCP server schema that validates it; a type-only import keeps this file free
 * of runtime code.
 */
export type CoverageDomain = (typeof coverageDomains)[number];

/**
 * What running a tool does, which decides how the harness treats a call.
 * - `read`: fetches without changing anything, over the network or not. Every data connection's
 *   tools are `read`; a failed read is tagged as a retrieval failure, not as evidence of absence.
 * - `compute`: works only on what it is given (the calculator, `create_report`).
 * - `write-local`: changes the user's own data (memory, scheduled tasks). Its failures do
 *   not count against the turn's progress, and the benchmark answers it with a no-op.
 * - `external`: a general tool that sends its arguments off the machine (web search and fetch, a
 *   general MCP server), so the privacy rule (P3) checks them before it runs.
 */
export type ToolEffect = "read" | "compute" | "write-local" | "external";

export interface ToolSource {
  /** Stable source id, e.g. `edgar`, `alphavantage`, or an MCP server id. */
  id: string;
  name: string;
  tier: SourceTier;
  coverage: CoverageDomain[];
}

export interface ToolMeta {
  class: ToolClass;
  /** Data tools only. */
  source?: ToolSource;
  effect: ToolEffect;
  /** Returns point-in-time results when `ModuleContext.asOf` is set. */
  supportsAsOf?: boolean;
}

/**
 * Every tool the app registers carries its metadata; a unit test fails for any that does not.
 * An interface rather than an intersection alias: TypeScript then compares two instantiations by
 * the measured variance of `AgentTool`, so a concrete `FinanceTool<typeof params, Details>` is
 * assignable to the registry's `FinanceTool[]` the way pi's own tool lists accept it.
 */
export interface FinanceTool<P extends TSchema = TSchema, D = unknown> extends AgentTool<P, D> {
  meta: ToolMeta;
}

/* ---------------------------------------------------------------- modules */

/** One field of a module's auto-rendered settings form. */
export interface SettingsField {
  key: string;
  label: string;
  type: "secret" | "text" | "toggle" | "select" | "multiselect";
  help?: string;
  helpUrl?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
}

/** Whether a turn answers a chat message or runs a scheduled task, and which task. */
export interface TurnKind {
  kind: "interactive" | "scheduled";
  taskId?: string;
}

export interface ModuleContext {
  log: (msg: string) => void;
  /** Point-in-time cutoff (YYYY-MM-DD) for tools that support it; unset on live turns. */
  asOf?: string;
  /** The turn's own date (YYYY-MM-DD) in the user's zone; `asOf` in fixed mode. Unset outside a turn. */
  localDate?: string;
  /** The chat the tools are built for. */
  session: { id: string };
  /**
   * Documents attached anywhere in this chat, including the turn being built. `read_attachment` is
   * registered only when there is at least one, and resolves a file name against this list.
   */
  documents?: StoredAttachment[];
  /** Whether tools are being built for a user-driven chat or a scheduled background turn. */
  turn?: TurnKind;
  /** The turn's evidence ledger, for tools that read or write entries (calculator, reports, evidence_get). */
  evidence: EvidenceLedger;
}

/**
 * A pluggable data provider or tool. Modules contribute agent tools, a settings
 * form, and optional hooks the UI can call directly.
 */
export interface Module {
  id: string;
  name: string;
  /** Settings grouping: data connections, financial tools, or general tools. */
  kind: "data-provider" | "financial-tool" | "tool";
  /** Shown on the module's settings card. The system prompt lists its tools by `label` instead. */
  description: string;
  settings: SettingsField[];
  defaultConfig: Record<string, unknown>;
  /**
   * Settings the module keeps outside its `config.modules` block, merged over it before
   * `createTools` sees the config. Only the MCP servers module has any (`config.mcp.servers`);
   * a new module keeps its settings in `config.modules`.
   */
  extraConfig?(config: AppConfig): Record<string, unknown>;
  validate?(cfg: Record<string, unknown>): Promise<{ ok: boolean; message: string }>;
  createTools(cfg: Record<string, unknown>, ctx: ModuleContext): Promise<FinanceTool[]>;
  /**
   * Hooks the ticker hover card and the `$` autocomplete call on an enabled module, with the same
   * config `createTools` gets.
   */
  ui?: {
    quote?(symbol: string, cfg: Record<string, unknown>): Promise<Quote | null>;
    searchSymbols?(query: string, cfg: Record<string, unknown>): Promise<SymbolHit[]>;
  };
}

/**
 * A module's settings form, serialisable and free of the module's runtime code, so the
 * browser can render `ModuleSettingsForm` for any module the server knows about.
 */
export interface ModuleSummary {
  id: string;
  name: string;
  kind: Module["kind"];
  description: string;
  settings: SettingsField[];
  defaultConfig: Record<string, unknown>;
  /** The module ships a `validate()` hook, so its card is worth offering a Validate button. */
  hasValidate: boolean;
}
