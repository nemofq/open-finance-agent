"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/components/shared/http-client";
import type { SkillSummary } from "@/lib/skills/skill";
import type { Suggestion } from "./composer-menu";

/** A leading `/name` with nothing typed after it yet. */
const FRAGMENT = /^\/([A-Za-z0-9-]*)$/;

export function skillFragment(value: string): string | null {
  const match = FRAGMENT.exec(value);
  return match ? match[1].toLowerCase() : null;
}

let pending: Promise<SkillSummary[]> | null = null;

function loadSkills(): Promise<SkillSummary[]> {
  pending ??= getJson<{ skills?: SkillSummary[] }>("/api/skills")
    .then((body) => body.skills ?? [])
    .catch(() => {
      pending = null; // retry on the next open
      return [];
    });
  return pending;
}

/** The installed skills, fetched once per page load. */
export function useSkills(enabled: boolean): { items: SkillSummary[]; loading: boolean } {
  const [items, setItems] = useState<SkillSummary[] | null>(null);

  useEffect(() => {
    if (!enabled || items) return;
    let active = true;
    void loadSkills().then((skills) => active && setItems(skills));
    return () => {
      active = false;
    };
  }, [enabled, items]);

  return { items: items ?? [], loading: enabled && items === null };
}

/** Generic over the entry, so the picker can filter built-in commands and skills as one list. */
function filterSkills<T extends { name: string }>(entries: T[], prefix: string): T[] {
  if (!prefix) return entries;
  return entries.filter((entry) => entry.name.toLowerCase().startsWith(prefix));
}

function toSuggestion(entry: SkillSummary, group?: string): Suggestion {
  return { id: entry.name, primary: `/${entry.name}`, secondary: entry.description, group };
}

/**
 * The picker's items, flat so one index walks the whole list. A typed `/fragment` groups matching
 * commands above matching skills; the Skills button menu (`fragment === null`) offers the installed
 * skills alone, because a command is something you type rather than something you attach.
 */
export function pickerItems(
  skills: SkillSummary[],
  commands: SkillSummary[],
  fragment: string | null,
): Suggestion[] {
  if (fragment === null) return skills.map((skill) => toSuggestion(skill));
  return [
    ...filterSkills(commands, fragment).map((command) => toSuggestion(command, "Commands")),
    ...filterSkills(skills, fragment).map((skill) => toSuggestion(skill, "Skills")),
  ];
}
