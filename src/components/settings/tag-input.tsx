"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { Field } from "@/components/shared/field-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface TagInputProps {
  label: string;
  /** Undefined means the field was never set; the editor treats it as an empty list. */
  value: string[] | undefined;
  placeholder?: string;
  help?: string;
  helpUrl?: string;
  onChange: (next: string[]) => void;
}

/** Free-text list editor: the profile's exclusions, metrics and account types, and a module's free-form lists. */
export function TagInput({ label, value = [], placeholder, help, helpUrl, onChange }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };

  return (
    <Field label={label} help={help} helpUrl={helpUrl}>
      {(id) => (
        <>
          <div className="flex gap-1.5">
            <Input
              id={id}
              value={draft}
              placeholder={placeholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                // The field sits inside a card, not a form, but Enter should still mean "add".
                event.preventDefault();
                add();
              }}
            />
            <Button type="button" variant="outline" onClick={add} disabled={draft.trim() === ""}>
              Add
            </Button>
          </div>
          {value.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 pt-0.5">
              {value.map((tag) => (
                <li key={tag}>
                  {/* `pr-1` and the sized icon match the composer's skill chip: the badge's own
                      `[&>svg]:size-3` does not reach an icon nested inside this button. */}
                  <Badge variant="outline" className="pr-1">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/50"
                      onClick={() => onChange(value.filter((item) => item !== tag))}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Field>
  );
}
