import { type ThinkingLevel, thinkingLevels } from "@/lib/config/schema";

/**
 * The level a turn at `level` runs at on a model that accepts `supported` (`LlmModelInfo.thinkingLevels`),
 * so Settings can say it without loading a pi catalog in the browser. It mirrors pi-ai's
 * `clampThinkingLevel`: the level itself when accepted, else the nearest accepted one above it, else
 * below it. Off is never clamped, because the agent sends no reasoning setting for it: a model that
 * cannot turn thinking off then runs at its provider's default effort, which is `null`.
 */
export function runsAs(level: ThinkingLevel, supported: readonly ThinkingLevel[]): ThinkingLevel | null {
  if (supported.includes(level)) return level;
  if (level === "off") return null;
  const index = thinkingLevels.indexOf(level);
  const above = thinkingLevels.slice(index + 1).find((candidate) => supported.includes(candidate));
  const below = thinkingLevels.slice(0, index).findLast((candidate) => supported.includes(candidate));
  return above ?? below ?? supported[0] ?? "off";
}
