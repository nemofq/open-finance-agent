/**
 * The last step before the provider: the transcript keeps descriptors, and
 * this puts the content back. Images regain their base64; documents gain one text block each,
 * holding either the whole file or a digest of it, sized to the model's window.
 *
 * Run from `convertToLlm`, so it happens on every model call and nothing large is ever written to
 * the session file. pi's contract for that hook is that it never throws: an attachment whose file
 * has gone becomes a line saying so, and the turn carries on without it.
 */

import type { Api, ImageContent, Message, Model, TextContent } from "@earendil-works/pi-ai";
import type { StoredAttachment } from "@/lib/attachments/types";
import type { EvidenceLedger } from "@/lib/evidence/types";
import { fitsInline, inlineBudget } from "./budget";
import { digestOf, fullText, partsLabel } from "./digest";
import { tableIdsFor } from "./evidence";
import { readParsed } from "./documents";
import { attachmentOf, readAttachment } from "./store";

export interface HydrateOptions {
  /** The chat's model; its window decides how much of a document is inlined. */
  model: Pick<Model<Api>, "contextWindow">;
  /** The turn's ledger, so a worksheet's digest can name the id that loads it. */
  ledger: EvidenceLedger;
}

/**
 * Put images and documents back into the messages on their way out. Replaces the earlier
 * `hydrateImages`, which did the first half of this.
 */
export async function hydrateAttachments(sessionId: string, messages: Message[], options: HydrateOptions): Promise<Message[]> {
  const budget = inlineBudget(options.model.contextWindow);

  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user") return message;
      const documents = message.documents ?? [];
      // A message with nothing attached keeps the shape it had, string content included.
      const existing: (TextContent | ImageContent)[] = Array.isArray(message.content)
        ? message.content
        : [{ type: "text", text: message.content }];
      if (documents.length === 0 && !existing.some((block) => attachmentOf(block))) return message;

      const inline = fitsInline(documents, budget);
      const [content, blocks] = await Promise.all([
        Promise.all(existing.map((block) => hydrateBlock(sessionId, block))),
        Promise.all(documents.map((document, index) => documentBlock(sessionId, document, inline[index], options.ledger))),
      ]);
      // `documents` is ours, not pi's, and its content is now in the message itself.
      const next = { ...message, content: [...content, ...blocks] };
      delete next.documents;
      return next;
    }),
  );
}

async function hydrateBlock(sessionId: string, block: TextContent | ImageContent): Promise<TextContent | ImageContent> {
  if (block.type !== "image") return block;
  const name = attachmentOf(block);
  if (!name) return block;
  const bytes = await readAttachment(sessionId, name).catch(() => null);
  if (!bytes) return { type: "text", text: "(image unavailable)" };
  // `attachment` and `bytes` are ours, not pi's; only the image block itself goes on the wire.
  return { type: "image", data: bytes.toString("base64"), mimeType: block.mimeType };
}

/** One document as the model reads it, framed so it is unmistakably data rather than instruction. */
async function documentBlock(
  sessionId: string,
  document: StoredAttachment,
  inline: boolean,
  ledger: EvidenceLedger,
): Promise<TextContent> {
  const parsed = await readParsed(sessionId, document.attachment).catch(() => null);
  if (!parsed) return { type: "text", text: `(attachment unavailable: ${document.name})` };

  const tableId = tableIdsFor(ledger, document.attachment);
  const body = inline ? fullText(parsed, document, tableId) : digestOf(parsed, document, tableId);
  const attributes = [
    `name="${escapeAttribute(document.name)}"`,
    `kind="${document.kind}"`,
    `parts="${escapeAttribute(partsLabel(parsed))}"`,
  ].join(" ");
  return { type: "text", text: `<attachment ${attributes}>\n${fence(body)}\n</attachment>` };
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The file's own text must not be able to close the frame it is quoted inside — a memo ending in
 * `</attachment>` followed by an instruction is the obvious first try at prompt injection.
 */
function fence(body: string): string {
  return body.replace(/<(\/?)attachment\b/gi, "&lt;$1attachment");
}
