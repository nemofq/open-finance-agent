"use client";

import { useId, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteJson } from "@/components/shared/http-client";
import { useDialogSubject } from "@/components/shared/use-dialog-subject";
import { useLlmModels } from "@/components/shared/use-llm-models";
import { EmptyState, SectionHeader, SettingsHeader } from "@/components/shared/page-shell";
import { StatusLine } from "@/components/shared/field-row";
import { llmDefaultsUnit, llmNoticesUnit, llmProviderUnit } from "@/components/settings/settings-units";
import { useSettings } from "@/components/settings/use-settings";
import { useUnsavedChangesWarning } from "@/components/shared/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LlmProviderConfig } from "@/lib/config/schema";
import { errorMessage } from "@/lib/utils";
import { AddProviderDialog } from "./add-provider-dialog";
import { ConnectDialog } from "./connect-dialog";
import { connectionStatus, signsIn } from "./connection";
import { DefaultsSection } from "./defaults-section";
import {
  currentValidations,
  draftProviderModels,
  type ProviderCheck,
  requestProvider,
  savedProviderModels,
} from "./drafts";
import { ModelNotices } from "./model-notices";
import { ProviderCard } from "./provider-card";
import { useAuthStatus } from "./use-auth-status";

/** Settings › LLM: the providers the agent can use and the default model for new chats. */
export function LlmSettings() {
  const { config, saved, loadError, dirty, update, isDirty, isSaving, saveUnit, removeUnit } = useSettings();
  const savedModels = useLlmModels();
  const authStatus = useAuthStatus();
  const providersHeadingId = useId();
  /** Validate results by provider id, each with the draft it ran on so an edited key or URL retires it. */
  const [checks, setChecks] = useState<Record<string, ProviderCheck>>({});
  const adding = useDialogSubject();
  const [pendingDelete, setPendingDelete] = useState<LlmProviderConfig | null>(null);
  const [connecting, setConnecting] = useState<LlmProviderConfig | null>(null);

  useUnsavedChangesWarning(dirty);

  /** A saved LLM change alters what `/api/settings/llm/models` reports, so reload it; passes `ok` through. */
  const synced = (ok: boolean) => {
    if (ok) void savedModels.reload();
    return ok;
  };

  /** A saved sign-in provider is useless until it has a token, so adding one leads straight into the dialog. */
  const addProvider = async (provider: LlmProviderConfig, onError: (message: string) => void) => {
    const added = synced(
      await saveUnit(llmProviderUnit(provider.id), { value: provider, success: `${provider.name} added`, onError }),
    );
    if (added && signsIn(provider)) setConnecting(provider);
    return added;
  };

  /** Sign out of a provider without removing it; its models stay configured for the next sign-in. */
  const disconnect = async ({ id, name }: LlmProviderConfig) => {
    try {
      await deleteJson(`/api/settings/llm/auth?provider=${encodeURIComponent(id)}`);
      toast.success(`${name} disconnected`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await authStatus.reload();
    void savedModels.reload();
  };

  const saveProvider = async (draft: LlmProviderConfig) => {
    const provider = requestProvider(draft);
    synced(await saveUnit(llmProviderUnit(provider.id), { value: provider, success: `${provider.name} saved` }));
  };

  const deleteProvider = async ({ id, name }: LlmProviderConfig) => {
    if (!synced(await removeUnit(llmProviderUnit(id), { success: `${name} deleted` }))) return;
    setPendingDelete(null);
    // Deleting the provider signs it out on the server too, so its row has to be re-read.
    void authStatus.reload();
    setChecks((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  };

  const saveDefaults = async () => {
    synced(await saveUnit(llmDefaultsUnit, { success: "Defaults saved" }));
  };

  const providers = config?.llm.providers ?? [];
  const validations = currentValidations(providers, checks);
  const providerModels = draftProviderModels(providers, savedModels.data, validations, savedModels, saved?.llm.providers);
  const clearsDefault =
    pendingDelete !== null &&
    [config?.llm.defaultModel, saved?.llm.defaultModel].some((ref) => ref?.provider === pendingDelete.id);

  return (
    <div className="space-y-8">
      <SettingsHeader
        title="LLM"
        description="Providers the agent can use and the default model for new chats. Keys and sign-ins are stored on this machine and only sent to their provider."
      />

      {loadError ? <StatusLine ok={false}>{loadError}</StatusLine> : null}

      {!config || !saved ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <>
          <ModelNotices
            notices={saved.llm.modelNotices ?? []}
            dismissing={isSaving(llmNoticesUnit)}
            onDismiss={() => void removeUnit(llmNoticesUnit, { success: "Notice dismissed" })}
          />

          <DefaultsSection
            defaults={config.llm}
            providers={saved.llm.providers}
            providerModels={savedProviderModels(saved.llm.providers, savedModels.data, savedModels)}
            loading={savedModels.loading}
            unsavedProviders={providers.some((provider) => isDirty(llmProviderUnit(provider.id)))}
            onChange={(fields) => update((current) => ({ ...current, llm: { ...current.llm, ...fields } }))}
            dirty={isDirty(llmDefaultsUnit)}
            saving={isSaving(llmDefaultsUnit)}
            onSave={() => void saveDefaults()}
          />

          <section aria-labelledby={providersHeadingId} className="space-y-3">
            <SectionHeader
              id={providersHeadingId}
              title="Providers"
              description="Where models come from. Add as many as you need."
              action={
                <Button variant="outline" onClick={() => adding.show()}>
                  <PlusIcon />
                  Add provider
                </Button>
              }
            />

            {providers.length === 0 ? (
              <EmptyState>
                <p>No LLM providers yet.</p>
                <p className="mt-1">
                  Sign in with a subscription you already have, add an API key, or point at your own
                  OpenAI-compatible endpoint.
                </p>
              </EmptyState>
            ) : (
              <div className="space-y-4">
                {providers.map((provider, index) => {
                  const unit = llmProviderUnit(provider.id);
                  return (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      models={providerModels[index]}
                      defaultModel={config.llm.defaultModel}
                      thinkingLevel={config.llm.thinkingLevel}
                      validation={validations[provider.id]}
                      connection={connectionStatus(provider, authStatus)}
                      onChange={(next) => update((current) => unit.write(current, next))}
                      onConnect={() => setConnecting(provider)}
                      onDisconnect={() => void disconnect(provider)}
                      onValidated={(validated, validation) =>
                        setChecks((current) => ({ ...current, [validated.id]: { provider: validated, validation } }))
                      }
                      dirty={isDirty(unit)}
                      saving={isSaving(unit)}
                      onSave={() => void saveProvider(provider)}
                      onDelete={() => setPendingDelete(provider)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <AddProviderDialog
        key={adding.key}
        open={adding.open}
        providers={providers}
        onOpenChange={adding.onOpenChange}
        onAdd={addProvider}
      />

      <ConnectDialog
        provider={connecting}
        onClose={() => setConnecting(null)}
        onConnected={() => {
          void authStatus.reload();
          void savedModels.reload();
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.name ?? "provider"}”?`}
        description={`Chats that run on its models cannot continue.${
          clearsDefault ? " The default model comes from this provider and will be cleared." : ""
        }`}
        confirmLabel="Delete"
        pending={pendingDelete !== null && isSaving(llmProviderUnit(pendingDelete.id))}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteProvider(pendingDelete)}
      />
    </div>
  );
}
