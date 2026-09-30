import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import type { OAuthPrompt, OAuthStreamMessage } from "./types";

/**
 * pi drives a login as one long promise that notifies events and awaits answers through
 * `AuthInteraction`. HTTP cannot hold that promise, so this end of the bridge turns
 * `notify` into messages a route can stream and `prompt` into one answer a route can post back.
 */

/** pi's prompt as the dialog gets it: the same fields, minus the in-process cancellation signal. */
function wirePrompt(id: string, prompt: AuthPrompt): OAuthPrompt {
  const base = { id, message: prompt.message };
  return prompt.type === "select"
    ? { ...base, type: "select", options: prompt.options }
    : { ...base, type: prompt.type, ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}) };
}

interface Pending {
  id: string;
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  /** Drops the abort listeners, so a long login does not accumulate one pair per prompt. */
  release: () => void;
}

export class LoginInteraction implements AuthInteraction {
  private pending?: Pending;
  private prompts = 0;

  constructor(
    readonly signal: AbortSignal,
    private readonly emit: (message: OAuthStreamMessage) => void,
  ) {}

  /**
   * `notify` and `prompt` are fields rather than methods because `Models.login` spreads the
   * interaction (`{ ...interaction, signal }`) before handing it to the provider flow, and a
   * spread copies own properties only.
   */
  readonly notify = (event: AuthEvent): void => {
    this.emit({ type: "event", event });
  };

  /**
   * One prompt is open at a time. pi cancels a prompt through `AuthPrompt.signal` when something
   * else answers the step — the callback server beating the pasted code — and a cancelled prompt
   * rejects here, which is how the flow inside pi learns to move on.
   */
  readonly prompt = (prompt: AuthPrompt): Promise<string> => {
    this.close(new Error("Prompt replaced by another"));
    const id = `p${++this.prompts}`;
    return new Promise<string>((resolve, reject) => {
      const cancel = () => this.close(new Error("Prompt cancelled"));
      prompt.signal?.addEventListener("abort", cancel);
      this.signal.addEventListener("abort", cancel);
      this.pending = {
        id,
        resolve,
        reject,
        release: () => {
          prompt.signal?.removeEventListener("abort", cancel);
          this.signal.removeEventListener("abort", cancel);
        },
      };
      // A signal that fired before we listened will not fire again, so it is checked by hand. The
      // dialog is never shown a prompt nobody is waiting for.
      if (this.signal.aborted) return this.close(new Error("Sign-in cancelled"));
      if (prompt.signal?.aborted) return cancel();
      this.emit({ type: "prompt", prompt: wirePrompt(id, prompt) });
    });
  };

  /** Answer the open prompt. `promptId` refuses an answer to a prompt that has already closed. */
  answer(value: string, promptId?: string): boolean {
    const pending = this.pending;
    if (!pending || (promptId !== undefined && promptId !== pending.id)) return false;
    this.pending = undefined;
    pending.release();
    pending.resolve(value);
    return true;
  }

  private close(reason: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.release();
    pending.reject(reason);
  }
}
