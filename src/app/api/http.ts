import { type z, ZodError } from "zod";
import { errorMessage, formatZodIssues } from "@/lib/utils";

// Shared by the route handlers under src/app/api. Not a route: only a `route.ts` is served.

/** Thrown for malformed input that should surface as a 400 rather than a 500. */
export class BadRequest extends Error {}

/**
 * The one error envelope every route answers with. `error` is a sentence a person can read and is
 * what the browser shows; `code`, when present, is a stable id a caller may branch on.
 */
export interface ApiErrorBody {
  error: string;
  code?: string;
}

export function jsonError(message: string, status: number, code?: string): Response {
  const body: ApiErrorBody = code === undefined ? { error: message } : { error: message, code };
  return Response.json(body, { status });
}

/** A refusal already written as a response, thrown from a helper so `errorResponse` returns it. */
class Refused extends Error {
  constructor(readonly response: Response) {
    super(`Refused with status ${response.status}`);
  }
}

/** Map a thrown value onto the `{ error }` envelope the API routes return. */
export function errorResponse(err: unknown): Response {
  if (err instanceof Refused) return err.response;
  if (err instanceof ZodError) return jsonError(formatZodIssues(err, "body"), 400);
  if (err instanceof BadRequest) return jsonError(err.message, 400);
  return jsonError(errorMessage(err), 500);
}

/**
 * 415 unless the body is declared `application/json`. A cross-site page can only send such a
 * request after a CORS preflight, which these routes never grant; `text/plain` would skip it.
 */
function requireJson(request: Request): Response | null {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return type === "application/json" ? null : jsonError("Content-Type must be application/json", 415);
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequest("Request body must be valid JSON");
  }
}

/**
 * The request's body, checked against `schema`: how every route reads one. Refuses a body not
 * declared JSON (`requireJson`), malformed JSON and a body the schema rejects, each by a throw that
 * `errorResponse` turns into the matching 415 or 400.
 */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const refused = requireJson(request);
  if (refused) throw new Refused(refused);
  return schema.parse(await readJsonBody(request));
}

/** Headers for every server-sent event stream the routes open: the chat turn, its re-attach, a sign-in. */
const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disables proxy buffering, which would otherwise hold events back.
  "X-Accel-Buffering": "no",
} as const;

/**
 * A server-sent event stream. `start` gets `write`, which sends one frame and drops it once the
 * stream is closed, and `close`, which ends the stream. What `start` returns runs once when the
 * stream ends, whether by `close` or by the client going away; a stream closed while `start` was
 * still running runs it as soon as `start` returns.
 */
export function sseResponse(start: (write: (frame: string) => void, close: () => void) => (() => void) | void): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (() => void) | void;
  const teardown = () => {
    const pending = cleanup;
    cleanup = undefined;
    pending?.();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (frame: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true; // the client went away between our check and the write
        }
      };
      const close = () => {
        teardown();
        if (closed) return;
        closed = true;
        controller.close();
      };
      cleanup = start(write, close);
      if (closed) teardown();
    },
    cancel() {
      closed = true;
      teardown();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
