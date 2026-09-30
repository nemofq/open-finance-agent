import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { createLedger } from "./ledger";
import type { EvidenceEntry, EvidenceLedger } from "./types";

/**
 * A real ledger, payloads in memory, that already holds `entries` under their own ids, restored
 * the way a reopened chat restores them from its transcript. Not used in production.
 */
export function ledgerWith(entries: EvidenceEntry[] = [], sessionId = "test"): EvidenceLedger {
  const carrier: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "seed",
    toolName: "seed",
    content: [],
    details: { evidence: entries },
    isError: false,
    timestamp: 0,
  };
  return createLedger({ sessionId, messages: [carrier] });
}
