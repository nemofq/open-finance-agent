import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { contentHash } from "@/lib/evidence/hash";
import { normalizeResult } from "@/lib/evidence/register";
import { stableStringify } from "@/lib/text/stable-json";
import type { ToolMeta } from "@/lib/tools/contracts";

/**
 * The characterization snapshots' format, shared by the provider results
 * (`characterization.test.ts`) and the benchmark mock's (`evals/offline/`). Long arrays are recorded
 * as their length, a hash and their first items, so a snapshot stays readable while still catching
 * any change in them. An empty list is recorded as absent: every reader of an entry takes
 * `numbers`, `facts` and `periods` with `?? []` or `?.length`.
 */

export interface CharacterizationCase {
  label: string;
  tool: { name: string; meta: ToolMeta };
  args: Record<string, unknown>;
  result: AgentToolResult<unknown>;
}

/** Arrays past this length are summarised; the hash still pins every element. */
const LONG = 16;

function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compact);
    return items.length > LONG ? { length: items.length, sha256: contentHash(value), head: items.slice(0, 3) } : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => !Array.isArray(item) || item.length > 0).map(([key, item]) => [key, compact(item)]),
    );
  }
  return value;
}

/** What `normalizeResult` makes of each case, as the snapshot file's text. */
export function normalizedCases(cases: CharacterizationCase[]): string {
  const out = cases.map(({ label, tool, args, result }) => ({ label, tool: tool.name, entry: compact(JSON.parse(stableStringify(normalizeResult(tool, args, result), { omitUndefined: true }))) }));
  return `${JSON.stringify(out, null, 2)}\n`;
}
