import { registerAttachment } from "@/lib/attachments/evidence";
import { hydrateAttachments, type HydrateOptions } from "@/lib/attachments/hydrate";
import { readParsed } from "@/lib/attachments/documents";
import type { StoredAttachment } from "@/lib/attachments/types";
import type { Concern } from "./concern";

export const attachments = (sessionId: string, model: HydrateOptions["model"], documents: StoredAttachment[] = []): Concern => ({
  name: "attachments",
  beforeTurn: async (turn) => {
    for (const document of documents) {
      const parsed = await readParsed(sessionId, document.attachment).catch(() => null);
      registerAttachment(turn.ledger, document, parsed);
    }
    await turn.ledger.flush();
  },
  toLlm: (messages, turn) => hydrateAttachments(sessionId, messages, { model, ledger: turn.ledger }),
});
