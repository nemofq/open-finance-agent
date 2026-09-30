"use client";

import { useId, useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ProfilePreset } from "@/lib/profile/types";

export interface PresetPickerProps {
  presets: ProfilePreset[];
  /** Fills the form from the preset; it does not save. */
  onApply: (preset: ProfilePreset) => void;
}

/**
 * Selection is a 1px border plus a 1px inset ring in the same colour, so the edge is exactly 2px the
 * whole way round, corners included; a single dark 1px border reads as uneven at the radius, and a
 * half-transparent ring stacked outside it reads as thick corners. Focus is an `outline` rather than
 * a second ring, because an outline is painted outside the border box and can be offset clear of it:
 * a card that is both checked and focused shows one crisp selection edge and one detached focus
 * ring instead of two rings fighting over the same pixels.
 */
const presetCard =
  "group flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors hover:bg-muted/50 " +
  "has-[:checked]:border-foreground has-[:checked]:bg-muted/60 has-[:checked]:inset-ring-1 has-[:checked]:inset-ring-foreground " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring/50";

/** The 30-second setup: pick a starting point, review it, then save. */
export function PresetPicker({ presets, onApply }: PresetPickerProps) {
  const name = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = presets.find((preset) => preset.id === selectedId) ?? null;

  if (presets.length === 0) return null;

  return (
    <>
      <fieldset className="space-y-3">
        <legend className="text-sm leading-none font-medium">30-second setup</legend>
        <p className="text-xs text-muted-foreground">
          Start from a preset, then change anything that does not fit. Nothing is saved until you press Save changes.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {presets.map((preset) => (
            <label key={preset.id} className={presetCard}>
              <input
                type="radio"
                name={name}
                value={preset.id}
                className="sr-only"
                checked={selectedId === preset.id}
                onChange={() => setSelectedId(preset.id)}
              />
              <span className="flex items-start justify-between gap-2 text-sm font-medium">
                {preset.name}
                {/* Reserved by `invisible` rather than `hidden`, so picking a card never reflows the grid. */}
                <CheckIcon aria-hidden className="invisible mt-0.5 size-3.5 shrink-0 group-has-[:checked]:visible" />
              </span>
              <span className="text-xs text-muted-foreground">{preset.description}</span>
            </label>
          ))}
        </div>
        <Button type="button" variant="outline" disabled={!selected} onClick={() => selected && onApply(selected)}>
          Apply preset
        </Button>
      </fieldset>
      {/* The picker's own rule, so it matches the rhythm of the field groups below and disappears
          with the picker when there are no presets. */}
      <Separator />
    </>
  );
}
