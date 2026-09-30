import { z } from "zod";
import { errorResponse, jsonError, readJson, sseResponse } from "@/app/api/http";
import { acceptRun } from "@/lib/agent/accept";
import { AgentConfigError } from "@/lib/agent/config-error";
import { type ActiveRun, bindRun, endRun, releaseRun, RunInProgressError } from "@/lib/agent/runs";
import { encodeSse } from "@/lib/agent/sse";
import { runTurn } from "@/lib/agent/turn";
import type { SseEvent } from "@/lib/agent/events";
import { InvalidDocuments } from "@/lib/attachments/documents";
import { InvalidImages } from "@/lib/attachments/images";
import type { MessageImageInput } from "@/lib/attachments/types";
import { readConfig } from "@/lib/config/store";
import { getSession, updateSession } from "@/lib/sessions/store";
import { resolveTimeContext } from "@/lib/time";

const messageBodySchema = z.object({
  text: z.string().optional(),
  skill: z.string().optional(),
  /** Attached images, base64 as the composer encoded them; the bytes go to disk before the turn. */
  images: z.unknown().optional(),
  /** Names of documents already uploaded to staging by `POST /api/attachments`; claimed below. */
  documents: z.unknown().optional(),
  /** The browser's IANA time zone, so the turn uses the user's local date. */
  timeZone: z.string().optional(),
});

/** The body's `images` as far as its shape goes; the store checks the type, the encoding and the size. */
function parseImages(value: unknown): MessageImageInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidImages("The attached images were not sent as a list.");
  return value.map((item) => {
    const image = item as MessageImageInput | null;
    if (!image || typeof image.data !== "string" || typeof image.mimeType !== "string") {
      throw new InvalidImages("One of the attached images arrived without its data or its type.");
    }
    return { data: image.data, mimeType: image.mimeType };
  });
}

/** The body's `documents` as far as its shape goes; the store checks every name against staging. */
function parseDocuments(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) {
    throw new InvalidDocuments("The attached documents were not sent as a list of names.");
  }
  return value as string[];
}

/**
 * How a message is refused before its stream opens. Bad attachments are the user's to fix, so they
 * get the store's own sentence back; a turn already running is its own code.
 */
function refusal(err: unknown): Response {
  if (err instanceof InvalidImages) return jsonError(err.message, 400, "invalid_images");
  if (err instanceof InvalidDocuments) return jsonError(err.message, 400, "invalid_documents");
  if (err instanceof RunInProgressError) return jsonError(err.message, 409, "run_in_progress");
  return errorResponse(err);
}

/** Send one user message and stream the agent's reply as server-sent events. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await startTurn(request, (await params).id);
  } catch (err) {
    return refusal(err);
  }
}

async function startTurn(request: Request, id: string): Promise<Response> {
  // A cross-site page could otherwise start an agent run with a `text/plain` body.
  const body = await readJson(request, messageBodySchema);
  const text = body.text?.trim() ?? "";
  const skill = body.skill?.trim() || undefined;
  const requested = parseImages(body.images);
  const requestedDocuments = parseDocuments(body.documents);
  // An attachment on its own is a message: "what do you make of this?" is in the picture, or the file.
  if (!text && !skill && requested.length === 0 && requestedDocuments.length === 0) {
    return jsonError("text or skill is required", 400);
  }

  const stored = await getSession(id);
  if (!stored) return jsonError("Session not found", 404);

  const config = readConfig();
  const time = resolveTimeContext({ timeZone: body.timeZone ?? stored.timeZone });

  /**
   * The run slot first, then the images and the documents this message claims out of staging, so a
   * turn refused as concurrent has moved nothing. Documents were parsed on upload, so claiming is two
   * renames per file; from here they ride on the user message as descriptors, and the turn hydrates
   * their text on its way to the model.
   */
  const accepted = await acceptRun(id, { images: requested, documents: requestedDocuments });
  const { reservation, images: attachments, documents } = accepted;

  // The agent is built before the stream opens, so a configuration error is a JSON 400, not an SSE frame.
  let ready: () => void = () => {};
  const built = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let failure: Response | null = null;

  /** True once this request holds the session's run slot; a rejected concurrent turn must not free another's. */
  let owned = false;
  /** The registry entry, once it exists: every event is mirrored to it so a later reader can attach. */
  let run: ActiveRun | null = null;
  /** Set by the turn's own `done` or `error`; without one, attached readers would wait forever. */
  let settled = false;

  // A closed connection is not a Stop: the run belongs to the session, keeps going and keeps
  // saving, and a page that comes back re-attaches to it (`GET …/stream`). Only the abort
  // endpoint ends a run early. So nothing is torn down when the client goes away.
  const response = sseResponse((write, close) => {
    const send = (event: SseEvent) => {
      if (event.type === "done" || event.type === "error") settled = true;
      // Mirrored before the write: a client that navigated away has closed this stream, and
      // the one it opens on its way back replays the run from the registry instead.
      run?.publish(event);
      write(encodeSse(event));
    };

    void (async () => {
      try {
        await runTurn({
          config,
          session: stored,
          text,
          skill,
          images: attachments,
          documents,
          time,
          store: { update: updateSession },
          sink: send,
          onAgent: (agent) => {
            run = bindRun(reservation, agent);
            owned = true;
            ready();
          },
        });
      } catch (err) {
        if (err instanceof AgentConfigError) {
          // The message was never accepted, so nothing in the chat points at what was just written.
          await accepted.refuse();
          failure = jsonError(err.message, 400, err.code);
        } else {
          failure = refusal(err);
        }
        ready();
      } finally {
        // A throw from outside the turn's own handler (a failed ledger flush, say) leaves the
        // attached readers with no terminal event to close on.
        if (owned && !settled) send({ type: "error", message: "The run stopped unexpectedly" });
        if (owned) endRun(id);
        else releaseRun(reservation);
        close();
      }
    })();
  });

  await built;
  if (failure) {
    await response.body?.cancel().catch(() => {});
    return failure;
  }
  return response;
}
