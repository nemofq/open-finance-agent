import type { AuthInteraction, OAuthCredential } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginInProgressError, LoginSessions, loginSessions } from "./sessions";
import type { OAuthStreamMessage } from "./types";

/** The login advances on microtasks only, so draining them is enough to see its next step. */
async function settle(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

const credential: OAuthCredential = {
  type: "oauth",
  access: "sk-ant-oat-top-secret",
  refresh: "refresh-top-secret",
  expires: 1_800_000_000_000,
};

/** Stands in for a pi `OAuthAuth.login`: every event type, then every prompt type, then a token. */
async function fullLogin(interaction: AuthInteraction): Promise<OAuthCredential> {
  interaction.notify({ type: "info", message: "One-time setup", links: [{ url: "https://example.com/help", label: "Help" }] });
  interaction.notify({ type: "auth_url", url: "https://example.com/authorize", instructions: "Open this page" });
  interaction.notify({
    type: "device_code",
    userCode: "ABCD-1234",
    verificationUri: "https://example.com/device",
    intervalSeconds: 5,
    expiresInSeconds: 900,
  });
  interaction.notify({ type: "progress", message: "Waiting for approval" });

  await interaction.prompt({ type: "select", message: "How?", options: [{ id: "device", label: "Device code" }] });
  await interaction.prompt({ type: "text", message: "Enterprise URL", placeholder: "github.com" });
  await interaction.prompt({ type: "secret", message: "Passphrase" });
  await interaction.prompt({ type: "manual_code", message: "Paste the redirect URL" });
  return credential;
}

/** Watch a session the way the SSE route does: the queue so far, then everything after it. */
function watch(sessions: LoginSessions, id: string): OAuthStreamMessage[] {
  const messages: OAuthStreamMessage[] = [];
  const subscription = sessions.subscribe(id, (message) => messages.push(message));
  messages.unshift(...(subscription?.replay ?? []));
  return messages;
}

function promptIds(messages: OAuthStreamMessage[]): string[] {
  return messages.flatMap((message) => (message.type === "prompt" ? [message.prompt.id] : []));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LoginSessions", () => {
  it("streams pi's four event types and four prompt types, and ends with done", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", fullLogin);
    const messages = watch(sessions, id);

    // The events and the first prompt are emitted before the flow's first await returns.
    expect(messages.map((message) => (message.type === "event" ? message.event.type : message.type))).toEqual([
      "info",
      "auth_url",
      "device_code",
      "progress",
      "prompt",
    ]);

    for (const value of ["device", "https://github.example.com", "hunter2", "code-42"]) {
      expect(sessions.answer(id, value, promptIds(messages).at(-1))).toBe("ok");
      await settle();
    }

    expect(messages.flatMap((message) => (message.type === "prompt" ? [message.prompt.type] : []))).toEqual([
      "select",
      "text",
      "secret",
      "manual_code",
    ]);
    expect(messages.at(-1)).toEqual({ type: "done" });
  });

  it("puts the prompt's id on the wire and pi's in-process cancellation signal nowhere", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", fullLogin);
    const [prompt] = watch(sessions, id).filter((message) => message.type === "prompt");

    expect(prompt).toEqual({
      type: "prompt",
      prompt: { id: "p1", type: "select", message: "How?", options: [{ id: "device", label: "Device code" }] },
    });
    sessions.abort(id);
    await settle();
  });

  it("never lets the credential onto the wire", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", fullLogin);
    const messages = watch(sessions, id);
    for (const value of ["device", "url", "secret", "code"]) {
      sessions.answer(id, value);
      await settle();
    }

    expect(messages.at(-1)).toEqual({ type: "done" });
    expect(JSON.stringify(messages)).not.toContain("top-secret");
  });

  it("replays what a stream missed, in order, before its live messages", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", fullLogin);

    const late: OAuthStreamMessage[] = [];
    const subscription = sessions.subscribe(id, (message) => late.push(message));
    expect(subscription?.replay.map((message) => message.type)).toEqual(["event", "event", "event", "event", "prompt"]);

    for (const message of subscription?.replay ?? []) late.push(message);
    sessions.answer(id, "device");
    await settle();
    expect(late.at(-1)).toMatchObject({ type: "prompt", prompt: { type: "text" } });

    subscription?.unsubscribe();
    const seen = late.length;
    sessions.answer(id, "https://github.example.com");
    await settle();
    expect(late).toHaveLength(seen);
  });

  it("allows one login per provider at a time", () => {
    const sessions = new LoginSessions();
    const pending = () => new Promise<never>(() => {});
    const { id } = sessions.start("anthropic", pending);

    expect(() => sessions.start("anthropic", pending)).toThrow(LoginInProgressError);
    expect(() => sessions.start("github-copilot", pending)).not.toThrow();
    // Once the first is out of the way, the provider is free again.
    sessions.abort(id);
    expect(() => sessions.start("anthropic", pending)).not.toThrow();
  });

  it("aborts the flow it is holding, and forgets the session", async () => {
    const sessions = new LoginSessions();
    const aborted = vi.fn();
    let rejected: unknown;
    const { id } = sessions.start("anthropic", async (interaction) => {
      interaction.signal?.addEventListener("abort", aborted);
      await interaction.prompt({ type: "manual_code", message: "Paste the redirect URL" }).catch((err: unknown) => {
        rejected = err;
        throw err;
      });
    });
    const messages = watch(sessions, id);

    expect(sessions.abort(id)).toBe(true);
    await settle();

    expect(aborted).toHaveBeenCalled();
    expect(rejected).toBeInstanceOf(Error);
    expect(messages.at(-1)).toEqual({ type: "error", message: "Sign-in cancelled" });
    expect(sessions.has(id)).toBe(false);
    expect(sessions.subscribe(id, () => {})).toBeUndefined();
    expect(sessions.abort(id)).toBe(false);
  });

  it("gives up on a login nobody finished", async () => {
    vi.useFakeTimers();
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", (interaction) =>
      interaction.prompt({ type: "manual_code", message: "Paste the redirect URL" }),
    );
    const messages = watch(sessions, id);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(messages.at(-1)).toEqual({ type: "error", message: "Sign-in timed out after 10 minutes" });

    // The terminal message stays readable for a while, so a reconnecting stream still learns of it.
    expect(sessions.subscribe(id, () => {})?.replay.at(-1)).toEqual(messages.at(-1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sessions.has(id)).toBe(false);
  });

  it("reports a failed login with the message pi gave", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", () => Promise.reject(new Error("invalid_grant")));
    const messages = watch(sessions, id);
    await settle();

    expect(messages).toEqual([{ type: "error", message: "invalid_grant" }]);
  });

  it("refuses an answer to an unknown session, a closed prompt or a finished login", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", fullLogin);

    expect(sessions.answer("nobody", "x")).toBe("unknown_session");
    expect(sessions.answer(id, "x", "p9")).toBe("no_prompt");
    expect(sessions.answer(id, "device", "p1")).toBe("ok");
    await settle();
    // p1 has been answered; a second answer to it must not land on the prompt that followed.
    expect(sessions.answer(id, "again", "p1")).toBe("no_prompt");

    sessions.abort(id);
    await settle();
    expect(sessions.answer(id, "x")).toBe("unknown_session");
  });

  it("lets pi cancel one prompt and carry on, the way a won callback race does", async () => {
    const sessions = new LoginSessions();
    const race = new AbortController();
    const { id } = sessions.start("anthropic", async (interaction) => {
      const pasted = interaction
        .prompt({ type: "manual_code", message: "Paste the redirect URL", signal: race.signal })
        .catch(() => "callback");
      race.abort();
      return { ...credential, access: await pasted };
    });
    const messages = watch(sessions, id);
    await settle();

    expect(messages.at(-1)).toEqual({ type: "done" });
    expect(sessions.answer(id, "too late")).toBe("no_prompt");
  });

  it("does not show a prompt whose race was already lost", async () => {
    const sessions = new LoginSessions();
    const { id } = sessions.start("anthropic", async (interaction) => {
      const pasted = await interaction
        .prompt({ type: "manual_code", message: "Paste the redirect URL", signal: AbortSignal.abort() })
        .catch(() => "callback");
      return { ...credential, access: pasted };
    });
    const messages = watch(sessions, id);
    await settle();

    expect(messages).toEqual([{ type: "done" }]);
  });
});

describe("loginSessions", () => {
  it("is one manager per process, so a hot reload cannot drop a login", () => {
    expect(loginSessions()).toBe(loginSessions());
  });
});
