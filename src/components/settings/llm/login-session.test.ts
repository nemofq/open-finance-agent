import { describe, expect, it } from "vitest";
import type { OAuthPrompt, OAuthStreamMessage } from "@/lib/llm/oauth/types";
import {
  allowsBlank,
  formatCountdown,
  type LoginState,
  preferredOption,
  reduceLogin,
  rejectedAnswer,
  showsPasteField,
  startingLogin,
} from "./login-session";

const NOW = 1_700_000_000_000;

/** Fold a whole stream, the way the dialog receives it. */
function replay(messages: OAuthStreamMessage[], from: LoginState = startingLogin): LoginState {
  return messages.reduce((state, message) => reduceLogin(state, message, NOW), from);
}

function prompt(prompt: OAuthPrompt): OAuthStreamMessage {
  return { type: "prompt", prompt };
}

describe("reduceLogin", () => {
  it("keeps the sign-in page while later events arrive", () => {
    const state = replay([
      { type: "event", event: { type: "auth_url", url: "https://claude.ai/oauth", instructions: "Approve access" } },
      { type: "event", event: { type: "progress", message: "Waiting for the callback…" } },
    ]);
    expect(state).toMatchObject({
      phase: "running",
      authUrl: { url: "https://claude.ai/oauth", instructions: "Approve access" },
      notice: { message: "Waiting for the callback…", links: [] },
    });
  });

  it("replaces an event with the newest of its kind", () => {
    const state = replay([
      { type: "event", event: { type: "progress", message: "Starting…" } },
      { type: "event", event: { type: "info", message: "Check your browser", links: [{ url: "https://example.test" }] } },
    ]);
    expect(state.notice).toEqual({ message: "Check your browser", links: [{ url: "https://example.test" }] });
  });

  it("dates a device code's countdown from the moment it arrives", () => {
    const state = replay([
      {
        type: "event",
        event: { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresInSeconds: 900 },
      },
    ]);
    expect(state.deviceCode).toEqual({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: NOW + 900_000,
    });
  });

  it("leaves out the countdown when the provider did not say how long the code lasts", () => {
    const state = replay([
      { type: "event", event: { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" } },
    ]);
    expect(state.deviceCode).not.toHaveProperty("expiresAt");
  });

  it("holds the pending prompt, then drops it when the login ends", () => {
    const asked = replay([prompt({ id: "p1", type: "text", message: "GitHub Enterprise URL" })]);
    expect(asked.prompt).toMatchObject({ id: "p1", type: "text" });
    expect(replay([{ type: "done" }], asked)).toMatchObject({ phase: "done", prompt: null, error: null });
  });

  it("ends on an error with its message, keeping what is already on screen", () => {
    const state = replay([
      { type: "event", event: { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" } },
      prompt({ id: "p1", type: "text", message: "GitHub Enterprise URL" }),
      { type: "error", message: "The code expired" },
    ]);
    expect(state).toMatchObject({ phase: "error", error: "The code expired", prompt: null });
    expect(state.deviceCode?.userCode).toBe("ABCD-1234");
  });
});

describe("rejectedAnswer", () => {
  it("warns without ending a login that is still running", () => {
    const running = replay([prompt({ id: "p1", type: "manual_code", message: "Paste the code" })]);
    const warned = rejectedAnswer(running, "This sign-in is not waiting for an answer");
    expect(warned).toMatchObject({ phase: "running", error: "This sign-in is not waiting for an answer" });
  });

  it("is cleared by whatever the flow says next", () => {
    const warned = rejectedAnswer(replay([prompt({ id: "p1", type: "manual_code", message: "Paste the code" })]), "Too late");
    expect(replay([{ type: "event", event: { type: "progress", message: "Signing in…" } }], warned).error).toBeNull();
  });

  it("leaves a finished login alone", () => {
    const done = replay([{ type: "done" }]);
    expect(rejectedAnswer(done, "Too late")).toBe(done);
  });
});

describe("preferredOption", () => {
  it("preselects the device-code option, which is the one a devcontainer can finish", () => {
    expect(
      preferredOption([
        { id: "browser", label: "Sign in with your browser" },
        { id: "device", label: "Use a device code" },
      ]),
    ).toBe("device");
  });

  it("falls back to the first option", () => {
    expect(preferredOption([{ id: "browser", label: "Sign in with your browser" }])).toBe("browser");
    expect(preferredOption([])).toBe("");
  });
});

describe("showsPasteField", () => {
  it("offers the paste field as soon as a sign-in page appears, before pi races its prompt", () => {
    expect(showsPasteField(replay([{ type: "event", event: { type: "auth_url", url: "https://claude.ai/oauth" } }]))).toBe(true);
  });

  it("offers it for a manual code asked on its own", () => {
    expect(showsPasteField(replay([prompt({ id: "p1", type: "manual_code", message: "Paste the code" })]))).toBe(true);
  });

  it("hides it once the login has ended", () => {
    const state = replay([{ type: "event", event: { type: "auth_url", url: "https://claude.ai/oauth" } }, { type: "done" }]);
    expect(showsPasteField(state)).toBe(false);
  });
});

describe("allowsBlank", () => {
  it("lets a text step be answered empty, which is how Copilot reaches github.com", () => {
    // An empty input selects the default github.com domain.
    expect(allowsBlank("text")).toBe(true);
  });

  it("requires content for a secret, a pasted code or a choice", () => {
    expect(allowsBlank("secret")).toBe(false);
    expect(allowsBlank("manual_code")).toBe(false);
    expect(allowsBlank("select")).toBe(false);
  });
});

describe("formatCountdown", () => {
  it("reads as minutes and seconds", () => {
    expect(formatCountdown(272)).toBe("4:32");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
