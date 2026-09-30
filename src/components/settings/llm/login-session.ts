/**
 * Pure reduction of a provider login stream into what the connect dialog draws: the newest of each
 * kind of event, the step waiting for an answer, and how the login ended. pi emits its events in
 * any order and repeats them, so each kind keeps only its latest value.
 */
import type { AuthEvent } from "@earendil-works/pi-ai";
import type { OAuthPrompt, OAuthStreamMessage } from "@/lib/llm/oauth/types";

export interface LoginAuthUrl {
  url: string;
  instructions?: string;
}

export interface LoginDeviceCode {
  userCode: string;
  verificationUri: string;
  /** Epoch ms the code stops working, when the provider said how long it lasts. */
  expiresAt?: number;
}

export interface LoginNotice {
  message: string;
  links: readonly { url: string; label?: string }[];
}

export interface LoginState {
  /** `starting` until the first message arrives; `done` and `error` are terminal. */
  phase: "starting" | "running" | "done" | "error";
  /** The sign-in page to open, which stays on screen next to the paste field. */
  authUrl: LoginAuthUrl | null;
  deviceCode: LoginDeviceCode | null;
  /** The latest `info` or `progress` line. */
  notice: LoginNotice | null;
  /** What the flow is waiting for, or null while it is working. */
  prompt: OAuthPrompt | null;
  error: string | null;
}

export const startingLogin: LoginState = {
  phase: "starting",
  authUrl: null,
  deviceCode: null,
  notice: null,
  prompt: null,
  error: null,
};

/** What one event replaces; every other part of the state is left as it was. */
function applyEvent(event: AuthEvent, now: number): Partial<LoginState> {
  switch (event.type) {
    case "auth_url":
      return { authUrl: { url: event.url, ...(event.instructions ? { instructions: event.instructions } : {}) } };
    case "device_code":
      return {
        deviceCode: {
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          ...(event.expiresInSeconds ? { expiresAt: now + event.expiresInSeconds * 1000 } : {}),
        },
      };
    case "info":
      return { notice: { message: event.message, links: event.links ?? [] } };
    case "progress":
      return { notice: { message: event.message, links: [] } };
  }
}

/** Fold one server message into the dialog's state; `now` dates a device code's countdown. */
export function reduceLogin(state: LoginState, message: OAuthStreamMessage, now: number = Date.now()): LoginState {
  switch (message.type) {
    // Anything the flow says next supersedes a refused answer, so the warning goes with it.
    case "event":
      return { ...state, phase: "running", error: null, ...applyEvent(message.event, now) };
    case "prompt":
      return { ...state, phase: "running", error: null, prompt: message.prompt };
    case "done":
      return { ...state, phase: "done", prompt: null, error: null };
    case "error":
      return { ...state, phase: "error", prompt: null, error: message.message };
  }
}

/** The login could not be reached at all, or its stream broke: the same end as a reported failure. */
export function failedLogin(state: LoginState, error: string): LoginState {
  return { ...state, phase: "error", prompt: null, error };
}

/**
 * The pending prompt has been answered; the flow moves on and the next message says what it is
 * waiting for. Codex's browser flow then races a callback, so nothing else may be assumed here.
 */
export function answeredLogin(state: LoginState): LoginState {
  return { ...state, prompt: null };
}

/**
 * The flow would not take an answer, usually because the prompt it belonged to has closed — pi
 * races `manual_code` against its callback server, and the callback may have won. The login itself
 * carries on, so this is a warning rather than an end.
 */
export function rejectedAnswer(state: LoginState, error: string): LoginState {
  return state.phase === "running" || state.phase === "starting" ? { ...state, error } : state;
}

/**
 * Which option a `select` starts on. Codex offers browser or device code; device code is the one
 * that works in a devcontainer, where the fixed callback port is unreachable.
 */
export function preferredOption(options: readonly { id: string; label: string }[]): string {
  const device = options.find((option) => /device/i.test(option.id) || /device/i.test(option.label));
  return (device ?? options[0])?.id ?? "";
}

/**
 * Whether the paste field is shown. The callback server behind an `auth_url` is unreachable from a
 * devcontainer or a remote host, so the field is offered from the moment the sign-in page appears,
 * not only once pi races in its `manual_code` prompt.
 */
export function showsPasteField(state: LoginState): boolean {
  return state.phase === "running" && (state.authUrl !== null || state.prompt?.type === "manual_code");
}

/**
 * Whether a step takes an empty answer. pi asks GitHub Copilot for an Enterprise URL that a
 * github.com account is meant to leave blank, so a `text` step must be submittable empty; a secret
 * or a pasted code is only an answer when it has content.
 */
export function allowsBlank(type: OAuthPrompt["type"]): boolean {
  return type === "text";
}

/** A device code's remaining life as `m:ss`, for the countdown under the code. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
