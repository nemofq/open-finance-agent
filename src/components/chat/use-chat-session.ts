"use client";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJson, HttpError, httpErrorFrom, postJson, requestJson } from "@/components/shared/http-client";
import { notifySessionsChanged } from "@/components/shared/session-events";
import type { StoredAttachment } from "@/lib/attachments/types";
import type { ModelRef } from "@/lib/config/schema";
import type { CompactionMessage, ContextUsage } from "@/lib/context/types";
import type { SessionFile } from "@/lib/sessions/types";
import { errorMessage } from "@/lib/utils";
import type { PreparedImages } from "./composer/prepare-image";
import { createLiveTurn, releasePreviews } from "./live-turn";
import { type SetupNeed, setupNeedFor } from "./setup-banner";
import { pumpSse, subscribeToRun } from "./sse-transport";
import { buildTranscript, type ChatItem, type MessagePart, type ToolOutcome } from "./transcript";
import { COMPACTING, WORKING, type WorkPhase } from "./working-indicator";
import { DEFAULT_TITLE } from "@/lib/sessions/title";

export interface Header {
  title: string;
  tickers: string[];
}

/** One message as the composer handed it over, kept so Retry can send exactly it again. */
interface Sent {
  text: string;
  skill?: string;
  attached?: PreparedImages;
  documents?: StoredAttachment[];
}

/** What a refused request asks the user to set up, read from the route's machine `code`. */
function setupNeedOf(err: unknown): SetupNeed | null {
  return err instanceof HttpError ? setupNeedFor(err.code) : null;
}

export interface ChatSession {
  sessionId: string | null;
  /** The model the chat runs on, fixed when the chat is created; `null` only before then. */
  sessionModel: ModelRef | null;
  header: Header;
  items: ChatItem[];
  streaming: boolean;
  /** What the working indicator says, or `null` when nothing is running. */
  work: WorkPhase | null;
  compacting: boolean;
  /** The latest `context` event; the meter follows the run and is never persisted. */
  context: ContextUsage | null;
  error: string | null;
  /** Whether the error on screen belongs to a message that can be sent again. */
  retryable: boolean;
  /** What a refused turn said the chat is missing, until the next send clears it. */
  refused: SetupNeed | null;
  send: (text: string, skill?: string, attached?: PreparedImages, documents?: StoredAttachment[]) => Promise<void>;
  compact: (focus?: string) => Promise<void>;
  stop: () => void;
  retry: () => void;
}

/**
 * One chat's conversation with the server: the saved transcript, the turn streaming into it, and
 * the requests that start, re-attach to, stop, retry and compact turns. The state is this mount's;
 * a different chat is a different mount, so a stream never writes into a chat it did not start.
 */
export function useChatSession({
  session,
  running,
  newChatModel,
  onReport,
}: {
  session: SessionFile | null;
  running: boolean;
  /** What a new chat's first send creates the session with. */
  newChatModel: ModelRef | null;
  /** A report finished during a turn. Read once, when the chat mounts, so it must not change. */
  onReport: (id: string) => void;
}): ChatSession {
  const [messages, setMessages] = useState<AgentMessage[]>(session?.messages ?? []);
  const [header, setHeader] = useState<Header>({
    title: session?.title ?? DEFAULT_TITLE,
    tickers: session?.tickers ?? [],
  });
  const [sessionId, setSessionId] = useState<string | null>(session?.id ?? null);
  const [sessionModel, setSessionModel] = useState<ModelRef | null>(session?.model ?? null);
  const [live, setLive] = useState<MessagePart[]>([]);
  const [toolOutcomes, setToolOutcomes] = useState<Record<string, ToolOutcome>>({});
  // A turn that was already in flight when this page rendered is streaming from the first paint;
  // the re-attach effect below picks up its events.
  const [streaming, setStreaming] = useState(running);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<SetupNeed | null>(null);
  /** What the working indicator says; one value, updated from the turn's events. */
  const [phase, setPhase] = useState<WorkPhase>(WORKING);
  const [context, setContext] = useState<ContextUsage | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const lastSent = useRef<Sent | null>(null);
  /** Mirrors `sessionId` so a send that creates the session can use the id it just got. */
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const abortRef = useRef<AbortController | null>(null);

  /** A failed request: a banner when its code names something to set up, the error line otherwise. */
  const showFailure = useCallback((err: unknown) => {
    const need = setupNeedOf(err);
    if (need) setRefused(need);
    else setError(errorMessage(err));
  }, []);

  const [turn] = useState(() =>
    createLiveTurn({
      setMessages,
      setLive,
      setToolOutcomes,
      setPhase,
      setContext,
      setError,
      setTitle: (title) => {
        // The sidebar re-reads the session for the rest.
        setHeader((current) => ({ ...current, title }));
        notifySessionsChanged();
      },
      openReport: onReport,
    }),
  );

  const items = useMemo(
    () => buildTranscript(messages, live, toolOutcomes, sessionId),
    [messages, live, toolOutcomes, sessionId],
  );

  /** Re-read the session the server has saved: it derives the title and ticker tags from the turn. */
  const refresh = useCallback(async ({ transcript = false }: { transcript?: boolean } = {}) => {
    const id = sessionIdRef.current;
    if (id === null) return;
    try {
      const updated = await getJson<SessionFile>(`/api/sessions/${id}`);
      setHeader({ title: updated.title, tickers: updated.tickers });
      setSessionModel(updated.model);
      if (transcript) setMessages(updated.messages);
    } catch {
      // The header simply keeps its previous value.
    }
  }, []);

  /** Close out a turn, however it ended: the stream's own events are all in by now. */
  const settle = useCallback(
    async ({ transcript = false }: { transcript?: boolean } = {}) => {
      abortRef.current = null;
      turn.finish();
      setStreaming(false);
      setLive([]);
      setPhase(WORKING);
      notifySessionsChanged();
      await refresh({ transcript });
    },
    [refresh, turn],
  );

  const send = useCallback(
    async (text: string, skill?: string, attached?: PreparedImages, documents?: StoredAttachment[]) => {
      lastSent.current = { text, skill, attached, documents };
      turn.begin();
      setRetryable(true);
      setError(null);
      setRefused(null);
      const timestamp = Date.now();
      const blocks = attached?.blocks ?? [];
      // The descriptors are already what the server will save: a staged document is named by the
      // hash of its bytes, and claiming it into the chat keeps that name.
      const carried = documents !== undefined && documents.length > 0 ? { documents } : {};
      // A skill turn shows the chip right away; the server echoes the real turn, with the
      // expanded prompt, at `message_end`. Images make a plain turn an array of blocks, the same
      // shape the server saves, so the bubble does not change form when the echo lands.
      setMessages((prev) => [
        ...prev,
        skill
          ? { role: "skill", skill, request: text, prompt: "", ...(blocks.length > 0 ? { images: blocks } : {}), ...carried, timestamp }
          : blocks.length > 0
            ? { role: "user", content: [...(text ? [{ type: "text" as const, text }] : []), ...blocks], ...carried, timestamp }
            : { role: "user", content: text, ...carried, timestamp },
      ]);
      setStreaming(true);
      setPhase(WORKING);

      const controller = new AbortController();
      abortRef.current = controller;
      /** Whether the server took the message: its messages request returned a stream. */
      let accepted = false;

      try {
        let id = sessionIdRef.current;
        if (id === null) {
          // First send in a blank chat: only now does the session earn a place in history.
          const created = await requestJson<SessionFile>("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: newChatModel }),
            signal: controller.signal,
          });
          id = created.id;
          sessionIdRef.current = id;
          setSessionId(id);
          setSessionModel(created.model);
          notifySessionsChanged();
          // `replaceState` is wired into the App Router, so `usePathname` follows along without
          // remounting the chat; see "Linking and Navigating > Native History API" in the docs.
          window.history.replaceState(null, "", `/chat/${id}`);
        }

        const res = await fetch(`/api/sessions/${id}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The browser's zone, so the turn uses the user's local date rather than the server's.
          body: JSON.stringify({
            text,
            skill,
            images: attached?.input,
            // Only the names: the files are already in staging, and the route claims them by name.
            documents: documents?.map((entry) => entry.attachment),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw await httpErrorFrom(res);
        if (!res.body) throw new HttpError("The reply arrived without its stream", res.status);

        accepted = true;
        // The response arrives once the run is registered, which is what the sidebar dot follows.
        notifySessionsChanged();
        await pumpSse(res.body, turn.apply, controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) showFailure(err);
      } finally {
        await settle();
        // Decided by the response, not the echo: a Stop drops an echo that was still buffered.
        releasePreviews(blocks, accepted);
      }
    },
    [newChatModel, settle, showFailure, turn],
  );

  // Pick up a turn that was already running when this page loaded. Stop reaches it through
  // `abortRef` and the abort endpoint; otherwise the stream closes on the run's own terminal
  // event, so the transcript it reloads is the one the server has finished saving.
  useEffect(() => {
    const id = sessionIdRef.current;
    if (!running || id === null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    // The run's event stream is the external system this effect subscribes to: it only opens and
    // closes the connection, and every state change comes from the events it delivers.
    subscribeToRun(`/api/sessions/${id}/stream`, controller.signal, {
      onEvent: turn.apply,
      onClose: async ({ replayed, error: failure }) => {
        if (failure !== undefined) setError(errorMessage(failure));
        await settle({ transcript: !replayed });
      },
    });
    return () => controller.abort();
  }, [running, settle, turn]);

  /**
   * `/compact [focus]`: the checkpoint replaces the history the model sees, so the transcript is
   * reloaded from the server rather than guessed at — the message lands at the cut point, not at
   * the end.
   */
  const compact = useCallback(async (focus?: string) => {
    const id = sessionIdRef.current;
    if (id === null) {
      setError("There is nothing to compact yet.");
      return;
    }
    setRetryable(false);
    setError(null);
    setCompacting(true);
    try {
      const compaction = await postJson<CompactionMessage>(`/api/sessions/${id}/compact`, { focus });
      // The saved transcript places the checkpoint where the server put it; failing that, append it.
      const saved = await getJson<SessionFile>(`/api/sessions/${id}`).catch(() => null);
      if (saved) setMessages(saved.messages);
      else setMessages((prev) => [...prev, compaction]);
      // The meter would otherwise keep the pre-compaction figure until the next turn reports one.
      setContext((usage) =>
        usage === null ? usage : { ...usage, used: compaction.tokensAfter, compactions: usage.compactions + 1 },
      );
    } catch (err) {
      showFailure(err);
    } finally {
      setCompacting(false);
    }
  }, [showFailure]);

  const stop = useCallback(() => {
    // A send that is still creating its session has nothing to abort on the server yet.
    // Best effort: the local abort below ends the turn on screen whether or not the server hears it.
    if (sessionId !== null) void postJson<unknown>(`/api/sessions/${sessionId}/abort`).catch(() => undefined);
    abortRef.current?.abort();
    void settle({ transcript: true });
  }, [sessionId, settle]);

  /** Send the failed message again, in place of its bubble. */
  const retry = useCallback(() => {
    const previous = lastSent.current;
    if (!previous) return;
    setMessages((prev) => prev.slice(0, -1));
    void send(previous.text, previous.skill, previous.attached, previous.documents);
  }, [send]);

  return {
    sessionId,
    sessionModel,
    header,
    items,
    streaming,
    // `/compact` runs outside a turn, so it speaks for itself; otherwise the live phase does.
    work: compacting ? COMPACTING : streaming ? phase : null,
    compacting,
    context,
    error,
    retryable,
    refused,
    send,
    compact,
    stop,
    retry,
  };
}
