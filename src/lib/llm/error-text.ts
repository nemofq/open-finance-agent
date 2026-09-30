/** Extracts user-facing error messages from provider error payloads. */

import { isRecord } from "@/lib/utils";

/** Long enough for a sentence a provider wrote, short enough to sit on one line under a field. */
const MAX_LENGTH = 200;

/**
 * The message inside an error body, however that provider nests it: `{ message }`,
 * `{ error: { message } }`, `{ error: "invalid_grant" }`, `{ detail }`.
 */
function messageIn(body: unknown, depth = 0): string | undefined {
  if (typeof body === "string") return body.trim() || undefined;
  if (!isRecord(body) || depth > 2) return undefined;
  for (const key of ["message", "error", "error_description", "detail"]) {
    const found = messageIn(body[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** The JSON body appended to an error, split from whatever the caller put in front of it. */
function jsonTail(text: string): { head: string; body: unknown } | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  try {
    return { head: text.slice(0, start), body: JSON.parse(text.slice(start)) };
  } catch {
    return undefined;
  }
}

function cap(text: string): string {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * What to show the user: the wire body replaced by its message, so the status code and the
 * provider's own wording survive and the JSON around them does not. Anything that is not JSON
 * keeps its first line, since a stack trace or a multi-line dump says nothing under a field.
 */
export function providerErrorText(raw: string): string {
  const text = raw.trim();
  const tail = jsonTail(text);
  const message = tail && messageIn(tail.body);
  if (message) return cap(`${tail.head.trim()} ${message}`.trim());
  return cap(text.split("\n")[0].trim());
}
