"use client";

import { FileTextIcon, LockIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { type ArtifactWorkspaceHandle, ArtifactWorkspace } from "@/components/reports/artifact-workspace";
import { ScheduleDialog } from "@/components/scheduled/schedule-dialog";
import { ComposerInsertProvider } from "@/components/shared/composer-context";
import { describeModel, ModelPicker } from "@/components/shared/model-picker";
import { Notice } from "@/components/shared/page-shell";
import { useLlmModels } from "@/components/shared/use-llm-models";
import { Button } from "@/components/ui/button";
import type { ModelRef } from "@/lib/config/schema";
import type { SessionFile } from "@/lib/sessions/types";
import type { ModuleLabel } from "@/lib/tools/config";
import { cn } from "cn";
import { documentBudget, imageSupportReason } from "./composer/attachments";
import { ChatComposer } from "./composer/chat-composer";
import { useComposer } from "./composer/use-composer";
import { ChatHeader } from "./chat-header";
import { ChatWelcome } from "./chat-welcome";
import { ContextMeter } from "./context-meter";
import { MessageList } from "./message-list";
import { DataProviderHint, SetupBanner, setupNeed } from "./setup-banner";
import { reportsOf } from "./transcript";
import { useChatSession } from "./use-chat-session";
import { WorkingIndicator } from "./working-indicator";

/** A started chat's model: read-only, since a chat never switches models. */
function FixedModel({ label, available }: { label: string; available: boolean }) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1", !available && "text-destructive")}
      title={
        available
          ? "The model is fixed once a chat starts"
          : `${label} is no longer available. The model is fixed once a chat starts.`
      }
    >
      <LockIcon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * One chat: the transcript and composer on the left, the reports it produced on the right. The
 * conversation with the server is `useChatSession`'s, what the composer holds is `useComposer`'s,
 * and the artifact column is the reports workspace's; this component picks the model and lays
 * the pieces out.
 */
export function Chat({
  session,
  running = false,
  missingData,
}: {
  session: SessionFile | null;
  running?: boolean;
  /** The suggested data connections not ready yet; `undefined` when the server could not tell. */
  missingData: ModuleLabel[] | undefined;
}) {
  /** A new chat's model override, picked before the first message. */
  const [picked, setPicked] = useState<ModelRef | null>(null);
  const models = useLlmModels();
  const providers = models.data?.providers ?? [];
  const defaultModel = models.data?.defaultModel ?? null;
  const defaultAvailable = describeModel(providers, defaultModel)?.available === true;
  /** What a new chat's first send creates the session with; `null` blocks sending. */
  const newChatModel = picked ?? (defaultAvailable ? defaultModel : null);

  const workspace = useRef<ArtifactWorkspaceHandle>(null);
  const openReport = useCallback((id: string) => workspace.current?.open(id), []);
  const chat = useChatSession({ session, running, newChatModel, onReport: openReport });
  const reports = useMemo(() => reportsOf(chat.items), [chat.items]);

  const started = chat.sessionId !== null;
  // The model this turn will run on, which is what decides whether images may be attached at all,
  // and which sign-in has to be in place before it can run. A started chat keeps its own.
  const turnModel = started ? chat.sessionModel : newChatModel;
  const need = setupNeed({
    providers,
    loaded: models.data !== null,
    turnModel,
    started,
    picked: picked !== null,
    defaultAvailable,
    refused: chat.refused,
  });
  const showSetup = need !== null;
  // A tip for starting out, so a chat already under way is left alone.
  const dataTip = !started && missingData !== undefined && missingData.length > 0 ? missingData : null;
  const fixedModel = started && models.data ? describeModel(providers, chat.sessionModel) : null;
  // Cheap enough to redo each render: a find over a handful of providers, and memoising it would
  // only pin down `providers`, which is a fresh array every time the models load.
  const attachDisabledReason = imageSupportReason(providers, turnModel);
  // How much of this model's window one message may spend on inlined documents; a file past it is
  // read in parts instead, which the chip says before the turn is sent.
  const budget = documentBudget(providers, turnModel);

  const composer = useComposer({ send: chat.send, compact: chat.compact, attachDisabledReason });
  const { error } = chat;

  return (
    <ComposerInsertProvider value={composer.insert}>
      <ArtifactWorkspace ref={workspace} sessionId={chat.sessionId} reports={reports}>
        {({ panelOpen, reopen }) => (
          <>
            <ChatHeader title={chat.header.title} tickers={chat.header.tickers}>
              {chat.sessionId !== null && <ScheduleDialog sessionId={chat.sessionId} />}
              {reports.length > 0 && !panelOpen && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={reopen}>
                  <FileTextIcon />
                  <span className="tabular-nums">Reports · {reports.length}</span>
                </Button>
              )}
            </ChatHeader>

            {chat.items.length === 0 && !showSetup ? (
              <ChatWelcome onPick={composer.pick} />
            ) : (
              <MessageList items={chat.items} footer={chat.work && <WorkingIndicator phase={chat.work} />} />
            )}

            {(showSetup || dataTip || error) && (
              <div className="flex flex-col gap-2 px-4 pb-2">
                {need && <SetupBanner need={need} canPickBelow={!started} />}
                {dataTip && <DataProviderHint missing={dataTip} />}
                {error && (
                  <Notice tone="error" className="mx-auto flex w-full max-w-3xl items-center gap-3">
                    <span className="min-w-0 flex-1 break-words">{error}</span>
                    {chat.retryable && (
                      <Button variant="outline" size="sm" onClick={chat.retry}>
                        Retry
                      </Button>
                    )}
                  </Notice>
                )}
              </div>
            )}

            <ChatComposer
              composer={composer}
              onStop={chat.stop}
              streaming={chat.streaming}
              sendDisabled={chat.compacting || need === "reauth" || (!started && newChatModel === null)}
              budget={budget}
              modelSlot={
                started ? (
                  fixedModel && <FixedModel {...fixedModel} />
                ) : (
                  <ModelPicker
                    variant="compact"
                    providers={providers}
                    value={picked ?? defaultModel}
                    onChange={setPicked}
                    defaultModel={defaultModel}
                    disabled={!models.data || chat.streaming}
                    placeholder={
                      models.error ? "Models failed to load" : models.loading ? "Loading models…" : "Choose a model"
                    }
                    aria-label="Model for this chat"
                  />
                )
              }
              contextSlot={chat.context && <ContextMeter usage={chat.context} />}
            />
          </>
        )}
      </ArtifactWorkspace>
    </ComposerInsertProvider>
  );
}
