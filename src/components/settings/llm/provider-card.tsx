"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { formatClock } from "@/components/shared/format";
import { postJson } from "@/components/shared/http-client";
import { SaveButton } from "@/components/shared/page-shell";
import { PendingButton } from "@/components/shared/pending-button";
import { FieldHelp, StatusLine } from "@/components/shared/field-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { LlmProviderConfig, ModelRef, ThinkingLevel } from "@/lib/config/schema";
import { llmProviderCatalog } from "@/lib/llm/catalog";
import type { ProviderModels, ProviderValidation } from "@/lib/llm/types";
import { errorMessage } from "@/lib/utils";
import { catalogEntryFor, connectAction, type ConnectionStatus, needsConnecting, signsIn } from "./connection";
import { CustomModelsEditor } from "./custom-models-editor";
import { requestProvider } from "./drafts";
import { EndpointFields } from "./endpoint-fields";
import { KeyProviderFields } from "./key-fields";
import { ProviderTest } from "./provider-test";

/** Validate a draft provider; a stored key is sent masked and restored by the server. */
async function validateProvider(provider: LlmProviderConfig): Promise<ProviderValidation> {
  try {
    return await postJson<ProviderValidation>("/api/settings/llm/validate", { provider: requestProvider(provider) });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function ValidationStatus({ validation }: { validation: ProviderValidation | undefined }) {
  if (!validation) return null;
  return (
    <StatusLine ok={validation.ok}>
      {validation.ok ? (validation.message ?? "Valid") : (validation.error ?? "Validation failed")}
    </StatusLine>
  );
}

/** What the card says about a sign-in provider's credential, and the buttons that change it. */
function ConnectionFields({
  status,
  onConnect,
  onDisconnect,
}: {
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = status.kind === "connected";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={connected ? "secondary" : "outline"}>
          {status.kind === "loading" ? "Checking…" : connected ? "Connected" : "Not connected"}
        </Badge>
        <Button type="button" variant="outline" onClick={onConnect} disabled={status.kind === "loading"}>
          {connectAction(status)}
        </Button>
        {connected ? (
          <Button type="button" variant="ghost" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : null}
      </div>
      {status.kind === "failed" ? <StatusLine ok={false}>{status.error}</StatusLine> : null}
      {needsConnecting(status) ? (
        <StatusLine ok={false}>Sign in to let the agent use this provider.</StatusLine>
      ) : null}
      {connected ? (
        <FieldHelp
          help={`Signed in on this machine; the token is stored outside the config and never shown here.${
            status.renewsAt ? ` It renews by itself, next after ${formatClock(status.renewsAt)}.` : ""
          }`}
        />
      ) : null}
    </div>
  );
}

/**
 * The type-specific fields: URL, key and model list for an endpoint; the sign-in for a provider that
 * signs in; the key, and whatever else its row asks for, for any other hosted provider.
 */
function ProviderFields({
  provider,
  validation,
  connection,
  onChange,
  onConnect,
  onDisconnect,
}: {
  provider: LlmProviderConfig;
  validation: ProviderValidation | undefined;
  connection: ConnectionStatus;
  onChange: (provider: LlmProviderConfig) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (signsIn(provider)) {
    return <ConnectionFields status={connection} onConnect={onConnect} onDisconnect={onDisconnect} />;
  }
  if (provider.type === "openai-compatible") {
    return (
      <>
        <EndpointFields value={provider} onChange={(fields) => onChange({ ...provider, ...fields })} />
        <CustomModelsEditor
          models={provider.models}
          onChange={(models) => onChange({ ...provider, models })}
          listed={validation?.ok ? validation.models : undefined}
        />
      </>
    );
  }
  return <KeyProviderFields provider={provider} onChange={onChange} />;
}

export interface ProviderCardProps {
  provider: LlmProviderConfig;
  /** This provider's models in the draft, from `draftProviderModels`. */
  models: ProviderModels;
  defaultModel: ModelRef | null;
  /** The draft thinking level, which Test sends like a chat turn would. */
  thinkingLevel: ThinkingLevel;
  /**
   * The last Validate result that still matches this draft's key and URL, kept by the page because
   * OpenRouter's feeds the default-model picker.
   */
  validation: ProviderValidation | undefined;
  /** Where this provider's sign-in stands; `none` for a provider that carries a key. */
  connection: ConnectionStatus;
  onChange: (provider: LlmProviderConfig) => void;
  /** A Validate result, with the draft it was run on. */
  onValidated: (validated: LlmProviderConfig, validation: ProviderValidation) => void;
  /** Open the connect dialog, to sign in for the first time or to sign in again. */
  onConnect: () => void;
  /** Sign out, leaving the provider configured. */
  onDisconnect: () => void;
  /** This provider differs from its saved copy. */
  dirty: boolean;
  saving: boolean;
  /** Save this provider only. */
  onSave: () => void;
  onDelete: () => void;
}

/** One configured provider: its fields, Validate, a model Test, Delete, and its own Save. */
export function ProviderCard({
  provider,
  models,
  defaultModel,
  thinkingLevel,
  validation,
  connection,
  onChange,
  onValidated,
  onConnect,
  onDisconnect,
  dirty,
  saving,
  onSave,
  onDelete,
}: ProviderCardProps) {
  const [validating, setValidating] = useState(false);
  // The row this provider was added by, which for Anthropic says whether it is the key or the subscription.
  const type = catalogEntryFor(provider) ?? llmProviderCatalog[provider.type];

  const validate = async () => {
    setValidating(true);
    onValidated(provider, await validateProvider(provider));
    setValidating(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {models.name}
          {models.name !== type.name ? <Badge variant="outline">{type.name}</Badge> : null}
        </CardTitle>
        {provider.type === "openai-compatible" ? (
          <CardDescription className="truncate font-mono text-xs">{provider.baseUrl || "No base URL set"}</CardDescription>
        ) : (
          <CardDescription>{type.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <ProviderFields
          provider={provider}
          validation={validation}
          connection={connection}
          onChange={onChange}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
        <ProviderTest provider={provider} models={models} defaultModel={defaultModel} thinkingLevel={thinkingLevel} />
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <PendingButton type="button" variant="outline" onClick={() => void validate()} pending={validating}>
            Validate
          </PendingButton>
          <ValidationStatus validation={validation} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2Icon />
            Delete
          </Button>
          <SaveButton dirty={dirty} saving={saving} onClick={onSave} />
        </div>
      </CardFooter>
    </Card>
  );
}
