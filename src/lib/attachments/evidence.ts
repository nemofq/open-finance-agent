/**
 * Attached files as evidence. A worksheet becomes a `U` entry the calculator can load
 * as a DataFrame; the prose of a document becomes a `U` entry holding the numbers in it, so a
 * figure the answer quotes from the file traces to something rather than reading as invented.
 *
 * Registration runs **inside the transcript replay** (`registerUserMessages`), at the position of
 * the message that carries the document and before that message's own figures. The transcript is
 * append-only and the parse is content-addressed, so the same chat always rebuilds the same ids.
 *
 * The tier is the lowest one: what the user attached is theirs, not a data provider's, and it must
 * never win a cross-check against a filing.
 */

import { extractNumbers } from "@/lib/evidence/normalizers/text";
import type { EvidenceEntry, EvidenceLedger, EvidenceSource } from "@/lib/evidence/types";
import { partsLabel, proseOf, type TableIds } from "./digest";
import type { AttachmentTablePart, ParsedAttachment, StoredAttachment } from "./types";

/** An attachment is user-provided: tier 4, below every data connection. */
export const ATTACHMENT_SOURCE: EvidenceSource = { id: "attachment", name: "User attachment", tier: 4 };

/** Maximum number of table rows stored inline in an evidence entry. */
const INLINE_ROWS = 200;

/**
 * Record one document. Prose first, then a table per worksheet, in part order: the position is what
 * the ids are derived from, so it must not depend on anything but the file itself.
 *
 * Synchronous because the replay it runs inside is; a table too large to carry inline hands its
 * payload write to the ledger, which `flush` waits for.
 */
export function registerAttachment(
  ledger: EvidenceLedger,
  document: StoredAttachment,
  parsed: ParsedAttachment | null | undefined,
): EvidenceEntry[] {
  if (!parsed) return [];
  const created: EvidenceEntry[] = [];
  const prose = proseOf(parsed);
  if (prose.trim()) {
    created.push(
      ledger.add({
        kind: "U",
        origin: "attachment",
        source: ATTACHMENT_SOURCE,
        summary: `${document.name} (attached ${parsed.kind === "pdf" ? "pdf" : "document"}, ${partsLabel(parsed)})`,
        numbers: extractNumbers(prose),
        attachment: { file: document.attachment },
      }),
    );
  }
  parsed.parts.forEach((part, index) => {
    if (part.type !== "table") return;
    created.push(registerTable(ledger, document, part, index));
  });
  return created;
}

function registerTable(
  ledger: EvidenceLedger,
  document: StoredAttachment,
  part: AttachmentTablePart,
  index: number,
): EvidenceEntry {
  const table = { columns: part.columns, rows: part.rows };
  const inline = part.rows.length <= INLINE_ROWS;
  const entry = ledger.add({
    kind: "U",
    origin: "attachment",
    source: ATTACHMENT_SOURCE,
    summary: `${document.name} › ${part.label} (${part.totalRows.toLocaleString("en-US")} rows)`,
    ...(inline ? { table } : {}),
    attachment: { file: document.attachment, part: index },
  });
  // Bigger than the ledger carries in memory: the calculator falls back to the stored payload
  // (`resolveEvidence`), and the write is skipped when the last turn already made it.
  if (!inline) void ledger.savePayload(entry.id, { table }, { onlyIfMissing: true });
  return entry;
}

/**
 * The evidence ids of `file`'s worksheets by part, for the digests that have to name them:
 * `hydrate` writes "Loaded as evidence U7" under a worksheet, and `read_attachment` repeats it.
 */
export function tableIdsFor(ledger: EvidenceLedger, file: string): TableIds {
  const byPart = new Map<number, string>();
  for (const entry of ledger.list("U")) {
    if (entry.origin === "attachment" && entry.attachment?.file === file && entry.attachment.part !== undefined) {
      byPart.set(entry.attachment.part, entry.id);
    }
  }
  return (part) => byPart.get(part);
}
