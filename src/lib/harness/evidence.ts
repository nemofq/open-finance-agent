import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { messageDocuments } from "@/lib/agent/messages";
import { registerAttachment } from "@/lib/attachments/evidence";
import { readParsed } from "@/lib/attachments/documents";
import { createLedger } from "@/lib/evidence/ledger";
import { registerToolResult } from "@/lib/evidence/register";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { registerUserFigures, registerUserMessages } from "@/lib/evidence/user";
import { dataDir } from "@/lib/paths";
import type { Concern } from "./concern";

/**
 * A chat's evidence ledger: what the tool results left on disk, plus the U entries its messages and
 * attachments give, replayed in order so every turn and `/compact` rebuild the same ids.
 */
export async function openSessionLedger(sessionId: string, messages: AgentMessage[]): Promise<EvidenceLedger> {
  const ledger = createLedger({ sessionId, dataDir: dataDir(), messages });
  await replayEvidence(sessionId, ledger, messages);
  return ledger;
}

/** Registers the U entries of the messages and their attachments, in order, and returns them. */
export async function replayEvidence(sessionId: string, ledger: EvidenceLedger, messages: AgentMessage[]) {
  const documents = messages.flatMap(messageDocuments);
  const parses = new Map(await Promise.all(documents.map(async (d) =>
    [d.attachment, await readParsed(sessionId, d.attachment).catch(() => null)] as const)));
  return registerUserMessages(ledger, messages, { documents: (d) => registerAttachment(ledger, d, parses.get(d.attachment)) });
}

/** How many confirmed companies the turn note names, most recently seen last. */
const CONFIRMED_SHOWN = 8;

/**
 * The SEC filers this chat's evidence already identified, by CIK: the company each earlier lookup
 * or filing settled on, so later calls reuse it rather than guess a ticker again. A filer with no
 * listed ticker can only be reached by its CIK, and a renamed one is easy to confuse with whoever
 * holds its old name now, so both are spelled out.
 */
export function confirmedCompanies(ledger: EvidenceLedger): string | undefined {
  const byCik = new Map<string, string>();
  for (const entry of ledger.list()) {
    const entity = entry.entity;
    if (!entity?.cik || !entity.name) continue;
    const former = entity.formerNames?.[0];
    const label = `${entity.ticker ? `$${entity.ticker}` : "no listed ticker"} = ${entity.name} (CIK ${entity.cik}${former ? `; formerly ${former}` : ""})`;
    byCik.delete(entity.cik);
    byCik.set(entity.cik, label);
  }
  const shown = [...byCik.values()].slice(-CONFIRMED_SHOWN);
  return shown.length ? `SEC filers identified in this chat: ${shown.join("; ")}. Reuse these rather than looking them up again, and pass the CIK for a filer with no listed ticker.` : undefined;
}

export const evidence: Concern = {
  name: "evidence",
  beforeTurn: (turn) => { registerUserFigures(turn.ledger, turn.request, "message"); },
  turnNote: ({ ledger }) => {
    const inputs = ledger.list("U").filter((entry) => typeof entry.value === "number").slice(-20);
    const userInputs = inputs.length ? `Recent user-provided inputs (not independently verified): ${inputs.map((entry) => `[${entry.id}] ${entry.summary}`).join("; ")}. Cite these ids and preload them in the calculator when needed.` : undefined;
    return [userInputs, confirmedCompanies(ledger)].filter(Boolean).join("\n") || undefined;
  },
  afterTool: async (call, result, turn) => {
    const registered = await registerToolResult({ ledger: turn.ledger,
      tool: call.tool ?? { name: call.name, meta: { class: "general", effect: "read" } },
      toolCallId: call.id, args: call.args, result, isError: result.isError, time: turn.time });
    return { content: registered.content, details: registered.details };
  },
};
