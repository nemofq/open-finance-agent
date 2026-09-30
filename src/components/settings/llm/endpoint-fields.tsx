"use client";

import { Field, StatusLine } from "@/components/shared/field-row";
import { SecretField } from "@/components/settings/secret-field";
import { Input } from "@/components/ui/input";
import type { OpenAICompatibleProviderConfig } from "@/lib/config/schema";
import { llmProviderCatalog } from "@/lib/llm/catalog";
import { isHttpUrl, normalizeBaseUrl } from "./drafts";

export type EndpointDraft = Pick<OpenAICompatibleProviderConfig, "name" | "baseUrl" | "apiKey">;

export interface EndpointFieldsProps {
  value: EndpointDraft;
  onChange: (fields: Partial<EndpointDraft>) => void;
}

/** Name, base URL and optional key of an OpenAI-compatible endpoint; shared by the add dialog and the card. */
export function EndpointFields({ value, onChange }: EndpointFieldsProps) {
  const urlInvalid = value.baseUrl.trim() !== "" && !isHttpUrl(value.baseUrl);

  return (
    <>
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={value.name}
            placeholder="Local vLLM"
            required
            onChange={(event) => onChange({ name: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="Base URL"
        help={urlInvalid ? undefined : "Everything before /chat/completions; it usually ends in /v1."}
      >
        {(id) => (
          <>
            <Input
              id={id}
              value={value.baseUrl}
              placeholder="https://api.example.com/v1"
              className="font-mono"
              required
              spellCheck={false}
              aria-invalid={urlInvalid || undefined}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
              onBlur={() => {
                const baseUrl = normalizeBaseUrl(value.baseUrl);
                if (baseUrl !== value.baseUrl) onChange({ baseUrl });
              }}
            />
            {urlInvalid ? (
              <StatusLine ok={false}>Enter an http(s) URL, such as https://api.example.com/v1.</StatusLine>
            ) : null}
          </>
        )}
      </Field>
      <SecretField
        label="API key"
        value={value.apiKey}
        onChange={(apiKey) => onChange({ apiKey })}
        help={llmProviderCatalog["openai-compatible"].keyHelp.text}
        placeholder="Optional"
      />
    </>
  );
}
