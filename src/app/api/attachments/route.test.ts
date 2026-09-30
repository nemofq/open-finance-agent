/**
 * The document round trip: upload → stage → claim → serve → delete, over the route
 * handlers themselves rather than the store beneath them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@/lib/attachments/limits";
import { claimDocuments } from "@/lib/attachments/documents";
import { removeAttachments } from "@/lib/attachments/store";
import type { StoredAttachment } from "@/lib/attachments/types";
import { stagingDir } from "@/lib/paths";
import { createSession } from "@/lib/sessions/store";
import { GET as GET_FILE } from "../sessions/[id]/attachments/[name]/route";
import { GET as GET_TEXT } from "../sessions/[id]/attachments/[name]/text/route";
import { POST as SEND } from "../sessions/[id]/messages/route";
import { POST } from "./route";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-attachments-api-"));
  process.env.OFA_HOME = home;
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

/* -------------------------------------------------------------- helpers */

function upload(name: string, body: BlobPart, type = "application/octet-stream"): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([body], name, { type }));
  return POST(new Request("http://localhost/api/attachments", { method: "POST", body: form }));
}

const serve = (id: string, name: string) => GET_FILE(new Request("http://localhost/"), { params: Promise.resolve({ id, name }) });
const text = (id: string, name: string) => GET_TEXT(new Request("http://localhost/"), { params: Promise.resolve({ id, name }) });

const chat = () => createSession({ model: { provider: "lab", model: "qwen3" } });

const MEMO = "# Q3 memo\n\nRevenue rose 4% to $1.2bn.\n";

/* ---------------------------------------------------------------- tests */

describe("POST /api/attachments", () => {
  it("parses the file, stages it, and answers with the descriptor", async () => {
    const response = await upload("Q3 memo.md", MEMO, "text/markdown");
    expect(response.status).toBe(200);

    const { document } = (await response.json()) as { document: StoredAttachment };
    expect(document.name).toBe("Q3 memo.md");
    expect(document.kind).toBe("document");
    expect(document.attachment).toMatch(/^[0-9a-f]{40}\.md$/);
    expect(document.tokens).toBeGreaterThan(0);
    expect(document.parts).toBeGreaterThan(0);

    // Both halves are in staging: the file, and the parse the model will read.
    expect((await readdir(stagingDir())).sort()).toEqual([`${document.attachment.slice(0, 40)}.json`, document.attachment].sort());
  });

  it("refuses a file that is not something we read", async () => {
    const response = await upload("archive.zip", "PK");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "unsupported_document" });
  });

  it("explains .ppt instead of just refusing it", async () => {
    const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const response = await upload("deck.ppt", ole2);
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/Save as \.pptx and attach again/);
  });

  it("refuses a file whose contents are not what it is named", async () => {
    const response = await upload("notes.txt", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/not really a \.txt file/);
  });

  it("tells the user a protected Office file is protected", async () => {
    // Office encrypts the zip and wraps it in OLE2, so a password-protected .docx looks like this.
    const response = await upload("memo.docx", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/memo\.docx is password-protected\. Remove the password and attach it again\./);
  });

  it("turns a parser that refuses a file into an answer, never a crash", async () => {
    // A zip that is not a Word document: the sniff lets it through and `docx.ts` throws. A parser's
    // own caps — zip entries, decompressed size — come back to the user by this same road.
    const response = await upload("memo.docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(0)]));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("parse_failed");
    expect(body.error).toMatch(/memo\.docx/);
  });

  it("refuses a file past the size cap without reading it", async () => {
    const response = await upload("huge.md", new Uint8Array(MAX_DOCUMENT_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "document_too_large" });
  });

  it("asks for a file when the form has none", async () => {
    const form = new FormData();
    form.append("text", "pasted instead");
    const response = await POST(new Request("http://localhost/api/attachments", { method: "POST", body: form }));
    expect(response.status).toBe(400);
  });
});

describe("serving a claimed document", () => {
  async function staged(): Promise<{ id: string; document: StoredAttachment }> {
    const { document } = (await (await upload("Q3 memo.md", MEMO, "text/markdown")).json()) as { document: StoredAttachment };
    const { id } = await chat();
    await claimDocuments(id, [document.attachment]);
    return { id, document };
  }

  it("hands the original back as a download, named the way the user named it", async () => {
    const { id, document } = await staged();
    const response = await serve(id, document.attachment);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="Q3 memo.md"; filename*=UTF-8''Q3%20memo.md`);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe(MEMO);
  });

  it("hands html back as text, so nothing uploaded can render in our origin", async () => {
    const { document } = (await (await upload("page.html", "<h1>Hi</h1><script>alert(1)</script>", "text/html")).json()) as { document: StoredAttachment };
    const { id } = await chat();
    await claimDocuments(id, [document.attachment]);

    const response = await serve(id, document.attachment);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/);
  });

  it("returns the normalised markdown for the preview", async () => {
    const { id, document } = await staged();
    const response = await text(id, document.attachment);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toContain("Revenue rose 4%");
  });

  it("never serves the parse sidecar", async () => {
    const { id, document } = await staged();
    const sidecar = `${document.attachment.slice(0, 40)}.json`;
    expect((await serve(id, sidecar)).status).toBe(404);
    expect((await text(id, sidecar)).status).toBe(404);
  });

  it("stops answering once the file is gone", async () => {
    const { id, document } = await staged();
    await removeAttachments(id, [document.attachment]);
    expect((await serve(id, document.attachment)).status).toBe(404);
    expect((await text(id, document.attachment)).status).toBe(404);
  });

  it("answers for no chat but the one that holds the file", async () => {
    const { document } = await staged();
    const other = await chat();
    expect((await serve(other.id, document.attachment)).status).toBe(404);
    expect((await serve("not-a-session", document.attachment)).status).toBe(404);
  });
});

describe("the claim step of POST /api/sessions/[id]/messages", () => {
  const send = async (id: string, body: object) =>
    SEND(new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });

  it("refuses documents that did not arrive as a list of names", async () => {
    const { id } = await chat();
    const response = await send(id, { text: "read this", documents: "memo.md" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_documents" });
  });

  it("refuses a name that was never staged, before the turn starts", async () => {
    const { id } = await chat();
    const response = await send(id, { text: "read this", documents: [`${"a".repeat(40)}.md`] });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/no longer available/);
  });

  it("takes a message that is nothing but an attachment", async () => {
    const { id } = await chat();
    // Messages containing only attachments are valid.
    const response = await send(id, { documents: [`${"a".repeat(40)}.md`] });
    expect(await response.json()).not.toMatchObject({ error: "text or skill is required" });
  });
});
