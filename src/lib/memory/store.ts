import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isMissingFile, writeFileAtomic } from "@/lib/atomic-write";
import { ensureDataDirs, memoryPath } from "@/lib/paths";
import { runSerially } from "@/lib/process-state";

/**
 * What a missing memory.md reads as, so the model and the Settings page always see the three
 * standard sections to write into. It reaches disk only with the first write. Who the user is as
 * an investor belongs to the investor profile (`src/lib/profile/`), not here.
 */
export const memoryTemplate = `# Memory

## Preferences
<!-- output style, favourite metrics, sources to prefer or avoid -->

## Watchlist
<!-- one bullet per $TICKER with the reason it is tracked -->

## Notes
<!-- durable facts learned across sessions, dated -->
`;

/**
 * Beyond this the file stops being useful as a system-prompt preamble. Every write, the tool's and
 * Settings', is refused when it would leave the file over it; the prompt's truncation only guards
 * a file grown past it in another editor.
 */
export const maxMemoryChars = 32_000;

export type MemoryOperation = "append" | "replace" | "remove";

export interface MemoryUpdate {
  operation: MemoryOperation;
  section: string;
  content?: string;
  match?: string;
}

export interface MemoryResult {
  ok: boolean;
  message: string;
}

export type MemorySave =
  | { ok: true; content: string; revision: string }
  | { ok: false; code: "memory_changed" | "memory_too_large"; message: string };

const headingRe = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const bulletRe = /^\s*[-*+]\s+/;

/** A file saved on Windows or pasted from one must not look like different lines to the section parser. */
function toLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Notes are single bullets: collapsing newlines keeps one from adding a heading or stray lines. */
function oneLine(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Accepts "Watchlist" or "## Watchlist"; comparison is case-insensitive. */
function normaliseSection(section: string): string {
  return oneLine(section).replace(/^#+\s*/, "").trim();
}

function heading(line: string): { level: number; text: string } | null {
  const m = headingRe.exec(line);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

/**
 * Line indices `[start, end)` of a section's body, or null when the heading is absent. Any heading
 * level counts, so a hand-edited `# Watchlist` is found rather than duplicated; the body runs to
 * the next heading of the same or a higher level.
 */
function sectionBody(lines: string[], name: string): [number, number] | null {
  const wanted = name.toLowerCase();
  const at = lines.findIndex((line) => heading(line)?.text.toLowerCase() === wanted);
  if (at === -1) return null;
  const level = heading(lines[at])?.level ?? 1;
  let end = at + 1;
  while (end < lines.length) {
    const next = heading(lines[end]);
    if (next && next.level <= level) break;
    end += 1;
  }
  return [at + 1, end];
}

/** Indices of the bullets in the range whose text contains `match`, case-insensitively. */
function findBullets(lines: string[], [start, end]: [number, number], match: string): number[] {
  const needle = match.toLowerCase();
  const found: number[] = [];
  for (let i = start; i < end; i += 1) {
    if (bulletRe.test(lines[i]) && lines[i].toLowerCase().includes(needle)) found.push(i);
  }
  return found;
}

const bulletText = (line: string) => line.replace(bulletRe, "").trim();

/**
 * Only a missing file means "no memory yet". Any other failure propagates, so a turn or the route
 * reports it; reading never writes, so it can never replace the user's file with the template.
 */
export async function readMemory(): Promise<string> {
  try {
    return toLf(await readFile(memoryPath(), "utf8"));
  } catch (err) {
    if (isMissingFile(err)) return memoryTemplate;
    throw err;
  }
}

/** Identifies one version of memory.md, so Settings can tell that it changed under the user. */
export function memoryRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Refuses a result over the limit, unless it shrinks a file already over it (edited elsewhere), so
 * it can still be condensed step by step.
 */
function sizeRefusal(next: string, current: string): string | null {
  if (next.length <= maxMemoryChars || next.length < current.length) return null;
  return `memory.md would be ${next.length.toLocaleString("en-US")} characters, over the ${maxMemoryChars.toLocaleString("en-US")}-character limit.`;
}

/** Atomic write so a crash mid-update cannot truncate the user's memory. Callers check the size. */
async function writeMemory(content: string): Promise<void> {
  ensureDataDirs();
  await writeFileAtomic(memoryPath(), content, { mode: 0o600 });
}

/** Every write goes through one queue per file, so a Settings save and the tool never interleave. */
function serially<T>(task: () => Promise<T>): Promise<T> {
  return runSerially(path.resolve(memoryPath()), task);
}

/**
 * Settings' save: replaces the whole file, but only if it is still the version the page loaded
 * (`revision`), checked inside the same queue as the tool's writes so neither loses the other's.
 */
export function saveMemory(content: string, revision: string): Promise<MemorySave> {
  return serially(async () => {
    const current = await readMemory();
    if (memoryRevision(current) !== revision) {
      return {
        ok: false,
        code: "memory_changed",
        message: "Memory changed since you opened it, possibly because the agent updated it. Your text was not saved.",
      };
    }
    const next = toLf(content);
    const refusal = sizeRefusal(next, current);
    if (refusal) return { ok: false, code: "memory_too_large", message: `${refusal} Shorten it before saving.` };
    await writeMemory(next);
    return { ok: true, content: next, revision: memoryRevision(next) };
  });
}

/** Insert a bullet after the last non-blank line of the section, keeping trailing blanks. */
function appendBullet(lines: string[], [start, end]: [number, number], bullet: string): void {
  let at = end;
  while (at > start && lines[at - 1].trim() === "") at -= 1;
  lines.splice(at, 0, bullet);
}

/**
 * Updates run one at a time: the agent may call the tool several times in parallel, a scheduled
 * turn may run beside a chat, and each update is a read-modify-write.
 */
export function updateMemory(update: MemoryUpdate): Promise<MemoryResult> {
  return serially(() => applyUpdate(update));
}

async function applyUpdate(update: MemoryUpdate): Promise<MemoryResult> {
  const { operation } = update;
  const content = oneLine(update.content);
  const match = oneLine(update.match);
  const section = normaliseSection(update.section);
  if (!section) return { ok: false, message: "A section name is required." };

  const current = await readMemory();
  const lines = current.split("\n");
  const body = sectionBody(lines, section);

  const commit = async (success: string): Promise<MemoryResult> => {
    const next = lines.join("\n");
    const refusal = sizeRefusal(next, current);
    if (refusal) {
      return { ok: false, message: `${refusal} Nothing was saved. Condense or remove existing entries (replace/remove), then retry.` };
    }
    await writeMemory(next);
    return { ok: true, message: success };
  };

  if (operation === "append") {
    if (!content) return { ok: false, message: "`content` is required to append." };
    const bullet = `- ${content}`;
    if (body) {
      appendBullet(lines, body, bullet);
    } else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push("", `## ${section}`, bullet, "");
    }
    return commit(`Appended to "## ${section}".`);
  }

  if (!body) return { ok: false, message: `No "## ${section}" section in memory.md.` };
  if (!match) return { ok: false, message: "`match` is required to replace or remove." };

  const found = findBullets(lines, body, match);
  if (found.length === 0) {
    return { ok: false, message: `No bullet in "## ${section}" contains "${match}".` };
  }
  const texts = found.map((i) => bulletText(lines[i]));
  // Identical duplicates are one entry: acting on the first is what any choice would do.
  if (new Set(texts).size > 1) {
    return {
      ok: false,
      message: `"${match}" matches ${found.length} bullets in "## ${section}"; nothing was changed. Use a more distinctive \`match\`:\n${texts.map((text) => `- ${text}`).join("\n")}`,
    };
  }
  const [at] = found;
  const previous = texts[0];

  if (operation === "replace") {
    if (!content) return { ok: false, message: "`content` is required to replace." };
    lines[at] = `- ${content}`;
    return commit(`Replaced "${previous}" in "## ${section}".`);
  }

  lines.splice(at, 1);
  return commit(`Removed "${previous}" from "## ${section}".`);
}
