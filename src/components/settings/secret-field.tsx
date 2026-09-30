"use client";

import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/shared/field-row";
import { SECRET_MASK } from "@/lib/config/secrets";

/** Shown in place of the 4-character mask sentinel so a stored key reads like a redacted key, not a short one. */
const STORED_DISPLAY = "\u2022".repeat(32);

export interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  helpUrl?: string;
  helpLinkLabel?: string;
  placeholder?: string;
  required?: boolean;
}

/**
 * Masked credential input. When the value is the server's mask sentinel the key is
 * already stored, so the field is read-only until the user chooses to replace it.
 */
export function SecretField({
  label,
  value,
  onChange,
  help,
  helpUrl,
  helpLinkLabel,
  placeholder = "Paste your key",
  required,
}: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const stored = value === SECRET_MASK;

  return (
    <Field
      label={
        <>
          {label}
          {stored ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              Stored
            </span>
          ) : null}
        </>
      }
      help={help}
      helpUrl={helpUrl}
      linkLabel={helpLinkLabel ?? "Where to get a key"}
    >
      {(id) => (
        <div className="flex gap-1.5">
          <Input
            id={id}
            value={stored ? STORED_DISPLAY : value}
            readOnly={stored}
            required={required}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            type={stored || !revealed ? "password" : "text"}
            onChange={(event) => onChange(event.target.value)}
            className="font-mono"
          />
          {stored ? (
            <Button type="button" variant="outline" onClick={() => onChange("")}>
              Replace
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={revealed ? "Hide key" : "Show key"}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}
