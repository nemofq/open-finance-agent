import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@/lib/atomic-write";
import { sessionAttachmentsDir } from "@/lib/paths";
import { UUID } from "@/lib/utils";
import { IMAGE_EXTENSIONS, IMAGE_MIME_TYPES, isImageMimeType } from "./formats";
import { sniffDimensions } from "./image-size";
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE } from "./limits";
import type { MessageImageInput, StoredImage } from "./types";
import { megabytes } from "./wording";

/**
 * Images the user attached to a message. The bytes go to the chat's attachments folder
 * (`./store`) and the transcript keeps a pi-shaped image block with an empty `data` and an
 * `attachment` name, which hydration fills back in before each model call.
 */

/** Bad input from the composer, surfaced by the route as a 400 rather than a 500. */
export class InvalidImages extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImages";
  }
}

/** Canonical base64, once whitespace a JSON transport may have introduced is gone. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decode one image, refusing anything the model or the disk should not see. The decode is checked
 * by re-encoding: `Buffer.from(…, "base64")` silently drops characters it does not understand, so
 * a truncated or corrupted upload would otherwise become a valid-looking but broken file.
 */
function decode(input: MessageImageInput): Buffer {
  if (!isImageMimeType(input.mimeType)) {
    throw new InvalidImages(`Only ${IMAGE_MIME_TYPES.join(", ")} images can be attached, not ${input.mimeType || "an unnamed type"}.`);
  }
  const base64 = (input.data ?? "").replace(/\s+/g, "");
  if (!BASE64.test(base64) || base64.length % 4 !== 0) {
    throw new InvalidImages("One of the attached images was not valid base64; try attaching it again.");
  }
  // Checked before decoding so an oversized upload is refused without allocating it twice.
  if ((base64.length / 4) * 3 > MAX_IMAGE_BYTES + 3) {
    throw new InvalidImages(`Each attached image must be under ${megabytes(MAX_IMAGE_BYTES)} MB once decoded.`);
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== base64) {
    throw new InvalidImages("One of the attached images could not be decoded; try attaching it again.");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new InvalidImages(`Each attached image must be under ${megabytes(MAX_IMAGE_BYTES)} MB once decoded.`);
  }
  return bytes;
}

/**
 * Write the turn's images and describe them the way the transcript stores them. Everything is
 * validated before anything is written, so a rejected message leaves no files behind. Names are
 * the sha1 of the bytes, which makes a re-sent image free and lets the GET route cache forever.
 *
 * `written`, when given, collects the name of each file this call creates as it creates it, so a
 * caller can undo exactly those after a failure partway through or a later refusal.
 */
export async function writeAttachments(sessionId: string, inputs: MessageImageInput[], written?: string[]): Promise<StoredImage[]> {
  if (inputs.length === 0) return [];
  if (!UUID.test(sessionId)) throw new InvalidImages("That chat cannot take attachments.");
  if (inputs.length > MAX_IMAGES_PER_MESSAGE) {
    throw new InvalidImages(`You can attach at most ${MAX_IMAGES_PER_MESSAGE} images to one message.`);
  }

  const decoded = inputs.map((input) => ({ input, bytes: decode(input) }));
  const dir = sessionAttachmentsDir(sessionId);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const stored: StoredImage[] = [];
  for (const { input, bytes } of decoded) {
    const name = `${createHash("sha1").update(bytes).digest("hex")}.${IMAGE_EXTENSIONS[input.mimeType]}`;
    const file = path.join(/* turbopackIgnore: true */ dir, name);
    // The name is the hash of the bytes, so a file that is already there holds exactly these bytes.
    const present = await access(file).then(
      () => true,
      () => false,
    );
    if (!present) {
      await writeFileAtomic(file, bytes, { mode: 0o600 });
      written?.push(name);
    }
    stored.push({
      type: "image",
      data: "",
      mimeType: input.mimeType,
      attachment: name,
      bytes: bytes.length,
      ...sniffDimensions(bytes, input.mimeType),
    });
  }
  return stored;
}
