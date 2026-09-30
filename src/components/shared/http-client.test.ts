import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, httpErrorFrom, patchJson, postForm, postJson, requestJson } from "./http-client";

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws the envelope's sentence as the message and keeps its code", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "The selected chat no longer exists", code: "session_not_found" }, { status: 404 }));
    const error = await requestJson("/api/x").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ message: "The selected chat no longer exists", status: 404, code: "session_not_found" });
  });

  it("falls back to the status line when the body is not the envelope", async () => {
    vi.stubGlobal("fetch", async () => new Response("oops", { status: 502, statusText: "Bad Gateway" }));
    const error = await requestJson("/api/x").catch((reason: unknown) => reason);
    expect(error).toMatchObject({ message: "502 Bad Gateway", status: 502, code: undefined });
  });
});

describe("the verb helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Records what was sent and answers `{ ok: true }`. */
  function recording() {
    const sent: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(init);
      return Response.json({ ok: true });
    });
    return sent;
  }

  it("sends a JSON body with its content type, and none for a bare action", async () => {
    const sent = recording();
    await patchJson("/api/x", { name: "a" });
    await postJson("/api/x/run");
    expect(sent[0]).toMatchObject({ method: "PATCH", headers: { "content-type": "application/json" }, body: '{"name":"a"}' });
    expect(sent[1]).toEqual({ method: "POST" });
  });

  it("leaves a form's content type to the browser", async () => {
    const sent = recording();
    const form = new FormData();
    form.set("text", "a,b");
    expect(await postForm("/api/x", form)).toEqual({ ok: true });
    expect(sent[0]).toEqual({ method: "POST", body: form });
  });
});

describe("httpErrorFrom", () => {
  it("reads a streaming route's refusal into the same HttpError", async () => {
    const res = Response.json({ error: "ChatGPT is not signed in any more.", code: "reauth_required" }, { status: 400 });
    expect(await httpErrorFrom(res)).toMatchObject({ message: "ChatGPT is not signed in any more.", status: 400, code: "reauth_required" });
    const bare = await httpErrorFrom(new Response(null, { status: 500, statusText: "Internal Server Error" }));
    expect(bare).toMatchObject({ message: "500 Internal Server Error", code: undefined });
  });
});
