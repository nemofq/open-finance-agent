import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLedger } from "@/lib/evidence/ledger";
import { sessionAttachmentsDir, stagingDir } from "@/lib/paths";
import { hydrateAttachments } from "./hydrate";
import { ATTACHMENT_NAME } from "./formats";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_MESSAGE, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE } from "./limits";
import {
  claimDocuments,
  InvalidDocuments,
  readParsed,
  readStoredParse,
  stageDocument,
  sweepStaging,
  unclaimDocuments,
} from "./documents";
import { InvalidImages, writeAttachments } from "./images";
import { readAttachment, removeAttachments } from "./store";
import type { MessageImageInput, StoredImage } from "./types";

let home: string;
let session: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "ofa-attachments-"));
  process.env.OFA_HOME = home;
  session = randomUUID();
});

afterEach(() => {
  delete process.env.OFA_HOME;
  rmSync(home, { recursive: true, force: true });
});

/* ------------------------------------------------------------- fixtures */

/** A PNG header with an IHDR chunk, which is all the sniffer reads. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** SOI, a JFIF segment the sniffer has to step over, then the frame that carries the size. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffd8, 0);
  app0.writeUInt16BE(0xffe0, 2);
  app0.writeUInt16BE(16, 4);
  app0.write("JFIF\0", 6, "ascii");
  const sof = Buffer.alloc(13);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([app0, sof]);
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(13);
  bytes.write("GIF89a", 0, "ascii");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

/** An extended WebP, whose canvas size is two 24-bit values stored one less than they are. */
function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

const input = (bytes: Buffer, mimeType: string): MessageImageInput => ({ data: bytes.toString("base64"), mimeType });

const sha1 = (bytes: Buffer) => createHash("sha1").update(bytes).digest("hex");

/* ---------------------------------------------------------------- tests */

describe("writeAttachments", () => {
  it("names a file by the hash of its bytes and describes it for the transcript", async () => {
    const bytes = png(800, 600);
    const [image] = await writeAttachments(session, [input(bytes, "image/png")]);

    expect(image).toEqual({
      type: "image",
      data: "",
      mimeType: "image/png",
      attachment: `${sha1(bytes)}.png`,
      bytes: bytes.length,
      width: 800,
      height: 600,
    });
    expect(await readFile(path.join(sessionAttachmentsDir(session), image.attachment))).toEqual(bytes);
  });

  it("keeps the input order and writes every image", async () => {
    const stored = await writeAttachments(session, [input(png(2, 2), "image/png"), input(gif(4, 4), "image/gif")]);
    expect(stored.map((image) => image.mimeType)).toEqual(["image/png", "image/gif"]);
    expect(stored.map((image) => path.extname(image.attachment))).toEqual([".png", ".gif"]);
  });

  it("leaves a file that is already there alone: the name says the bytes match", async () => {
    const bytes = png(10, 10);
    const [first] = await writeAttachments(session, [input(bytes, "image/png")]);
    const file = path.join(sessionAttachmentsDir(session), first.attachment);
    // Standing in for the write that must not happen; a rewrite would put the real bytes back.
    await writeFile(file, "untouched");

    await writeAttachments(session, [input(bytes, "image/png")]);
    expect(await readFile(file, "utf8")).toBe("untouched");
  });

  it("writes the folder and the files for the user alone", async () => {
    const [image] = await writeAttachments(session, [input(png(1, 1), "image/png")]);
    const dir = await stat(sessionAttachmentsDir(session));
    const file = await stat(path.join(sessionAttachmentsDir(session), image.attachment));
    expect(dir.mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
  });

  it("refuses more images than a message may carry", async () => {
    const many = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, (_, i) => input(png(i + 1, 1), "image/png"));
    await expect(writeAttachments(session, many)).rejects.toBeInstanceOf(InvalidImages);
    await expect(writeAttachments(session, many)).rejects.toThrow(/at most 4 images/);
  });

  it("refuses a type that is not an image we accept", async () => {
    await expect(writeAttachments(session, [input(png(1, 1), "image/svg+xml")])).rejects.toThrow(/image\/png/);
  });

  it("refuses base64 that does not decode cleanly", async () => {
    await expect(writeAttachments(session, [{ data: "not base64!!", mimeType: "image/png" }])).rejects.toThrow(/base64/);
    // Decodable characters, but not a whole number of bytes: `Buffer.from` would drop the tail.
    await expect(writeAttachments(session, [{ data: "QUJDREU", mimeType: "image/png" }])).rejects.toBeInstanceOf(InvalidImages);
    await expect(writeAttachments(session, [{ data: "", mimeType: "image/png" }])).rejects.toBeInstanceOf(InvalidImages);
  });

  it("refuses an image over the size limit", async () => {
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1024, 7);
    await expect(writeAttachments(session, [input(huge, "image/png")])).rejects.toThrow(/5 MB/);
  });

  it("writes nothing at all when one image of several is bad", async () => {
    const good = png(3, 3);
    await expect(
      writeAttachments(session, [input(good, "image/png"), { data: "!!!", mimeType: "image/png" }]),
    ).rejects.toBeInstanceOf(InvalidImages);
    expect(await readAttachment(session, `${sha1(good)}.png`)).toBeNull();
  });

  it("refuses a session id that never came from the store", async () => {
    await expect(writeAttachments("../escape", [input(png(1, 1), "image/png")])).rejects.toBeInstanceOf(InvalidImages);
  });
});

describe("dimension sniffing", () => {
  it("reads the size out of each format's header", async () => {
    const stored = await writeAttachments(session, [
      input(png(1920, 1080), "image/png"),
      input(jpeg(640, 480), "image/jpeg"),
      input(gif(32, 24), "image/gif"),
      input(webp(1024, 768), "image/webp"),
    ]);
    expect(stored.map((image) => [image.width, image.height])).toEqual([
      [1920, 1080],
      [640, 480],
      [32, 24],
      [1024, 768],
    ]);
  });

  it("stores an image whose header it cannot read rather than refusing it", async () => {
    const [image] = await writeAttachments(session, [input(Buffer.from("not really a png"), "image/png")]);
    expect(image.width).toBeUndefined();
    expect(image.height).toBeUndefined();
    expect(image.bytes).toBe(16);
  });
});

describe("readAttachment", () => {
  it("returns the bytes for a name the store wrote", async () => {
    const bytes = png(5, 5);
    const [image] = await writeAttachments(session, [input(bytes, "image/png")]);
    expect(await readAttachment(session, image.attachment)).toEqual(bytes);
  });

  it("answers nothing for a name that is not a content hash", async () => {
    await writeAttachments(session, [input(png(5, 5), "image/png")]);
    expect(await readAttachment(session, "../../config.json")).toBeNull();
    expect(await readAttachment(session, "evidence.json")).toBeNull();
    expect(await readAttachment(session, `${"a".repeat(40)}.png`)).toBeNull();
  });

  it("answers nothing for a session id that is not a session id", async () => {
    expect(await readAttachment("..", `${"a".repeat(40)}.png`)).toBeNull();
  });
});

describe("removeAttachments", () => {
  it("deletes what it is given and shrugs at what is not there", async () => {
    const [image] = await writeAttachments(session, [input(png(6, 6), "image/png")]);
    await removeAttachments(session, [image.attachment, `${"b".repeat(40)}.png`, "not-a-name"]);
    expect(await readAttachment(session, image.attachment)).toBeNull();
  });
});

/* ------------------------------------------------------------- documents */

const markdown = (text: string) => new TextEncoder().encode(text);

const staged = (name: string) => path.join(stagingDir(), name);
const sidecarOf = (attachment: string) => `${attachment.slice(0, 40)}.json`;

describe("stageDocument", () => {
  it("writes the file and its parse, and describes it for the composer", async () => {
    const bytes = markdown("# Q3 memo\n\nRevenue rose 4%.\n");
    const { stored, parsed } = await stageDocument(bytes, "Q3 memo.md");

    expect(stored.attachment).toBe(`${sha1(Buffer.from(bytes))}.md`);
    expect(stored.name).toBe("Q3 memo.md");
    expect(stored.kind).toBe("document");
    expect(stored.bytes).toBe(bytes.length);
    expect(stored.tokens).toBeGreaterThan(0);
    expect(parsed.version).toBe(1);

    expect(await readFile(staged(stored.attachment))).toEqual(Buffer.from(bytes));
    const sidecar = JSON.parse(await readFile(staged(sidecarOf(stored.attachment)), "utf8"));
    expect(sidecar.stored).toEqual(stored);
    expect(sidecar.parsed.version).toBe(1);
  });

  it("counts a spreadsheet's rows for the chip, and leaves a memo without a count", async () => {
    const book = await stageDocument(markdown("date,ticker,shares\n2026-01-02,NVDA,400\n2026-02-02,MSFT,120\n"), "holdings.csv");
    expect(book.stored).toMatchObject({ kind: "table", parts: 1, rows: 2 });

    const memo = await stageDocument(markdown("# Q3 memo\n\nRevenue rose 4%.\n"), "memo.md");
    expect(memo.stored.rows).toBeUndefined();
  });

  it("refuses a file whose contents are not the format it is named for", async () => {
    // The stored extension comes from the sniff, never from the name: `parse/index.test.ts` covers
    // the whole table of containers, and this is the one case that has to fail here too.
    await expect(stageDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), "notes.txt")).rejects.toThrow(/not really a \.txt file/);
  });

  it("reuses the parse when the same bytes come back, and refreshes only the name", async () => {
    const bytes = markdown("# Same bytes\n");
    const first = await stageDocument(bytes, "original.md");
    // Standing in for the parse that must not happen again: a re-parse would overwrite this.
    await writeFile(staged(first.stored.attachment), "untouched");

    const second = await stageDocument(bytes, "renamed.md");
    expect(second.stored.attachment).toBe(first.stored.attachment);
    expect(second.stored.name).toBe("renamed.md");
    expect(await readFile(staged(first.stored.attachment), "utf8")).toBe("untouched");
  });

  it("refuses an empty file and one past the size cap", async () => {
    await expect(stageDocument(new Uint8Array(), "empty.md")).rejects.toThrow(InvalidDocuments);
    await expect(stageDocument(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "huge.md")).rejects.toThrow(/under 20 MB/);
  });

  it("strips a path and control characters out of the name it repeats back", async () => {
    const { stored } = await stageDocument(markdown("# Named\n"), "../../etc/pa\u0000ssw d.md");
    expect(stored.name).toBe("passw d.md");
  });
});

describe("claimDocuments", () => {
  const stage = (text: string, name: string) => stageDocument(markdown(text), name);

  it("moves the file and its parse into the chat, and reads back", async () => {
    const { stored } = await stage("# Claim me\n\nA sentence.\n", "memo.md");
    const claimed = await claimDocuments(session, [stored.attachment]);

    expect(claimed).toEqual([stored]);
    expect(await readdir(stagingDir())).toEqual([]);
    expect(await readFile(path.join(sessionAttachmentsDir(session), stored.attachment), "utf8")).toContain("Claim me");
    expect((await readParsed(session, stored.attachment))?.version).toBe(1);
    expect((await readStoredParse(session, stored.attachment))?.stored.name).toBe("memo.md");
  });

  it("accepts a file the chat already holds, without needing it in staging", async () => {
    const { stored } = await stage("# Sent twice\n", "memo.md");
    await claimDocuments(session, [stored.attachment]);
    await expect(claimDocuments(session, [stored.attachment])).resolves.toEqual([stored]);
  });

  it("refuses a name that was never staged, and one that is not an attachment name at all", async () => {
    await expect(claimDocuments(session, [`${"c".repeat(40)}.md`])).rejects.toThrow(/no longer available/);
    await expect(claimDocuments(session, ["../../../etc/passwd"])).rejects.toThrow(InvalidDocuments);
    await expect(claimDocuments(session, [`${"c".repeat(40)}.json`])).rejects.toThrow(InvalidDocuments);
    await expect(claimDocuments("not-a-session", [`${"c".repeat(40)}.md`])).rejects.toThrow(/cannot take attachments/);
  });

  it("moves nothing when one of the names is bad", async () => {
    const { stored } = await stage("# All or nothing\n", "memo.md");
    await expect(claimDocuments(session, [stored.attachment, `${"d".repeat(40)}.md`])).rejects.toThrow(InvalidDocuments);
    expect(await readdir(stagingDir())).toContain(stored.attachment);
  });

  it("refuses more documents than one message may carry", async () => {
    const names: string[] = [];
    for (let index = 0; index <= MAX_DOCUMENTS_PER_MESSAGE; index += 1) {
      names.push((await stage(`# Memo ${index}\n`, `m${index}.md`)).stored.attachment);
    }
    await expect(claimDocuments(session, names)).rejects.toThrow(/at most 5 files/);
  });
});

describe("unclaimDocuments", () => {
  it("puts a refused turn's documents back in staging, so sending again works", async () => {
    const { stored } = await stageDocument(markdown("# Retry me\n\nA sentence.\n"), "memo.md");
    await claimDocuments(session, [stored.attachment]);
    await unclaimDocuments(session, [stored.attachment]);

    expect(await readdir(stagingDir())).toEqual(expect.arrayContaining([stored.attachment, sidecarOf(stored.attachment)]));
    // Which is the point: the second send finds the file where the first one found it.
    await expect(claimDocuments(session, [stored.attachment])).resolves.toEqual([stored]);
    expect((await readParsed(session, stored.attachment))?.version).toBe(1);
  });

  it("leaves no empty folder behind, and no file the chat still points at", async () => {
    const { stored } = await stageDocument(markdown("# Undo me\n"), "memo.md");
    await claimDocuments(session, [stored.attachment]);
    await unclaimDocuments(session, [stored.attachment]);

    expect(await readAttachment(session, stored.attachment)).toBeNull();
    await expect(readdir(sessionAttachmentsDir(session))).rejects.toThrow();
  });

  it("says nothing about a name it was never given, a bad name or a bad chat", async () => {
    await expect(unclaimDocuments(session, [])).resolves.toBeUndefined();
    await expect(unclaimDocuments(session, [`${"e".repeat(40)}.md`, "../../etc/passwd"])).resolves.toBeUndefined();
    await expect(unclaimDocuments("not-a-session", [`${"e".repeat(40)}.md`])).resolves.toBeUndefined();
  });
});

describe("removing and serving documents", () => {
  it("takes the parse sidecar with the file when a refused turn is undone", async () => {
    const { stored } = await stageDocument(markdown("# Undo me\n"), "memo.md");
    await claimDocuments(session, [stored.attachment]);
    await removeAttachments(session, [stored.attachment]);

    expect(await readAttachment(session, stored.attachment)).toBeNull();
    expect(await readParsed(session, stored.attachment)).toBeNull();
    // The chat kept nothing else, so `removeAttachments` took the folder as well.
    await expect(readdir(sessionAttachmentsDir(session))).rejects.toThrow();
  });

  it("never serves the parse sidecar, whatever it is asked for", async () => {
    const { stored } = await stageDocument(markdown("# Private\n"), "memo.md");
    await claimDocuments(session, [stored.attachment]);
    const sidecar = sidecarOf(stored.attachment);

    // The file is certainly there; `readAttachment` is what refuses to hand it over.
    expect(await readFile(path.join(sessionAttachmentsDir(session), sidecar), "utf8")).toContain('"version"');
    expect(await readAttachment(session, sidecar)).toBeNull();
    expect(ATTACHMENT_NAME.test(sidecar)).toBe(false);
  });
});

describe("sweepStaging", () => {
  it("drops what nobody claimed and leaves a fresh upload alone", async () => {
    const stale = await stageDocument(markdown("# Forgotten\n"), "old.md");
    const fresh = await stageDocument(markdown("# Just picked\n"), "new.md");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const name of [stale.stored.attachment, sidecarOf(stale.stored.attachment)]) {
      await utimes(staged(name), old, old);
    }

    expect(await sweepStaging()).toBe(2);
    const left = await readdir(stagingDir());
    expect(left).toContain(fresh.stored.attachment);
    expect(left).not.toContain(stale.stored.attachment);
  });

  it("says nothing is there when staging has never been used", async () => {
    await expect(sweepStaging()).resolves.toBe(0);
  });
});

describe("hydrateAttachments, on images", () => {
  /** A window wide enough that the document path below is never the reason a block changed. */
  const options = { model: { contextWindow: 32_768 }, ledger: createLedger({ sessionId: "images" }) };
  const userWith = (image: StoredImage): Message => ({
    role: "user",
    content: [{ type: "text", text: "what is this?" }, image],
    timestamp: 0,
  });

  it("puts the base64 back and leaves our own fields off the wire", async () => {
    const bytes = jpeg(100, 50);
    const [image] = await writeAttachments(session, [input(bytes, "image/jpeg")]);
    const [hydrated] = await hydrateAttachments(session, [userWith(image)], options);

    expect(hydrated.content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", data: bytes.toString("base64"), mimeType: "image/jpeg" },
    ]);
  });

  it("says so in text when the file has gone, rather than failing the turn", async () => {
    const [image] = await writeAttachments(session, [input(png(9, 9), "image/png")]);
    await removeAttachments(session, [image.attachment]);
    const [hydrated] = await hydrateAttachments(session, [userWith(image)], options);

    expect(hydrated.content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "text", text: "(image unavailable)" },
    ]);
  });

  it("leaves messages with nothing attached exactly as they were", async () => {
    const messages: Message[] = [
      { role: "user", content: "plain text", timestamp: 0 },
      { role: "user", content: [{ type: "text", text: "array, no image" }], timestamp: 1 },
      { role: "user", content: [{ type: "image", data: "abc", mimeType: "image/png" }], timestamp: 2 },
    ];
    expect(await hydrateAttachments(session, messages, options)).toEqual(messages);
  });
});
