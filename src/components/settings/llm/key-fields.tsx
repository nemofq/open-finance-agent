"use client";

import { EnumField, Field } from "@/components/shared/field-row";
import { SecretField } from "@/components/settings/secret-field";
import { Input } from "@/components/ui/input";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { llmProviderCatalog, setupFields, setupMethod, takesKey } from "@/lib/llm/catalog";
import type { LlmSetupField } from "@/lib/llm/provider-types";

type HostedProviderConfig = Exclude<LlmProviderConfig, { type: "openai-compatible" }>;

function SettingField({
  field,
  value,
  onChange,
}: {
  field: LlmSetupField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.secret) {
    return (
      <SecretField
        label={field.label}
        value={value}
        onChange={onChange}
        help={field.help}
        placeholder={field.optional ? "Optional" : "Paste the value"}
        required={!field.optional}
      />
    );
  }
  return (
    <Field label={field.label} help={field.help}>
      {(id) => (
        <Input
          id={id}
          value={value}
          placeholder={field.optional ? `Optional${field.placeholder ? `, e.g. ${field.placeholder}` : ""}` : field.placeholder}
          className="font-mono"
          spellCheck={false}
          required={!field.optional}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * What a hosted provider that takes a key shows: how it proves itself when its row offers a choice
 * (Bedrock's key, access keys or profile), the key when that way takes one, and whatever else the
 * row's setup asks for, such as an account ID or a region. A value typed for another way is kept in
 * the draft, so switching back does not lose it, but only the current way's values are used.
 */
export function KeyProviderFields({
  provider,
  onChange,
}: {
  provider: HostedProviderConfig;
  onChange: (provider: LlmProviderConfig) => void;
}) {
  const { keyHelp, keyRequired, setup } = llmProviderCatalog[provider.type];
  const method = setupMethod(provider);
  const settings = provider.settings ?? {};

  return (
    <>
      {setup?.methods && method ? (
        <EnumField
          label="Sign in with"
          value={method.id}
          options={setup.methods.map(({ id, name }) => ({ value: id, label: name }))}
          help={method.description}
          required
          onChange={(id) => id && onChange({ ...provider, method: id })}
        />
      ) : null}
      {takesKey(provider) ? (
        <SecretField
          label={method?.key?.label ?? "API key"}
          value={provider.apiKey}
          onChange={(apiKey) => onChange({ ...provider, apiKey })}
          help={keyHelp.text}
          helpUrl={keyHelp.url}
          helpLinkLabel="Create a key"
          required={method ? true : keyRequired}
        />
      ) : null}
      {setupFields(provider).map((field) => (
        <SettingField
          key={field.name}
          field={field}
          value={settings[field.name] ?? ""}
          onChange={(value) => onChange({ ...provider, settings: { ...settings, [field.name]: value } })}
        />
      ))}
    </>
  );
}
