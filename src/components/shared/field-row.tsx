"use client";

import { type ReactNode, useId } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";

export interface Option<T extends string | number> {
  value: T;
  label: string;
}

/** The choice `EnumField` offers for an optional field; the profile shows it for a value never set too. */
export const unsetLabel = "Not set";

interface FieldProps {
  label: ReactNode;
  help?: string;
  helpUrl?: string;
  linkLabel?: string;
  /** The control, given the id its label points at. */
  children: (id: string) => ReactNode;
}

/**
 * A form control under its label, with any help beneath. The label points at the control by id
 * rather than wrapping it, so a select's name is the label alone, not the label and its option.
 */
export function Field({ label, help, helpUrl, linkLabel, children }: FieldProps) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      <FieldHelp help={help} helpUrl={helpUrl} linkLabel={linkLabel} />
    </div>
  );
}

interface EnumFieldProps<T extends string> {
  label: string;
  value: T | undefined;
  options: Option<T>[];
  help?: string;
  helpUrl?: string;
  /** Required fields drop the "Not set" choice; profile fields never set this. */
  required?: boolean;
  onChange: (next: T | undefined) => void;
}

/**
 * A select over one of the contract's unions. Unset is a real option with a `null` value, so a
 * cleared field round-trips as `undefined` and never as an empty string the schema would reject.
 */
export function EnumField<T extends string>({
  label,
  value,
  options,
  help,
  helpUrl,
  required,
  onChange,
}: EnumFieldProps<T>) {
  const items = required ? options : [{ value: null, label: unsetLabel }, ...options];

  return (
    <Field label={label} help={help} helpUrl={helpUrl}>
      {(id) => (
        <Select value={value ?? null} items={items} onValueChange={(next: T | null) => onChange(next ?? undefined)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {required ? null : <SelectItem value={null}>{unsetLabel}</SelectItem>}
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

export interface TextFieldProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  help?: string;
  type?: "text" | "date" | "number";
  step?: string;
  onChange: (next: string | undefined) => void;
}

/**
 * A text input whose empty state is `undefined`. Trimming happens on blur rather than on every
 * keystroke, so a space typed mid-word survives while a field left blank clears itself.
 */
export function TextField({ label, value, placeholder, help, type = "text", step, onChange }: TextFieldProps) {
  return (
    <Field label={label} help={help}>
      {(id) => (
        <Input
          id={id}
          type={type}
          step={step}
          inputMode={type === "number" ? "decimal" : undefined}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
          onBlur={() => onChange(value?.trim() ? value.trim() : undefined)}
        />
      )}
    </Field>
  );
}

/** A checkbox per option under one legend. The value keeps the options' order, not the order of clicks. */
export function CheckboxGroup<T extends string | number>({
  legend,
  options,
  value,
  help,
  helpUrl,
  onChange,
}: {
  legend: string;
  options: Option<T>[];
  value: readonly T[];
  help?: string;
  helpUrl?: string;
  onChange: (next: T[]) => void;
}) {
  const toggle = (option: T, checked: boolean) =>
    onChange(options.map((item) => item.value).filter((item) => (item === option ? checked : value.includes(item))));

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm leading-none font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border p-2.5">
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={value.includes(option.value)}
              onCheckedChange={(checked) => toggle(option.value, checked)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldHelp help={help} helpUrl={helpUrl} />
    </fieldset>
  );
}

/** Muted help line under a form field, with an optional link to read more or to get a key. */
export function FieldHelp({
  help,
  helpUrl,
  linkLabel = "Learn more",
}: {
  help?: string;
  helpUrl?: string;
  linkLabel?: string;
}) {
  if (!help && !helpUrl) return null;
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {help}
      {helpUrl ? (
        <>
          {help ? " " : null}
          <a
            href={helpUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-3 hover:text-foreground"
          >
            {linkLabel}
            <ExternalLinkIcon className="size-3" />
          </a>
        </>
      ) : null}
    </p>
  );
}

/** Inline result of a Validate/Test action. */
export function StatusLine({
  ok,
  children,
  className,
}: {
  ok: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn("text-xs leading-relaxed", ok ? "text-muted-foreground" : "text-destructive", className)}
    >
      {children}
    </p>
  );
}
