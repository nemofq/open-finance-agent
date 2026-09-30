import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonObject, ToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createLedger } from "@/lib/evidence/ledger";
import { FOLLOW_UP_BUDGET } from "@/lib/harness/concern";
import type { EvidenceLedger } from "@/lib/evidence/types";
import type { TimeContext } from "@/lib/time/types";
import type { CoverageDomain, FinanceTool, SourceTier, ToolEffect } from "@/lib/tools/contracts";
import type { RuleContext } from "./events";
import { createState } from "./state";

/**
 * Shared scaffolding for the policy tests: a real ledger with no payloads, tools that carry the
 * metadata the rules read, and a rule context whose clock is fixed. Not used in production.
 */

const parameters = Type.Object({});

function tool(name: string, meta: FinanceTool["meta"]): FinanceTool {
  return {
    name,
    label: name,
    description: name,
    parameters,
    meta,
    execute: async () => ({ content: [], details: undefined }),
  };
}

export function dataTool(
  name: string,
  source: { id: string; name: string; tier: SourceTier; coverage: CoverageDomain[] },
): FinanceTool {
  return tool(name, { class: "data", effect: "read", source });
}

export function generalTool(name: string, effect: ToolEffect = "external"): FinanceTool {
  return tool(name, { class: "general", effect });
}

export function financeTool(name: string): FinanceTool {
  return tool(name, { class: "finance", effect: "compute" });
}

/** Payloads stay in memory, so the data folder is never touched. */
export function testLedger(messages?: AgentMessage[]): EvidenceLedger {
  return createLedger({ sessionId: "policy-test", messages });
}

export function testTime(overrides: Partial<TimeContext> = {}): TimeContext {
  return {
    mode: "live",
    timeZone: "America/New_York",
    localDate: "2026-09-11",
    localTime: "11:00",
    market: {
      session: "open",
      lastCompletedSession: "2026-09-10",
      nextOpen: "2026-09-14T09:30:00-04:00",
    },
    ...overrides,
  };
}

export const TEST_NOW = Date.parse("2026-09-11T15:00:00Z");

export function testContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    ledger: overrides.ledger ?? testLedger(),
    state: overrides.state ?? createState(),
    checks: [],
    tools: [],
    time: testTime(),
    calculatorAvailable: true,
    followUpsLeft: FOLLOW_UP_BUDGET,
    tickers: [],
    now: () => TEST_NOW,
    ...overrides,
  };
}

export function toolCall(id: string, name: string, args: JsonObject): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}
