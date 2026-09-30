import { randomUUID } from "node:crypto";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { processSingleton } from "@/lib/process-state";
import { errorMessage } from "@/lib/utils";
import { LoginInteraction } from "./interaction";
import type { OAuthStreamMessage } from "./types";

/**
 * The HTTP end of the login bridge: a login is one promise inside pi, but the browser
 * arrives as a start, a stream, an answer and maybe an abort. Each session holds that promise, the
 * messages it has produced so far and the streams watching it.
 */

/** The pi call the session runs, injected so tests need no provider. */
export type LoginRunner = (interaction: AuthInteraction) => Promise<unknown>;

/** Long enough to read a mail, find a phone and paste a code; past it nobody is still at the dialog. */
const SESSION_TIMEOUT_MS = 10 * 60_000;
/** How long a finished session stays readable, so a stream that reconnects still learns how it ended. */
const RETAIN_MS = 60_000;

const TIMEOUT_MESSAGE = "Sign-in timed out after 10 minutes";
const CANCELLED_MESSAGE = "Sign-in cancelled";

export class LoginInProgressError extends Error {
  constructor(readonly provider: string) {
    super("A sign-in for this provider is already in progress");
  }
}

export type AnswerResult = "ok" | "unknown_session" | "no_prompt";

type Listener = (message: OAuthStreamMessage) => void;

/** A pending login must not hold the process open: a 10-minute timer outlives any script. */
function schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

class Session {
  readonly messages: OAuthStreamMessage[] = [];
  readonly listeners = new Set<Listener>();
  readonly controller = new AbortController();
  readonly interaction: LoginInteraction;
  timer: ReturnType<typeof setTimeout>;
  finished = false;

  constructor(
    readonly id: string,
    readonly provider: string,
    expire: () => void,
  ) {
    this.interaction = new LoginInteraction(this.controller.signal, (message) => this.emit(message));
    this.timer = schedule(expire, SESSION_TIMEOUT_MS);
  }

  /** Append-only: the queue is what a stream opened later replays. */
  emit(message: OAuthStreamMessage): void {
    this.messages.push(message);
    for (const listener of [...this.listeners]) listener(message);
  }
}

export class LoginSessions {
  private readonly sessions = new Map<string, Session>();

  /**
   * Start a login and return its id. One per provider: a second would race the first for the same
   * credential slot, and the user has only one browser tab open at the provider anyway.
   */
  start(provider: string, run: LoginRunner): { id: string } {
    if (this.active(provider)) throw new LoginInProgressError(provider);

    const id = randomUUID();
    const session = new Session(id, provider, () => this.stop(id, TIMEOUT_MESSAGE));
    this.sessions.set(id, session);

    // A login that rejects after we have already given up (abort, timeout) is ignored by `finish`.
    void run(session.interaction).then(
      () => this.finish(session, { type: "done" }),
      (err: unknown) => this.finish(session, { type: "error", message: message(err) }),
    );
    return { id };
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /** Resolve the prompt the dialog is showing. */
  answer(id: string, value: string, promptId?: string): AnswerResult {
    const session = this.sessions.get(id);
    if (!session) return "unknown_session";
    return session.interaction.answer(value, promptId) ? "ok" : "no_prompt";
  }

  /** The user closed the dialog: abort the flow, tell the streams, and drop the session. */
  abort(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.stop(id, CANCELLED_MESSAGE);
    // Nothing is left to replay, so the session goes now rather than after the retention window.
    clearTimeout(session.timer);
    this.sessions.delete(id);
    return true;
  }

  /** Abort whatever login a provider has in flight, e.g. because it is being signed out. */
  abortProvider(provider: string): void {
    const session = this.active(provider);
    if (session) this.abort(session.id);
  }

  /**
   * Watch a session. Registering the listener and copying the queue happen in the same tick, so a
   * message can neither be missed between the two nor arrive twice.
   */
  subscribe(id: string, listener: Listener): { replay: OAuthStreamMessage[]; unsubscribe: () => void } | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    session.listeners.add(listener);
    return { replay: [...session.messages], unsubscribe: () => session.listeners.delete(listener) };
  }

  private active(provider: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.provider === provider && !session.finished) return session;
    }
    return undefined;
  }

  private stop(id: string, reason: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Aborting rejects the pending prompt, which is how the flow inside pi learns it is over.
    session.controller.abort();
    this.finish(session, { type: "error", message: reason });
  }

  private finish(session: Session, terminal: OAuthStreamMessage): void {
    if (session.finished) return;
    session.finished = true;
    clearTimeout(session.timer);
    session.emit(terminal);
    session.listeners.clear();
    session.timer = schedule(() => this.sessions.delete(session.id), RETAIN_MS);
  }
}

function message(err: unknown): string {
  const text = errorMessage(err);
  return text.trim() || "Sign-in failed";
}

/**
 * One manager per process, so a dev hot reload cannot drop a login somebody is halfway through.
 */
export function loginSessions(): LoginSessions {
  return processSingleton("llm.login-sessions", () => new LoginSessions());
}
