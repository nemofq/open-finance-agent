import { llmProviderSecretPaths } from "@/lib/llm/provider-types";
import { isRecord } from "@/lib/utils";

/**
 * Which config values are secrets, and how they cross to the browser and back: masked on the way
 * out, restored from what is on disk on the way in, so a key never leaves the process that holds
 * it. Browser-safe: no Node imports, so the settings page uses the same mask it is sent.
 */

/** Sentinel sent to the browser in place of a stored secret, and accepted back to mean "unchanged". */
export const SECRET_MASK = "••••";

/**
 * Dotted paths to secret values; `*` matches any object key or array index (array elements are
 * addressed by `id`). A module declares its own secrets as `type: "secret"` settings, which this
 * file cannot see without importing the tool registry, so the settings route adds those paths
 * (`src/app/api/settings/secrets.ts`); `modules.*.apiKey` stays as the floor for a module that is
 * no longer registered.
 */
export const secretPaths: readonly string[] = [
  ...llmProviderSecretPaths,
  "modules.*.apiKey",
  "mcp.servers.*.headers.*",
  "mcp.servers.*.env.*",
];

type Json = Record<string, unknown>;

/** A secret leaf, with a trail that identifies it stably across reorderings of an array. */
type Leaf = { holder: Json; key: string; trail: string };

/** Array elements are addressed by their `id` when they have one, so reordering keeps secrets attached. */
function step(container: unknown, key: string): string {
  const value = (container as Json)[key];
  return Array.isArray(container) && isRecord(value) && typeof value.id === "string" ? value.id : key;
}

/** Every secret leaf a `*`-wildcard path resolves to within `root`. */
function resolve(root: unknown, segments: string[], trail: string[] = []): Leaf[] {
  const [head, ...rest] = segments;
  if (!isRecord(root) && !Array.isArray(root)) return [];
  const holder = root as Json;
  const keys = head === "*" ? Object.keys(holder) : head in holder ? [head] : [];
  if (rest.length === 0) {
    return keys.map((key) => ({ holder, key, trail: [...trail, key].join(".") }));
  }
  return keys.flatMap((key) => resolve(holder[key], rest, [...trail, step(root, key)]));
}

function leaves(root: unknown, paths: readonly string[]): Leaf[] {
  return paths.flatMap((path) => resolve(root, path.split(".")));
}

/** Replace every non-empty secret string with the mask, for sending config to the browser. */
export function maskSecrets<T extends Json>(cfg: T, paths: readonly string[] = secretPaths): T {
  const clone = structuredClone(cfg);
  for (const { holder, key } of leaves(clone, paths)) {
    if (typeof holder[key] === "string" && holder[key] !== "") holder[key] = SECRET_MASK;
  }
  return clone;
}

/**
 * Swap every mask in `incoming` back for the secret at the same place in `stored`, or for "" when
 * `stored` has none there: a mask never becomes a value, and a secret never moves to a place it
 * was not saved in. Anything else in `incoming`, an edited secret included, is kept as sent.
 */
export function restoreSecrets<T extends Json>(incoming: T, stored: Json, paths: readonly string[] = secretPaths): T {
  const clone = structuredClone(incoming);
  const saved = new Map(leaves(stored, paths).map((leaf) => [leaf.trail, leaf.holder[leaf.key]]));
  for (const { holder, key, trail } of leaves(clone, paths)) {
    if (holder[key] === SECRET_MASK) holder[key] = saved.get(trail) ?? "";
  }
  return clone;
}
