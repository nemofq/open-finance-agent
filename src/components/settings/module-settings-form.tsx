"use client";

import { useId, useState } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ModuleSummary, SettingsField } from "@/lib/tools/contracts";
import { cn } from "cn";
import { errorMessage } from "@/lib/utils";
import { postJson } from "@/components/shared/http-client";
import { PendingButton } from "@/components/shared/pending-button";
import { EnabledSwitch, SaveButton } from "@/components/shared/page-shell";
import { CheckboxGroup, EnumField, Field, FieldHelp, StatusLine } from "@/components/shared/field-row";
import { SecretField } from "./secret-field";
import { TagInput } from "./tag-input";

type ModuleConfig = Record<string, unknown>;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asBoolean = (value: unknown): boolean => value === true;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** A module's declared default, shown as the placeholder of an empty text field. */
const asPlaceholder = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value ? value : undefined;
};

/** One settings field, rendered from its declared `type`; unknown types degrade to a text input. */
function ModuleField({
  field,
  value,
  defaultValue,
  onChange,
}: {
  field: SettingsField;
  value: unknown;
  /** The module's `defaultConfig` entry for this field, offered as a placeholder for `text`. */
  defaultValue: unknown;
  onChange: (next: unknown) => void;
}) {
  const id = useId();

  if (field.type === "secret") {
    return (
      <SecretField
        label={field.label}
        value={asString(value)}
        onChange={onChange}
        help={field.help}
        helpUrl={field.helpUrl}
        required={field.required}
      />
    );
  }

  if (field.type === "toggle") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Switch id={id} checked={asBoolean(value)} onCheckedChange={onChange} />
          <Label htmlFor={id}>{field.label}</Label>
        </div>
        <FieldHelp help={field.help} helpUrl={field.helpUrl} />
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <EnumField
        label={field.label}
        value={asString(value)}
        options={field.options}
        help={field.help}
        helpUrl={field.helpUrl}
        required
        onChange={(next) => onChange(next ?? "")}
      />
    );
  }

  if (field.type === "multiselect") {
    return field.options ? (
      <CheckboxGroup
        legend={field.label}
        options={field.options}
        value={asStringArray(value)}
        help={field.help}
        helpUrl={field.helpUrl}
        onChange={onChange}
      />
    ) : (
      <TagInput
        label={field.label}
        value={asStringArray(value)}
        placeholder="Add an entry, then press Enter"
        help={field.help}
        helpUrl={field.helpUrl}
        onChange={onChange}
      />
    );
  }

  return (
    <Field label={field.label} help={field.help} helpUrl={field.helpUrl}>
      {(id) => (
        <Input
          id={id}
          value={asString(value)}
          placeholder={asPlaceholder(defaultValue)}
          required={field.required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export interface ModuleSettingsFormProps {
  module: ModuleSummary;
  config: ModuleConfig;
  onChange: (next: ModuleConfig) => void;
  /** Persists the Enabled switch at once, apart from the card's unsaved field edits. */
  onEnabledChange: (enabled: boolean) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}

/** A module's card: an Enabled switch that applies at once, auto-rendered fields, Validate and Save. */
export function ModuleSettingsForm({
  module,
  config,
  onChange,
  onEnabledChange,
  onSave,
  saving,
  dirty,
}: ModuleSettingsFormProps) {
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const setField = (key: string, next: unknown) => onChange({ ...config, [key]: next });

  // An Enabled switch saves itself, so a module with no fields has nothing for Save to do, and a
  // module with no `validate()` hook has nothing for Validate to call. With neither, drop the footer.
  const showSave = module.settings.length > 0;
  const showValidate = module.hasValidate;

  const validate = async () => {
    setValidating(true);
    setResult(null);
    try {
      setResult(
        await postJson<{ ok: boolean; message: string }>(
          `/api/settings/modules/${encodeURIComponent(module.id)}/validate`,
          { config },
        ),
      );
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setValidating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{module.name}</CardTitle>
        <CardDescription>{module.description}</CardDescription>
        <CardAction>
          <EnabledSwitch checked={asBoolean(config.enabled)} disabled={saving} onCheckedChange={onEnabledChange} />
        </CardAction>
      </CardHeader>
      {showSave ? (
        <CardContent className="space-y-4">
          {module.settings.map((field) => (
            <ModuleField
              key={field.key}
              field={field}
              value={config[field.key] ?? module.defaultConfig[field.key]}
              defaultValue={module.defaultConfig[field.key]}
              onChange={(next) => setField(field.key, next)}
            />
          ))}
        </CardContent>
      ) : null}
      {showValidate || showSave ? (
        <CardFooter className={cn("flex-wrap gap-2", showValidate ? "justify-between" : "justify-end")}>
          {showValidate ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <PendingButton type="button" variant="outline" onClick={validate} pending={validating}>
                Validate
              </PendingButton>
              {result ? <StatusLine ok={result.ok}>{result.message}</StatusLine> : null}
            </div>
          ) : null}
          {showSave ? <SaveButton dirty={dirty} saving={saving} onClick={onSave} /> : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
