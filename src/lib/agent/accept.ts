/**
 * Run acceptance: how a turn, sent from the composer or fired by the scheduler, takes a session.
 *
 * The run slot is reserved first, so a turn refused because another is in flight has touched
 * nothing on disk. Only then are the message's images written and its staged documents claimed
 * into the chat, and every file this attempt actually created or moved is recorded as it goes. A
 * refusal after that point — a bad attachment, a failed move, a model that cannot take the message —
 * undoes exactly those and frees the slot. Names are content hashes, so a file the chat already held
 * was neither written nor moved, and stays where it is.
 */
import { releaseRun, reserveRun, type RunReservation } from "@/lib/agent/runs";
import { claimDocuments, unclaimDocuments } from "@/lib/attachments/documents";
import { writeAttachments } from "@/lib/attachments/images";
import { removeAttachments } from "@/lib/attachments/store";
import type { MessageImageInput, StoredAttachment, StoredImage } from "@/lib/attachments/types";

export interface RunAttachments {
  /** Images as the composer encoded them, written to the chat's folder. */
  images?: MessageImageInput[];
  /** Names of documents waiting in staging, claimed into the chat's folder. */
  documents?: string[];
}

interface AcceptedRun {
  /** The session's run slot; bind it once the agent exists, release it if the turn never starts. */
  reservation: RunReservation;
  images: StoredImage[];
  documents: StoredAttachment[];
  /**
   * The turn will not happen after all: undo this attempt's moves, then free the slot. An image is
   * deleted — the composer still holds its bytes and re-sends them — but a document goes back to
   * staging, because it was uploaded and parsed once and the obvious next move is to send it again.
   */
  refuse(): Promise<void>;
}

/**
 * Reserve the session's run slot, then bring the turn's attachments into the chat. Throws
 * `RunInProgressError` with nothing moved when the session is busy; any other throw has already
 * been rolled back and the slot released.
 */
export async function acceptRun(sessionId: string, attachments: RunAttachments = {}): Promise<AcceptedRun> {
  const reservation = reserveRun(sessionId);
  const written: string[] = [];
  const claimed: string[] = [];
  const refuse = async () => {
    try {
      await unclaimDocuments(sessionId, claimed);
      await removeAttachments(sessionId, written);
    } finally {
      releaseRun(reservation);
    }
  };
  try {
    const images = await writeAttachments(sessionId, attachments.images ?? [], written);
    const documents = await claimDocuments(sessionId, attachments.documents ?? [], claimed);
    return { reservation, images, documents, refuse };
  } catch (err) {
    await refuse().catch(() => undefined);
    throw err;
  }
}
