/**
 * Thrown by `requestJson`. The message is the route's sentence, fit to show as it stands; a caller
 * that must react to one particular refusal branches on the route's machine `code`, not the status.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** A field of a JSON body when it is a string. */
function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value: unknown = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function envelopeError(res: Response, body: unknown): HttpError {
  const fallback = res.statusText ? `${res.status} ${res.statusText}` : `Request failed (${res.status})`;
  return new HttpError(stringField(body, "error") ?? fallback, res.status, stringField(body, "code"));
}

/**
 * The `HttpError` a failed response's `{ error, code? }` envelope describes, for a caller that
 * fetched on its own because a good answer is not JSON (the chat's event stream).
 */
export async function httpErrorFrom(res: Response): Promise<HttpError> {
  return envelopeError(res, await res.json().catch(() => null));
}

/**
 * Fetch JSON, turning the `{ error, code? }` envelope our routes return into a thrown `HttpError`.
 * A body that is not JSON (a proxy's HTML error page, an empty 204) reads as `null` rather than
 * throwing a `SyntaxError`, so a failure always surfaces as the route's sentence or its status.
 * `init.body` may be JSON text or `FormData`; the helpers below set the matching headers.
 */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw envelopeError(res, body);
  return body as T;
}

/** GET without the browser's HTTP cache: every read here is of state that may just have changed. */
export function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url, { cache: "no-store" });
}

function sendJson<T>(method: "POST" | "PUT" | "PATCH", url: string, payload: unknown): Promise<T> {
  return requestJson<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** POST a JSON body; with no payload the request carries no body, as an action route expects. */
export function postJson<T>(url: string, payload?: unknown): Promise<T> {
  return payload === undefined ? requestJson<T>(url, { method: "POST" }) : sendJson<T>("POST", url, payload);
}

export function putJson<T>(url: string, payload: unknown): Promise<T> {
  return sendJson<T>("PUT", url, payload);
}

export function patchJson<T>(url: string, payload: unknown): Promise<T> {
  return sendJson<T>("PATCH", url, payload);
}

/** POST a multipart form. The browser sets the content type, boundary included. */
export function postForm<T>(url: string, form: FormData): Promise<T> {
  return requestJson<T>(url, { method: "POST", body: form });
}

/** DELETE a resource. Our routes answer 204 with no body, so there is nothing to return. */
export async function deleteJson(url: string): Promise<void> {
  await requestJson<unknown>(url, { method: "DELETE" });
}
