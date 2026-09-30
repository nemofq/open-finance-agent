"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteJson, postJson } from "@/components/shared/http-client";
import type { OAuthAnswerRequest, OAuthStartResponse, OAuthStreamMessage } from "@/lib/llm/oauth/types";
import { errorMessage } from "@/lib/utils";
import {
  answeredLogin,
  failedLogin,
  type LoginState,
  reduceLogin,
  rejectedAnswer,
  startingLogin,
} from "./login-session";

export interface LoginSession {
  state: LoginState;
  /** Answer the pending prompt; a rejected answer ends the login with its message. */
  answer: (value: string) => void;
  /** Run the whole flow again after a failure. */
  retry: () => void;
}

/** A start in flight, and how many mounts are waiting on the login it creates. */
interface PendingStart {
  promise: Promise<OAuthStartResponse>;
  claims: number;
  /** Set by the release that abandoned the login, so two releases cannot abort the same one twice. */
  aborted: boolean;
}

/**
 * Starts in flight, by provider and attempt. React mounts an effect twice in development, and the
 * server allows one login per provider, so the second mount has to join the first mount's start
 * rather than send its own and collect the refusal.
 */
const starts = new Map<string, PendingStart>();

function abortLogin(id: string): void {
  void deleteJson(`/api/settings/llm/oauth/${id}`).catch(() => {
    // The dialog is already gone; a session that has expired needs no report.
  });
}

/** Join the start for this key, or send one. */
function claimStart(key: string, provider: string): PendingStart {
  const joined = starts.get(key);
  if (joined) {
    joined.claims += 1;
    return joined;
  }
  const entry: PendingStart = {
    claims: 1,
    aborted: false,
    promise: postJson<OAuthStartResponse>("/api/settings/llm/oauth", { provider }),
  };
  starts.set(key, entry);
  // Forgotten once it settles, so reopening the dialog starts afresh rather than joining a login
  // that has already ended. A remount runs in the same task as the mount, well inside the round trip.
  const forget = () => {
    if (starts.get(key) === entry) starts.delete(key);
  };
  void entry.promise.then(forget, forget);
  return entry;
}

/**
 * Let go of a start. The last holder aborts the login, but only once the id exists: a remount in
 * between claims the same start, and the login it is streaming must live on. Two releases can both
 * find no holder — a dialog closed inside the round trip, after a remount — so the abort is latched.
 */
function releaseStart(entry: PendingStart, settled: boolean): void {
  entry.claims -= 1;
  if (settled) return;
  void entry.promise.then(
    ({ id }) => {
      if (entry.claims > 0 || entry.aborted) return;
      entry.aborted = true;
      abortLogin(id);
    },
    () => {
      // A start that never produced a session has nothing to abort.
    },
  );
}

/**
 * Drives one login: starts it, streams its events, answers its prompts and aborts it on unmount.
 * One login per mount, so the dialog remounts this per provider rather than switching `provider`.
 */
export function useLoginSession(provider: string, onConnected: () => void): LoginSession {
  const [state, setState] = useState<LoginState>(startingLogin);
  /** Bumped by `retry`, which is all it is for: a new value restarts the effect below. */
  const [attempt, setAttempt] = useState(0);
  /** The running login, so `answer` and the teardown can reach it. */
  const sessionId = useRef<string | null>(null);
  /** The open prompt, quoted back so an answer cannot land on the step after it. */
  const promptId = useRef<string | undefined>(undefined);
  /** Set once the login has ended, so neither the teardown nor a stream error speaks for it again. */
  const settled = useRef(false);
  // Held in a ref because a new callback identity must not restart a login in flight.
  const connected = useRef(onConnected);
  useEffect(() => {
    connected.current = onConnected;
  });

  useEffect(() => {
    sessionId.current = null;
    promptId.current = undefined;
    settled.current = false;
    let source: EventSource | null = null;
    let abandoned = false;
    const start = claimStart(`${provider}:${attempt}`, provider);

    void start.promise.then(
      ({ id }) => {
        // Whether this login is still wanted is the release's to decide, not this run's.
        if (abandoned) return;
        sessionId.current = id;
        source = new EventSource(`/api/settings/llm/oauth/${id}/events`);
        source.onmessage = (event: MessageEvent<string>) => {
          const message = JSON.parse(event.data) as OAuthStreamMessage;
          if (message.type === "prompt") promptId.current = message.prompt.id;
          setState((current) => reduceLogin(current, message));
          if (message.type !== "done" && message.type !== "error") return;
          settled.current = true;
          source?.close();
          if (message.type === "done") connected.current();
        };
        source.onerror = () => {
          // EventSource reconnects on its own; only a closed stream is the end of this login.
          if (settled.current || source?.readyState !== EventSource.CLOSED) return;
          settled.current = true;
          setState((current) => failedLogin(current, "The sign-in stopped responding. Try again."));
        };
      },
      (err: unknown) => {
        if (!abandoned) setState((current) => failedLogin(current, errorMessage(err)));
      },
    );

    return () => {
      abandoned = true;
      source?.close();
      releaseStart(start, settled.current);
    };
  }, [provider, attempt]);

  const answer = useCallback((value: string) => {
    const id = sessionId.current;
    if (id === null) return;
    const body: OAuthAnswerRequest = { value, ...(promptId.current ? { promptId: promptId.current } : {}) };
    promptId.current = undefined;
    setState(answeredLogin);
    void postJson(`/api/settings/llm/oauth/${id}/answer`, body).catch((err: unknown) => {
      setState((current) => rejectedAnswer(current, errorMessage(err)));
    });
  }, []);

  /** The state is reset here rather than in the effect, which may not render its way into one. */
  const retry = useCallback(() => {
    setState(startingLogin);
    setAttempt((current) => current + 1);
  }, []);

  return { state, answer, retry };
}
