/**
 * The shape the profile form edits. `PUT /api/profile` owns `updatedAt`, so the draft carries only
 * the user's own fields.
 */
import type { InvestorProfile, ProfilePreset } from "@/lib/profile/types";

export type ProfileDraft = Omit<InvestorProfile, "updatedAt">;

/** The saved profile without the server-owned fields; a missing profile edits as an empty draft. */
export function toDraft(profile: InvestorProfile | null): ProfileDraft {
  if (!profile) return {};
  return {
    experience: profile.experience,
    objectives: profile.objectives,
    risk: profile.risk,
    constraints: profile.constraints,
    jurisdiction: profile.jurisdiction,
    style: profile.style,
  };
}

/**
 * The draft with a preset applied field by field: each group the preset sets is merged into the
 * draft's group, so a field the preset leaves out (jurisdiction, exclusions, language) keeps what
 * the user typed.
 */
export function withPreset(draft: ProfileDraft, preset: ProfilePreset): ProfileDraft {
  const set = preset.profile;
  return {
    experience: merge(draft.experience, set.experience),
    objectives: merge(draft.objectives, set.objectives),
    risk: merge(draft.risk, set.risk),
    constraints: merge(draft.constraints, set.constraints),
    jurisdiction: merge(draft.jurisdiction, set.jurisdiction),
    style: merge(draft.style, set.style),
  };
}

function merge<T extends object>(current: T | undefined, preset: T | undefined): T | undefined {
  return preset ? { ...current, ...preset } : current;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Drops the keys with no value, and the whole group when nothing is left, so a field the user
 * cleared is stored as absent rather than as an empty string the contract's unions would reject.
 */
export function compactGroup<T extends object>(group: T | undefined): T | undefined {
  if (!group) return undefined;
  const entries = Object.entries(group).filter(([, value]) => !isBlank(value));
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

function trimValue(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : item)).filter((item) => item !== "");
  }
  return value;
}

function trimStrings<T extends object>(group: T | undefined): T | undefined {
  if (!group) return undefined;
  return Object.fromEntries(Object.entries(group).map(([key, value]) => [key, trimValue(value)])) as T;
}

/** The request body for a save: trimmed free text, no blank fields, no empty groups. */
export function cleanDraft(draft: ProfileDraft): ProfileDraft {
  return {
    experience: compactGroup(draft.experience),
    objectives: compactGroup(draft.objectives),
    risk: compactGroup(draft.risk),
    constraints: compactGroup(trimStrings(draft.constraints)),
    jurisdiction: compactGroup(trimStrings(draft.jurisdiction)),
    style: compactGroup(trimStrings(draft.style)),
  };
}
