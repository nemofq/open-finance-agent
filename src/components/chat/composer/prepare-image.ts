import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE } from "@/lib/attachments/limits";
import type { MessageImageInput } from "@/lib/attachments/types";
import type { LocalImage, PendingImage } from "./attachments";

/** What the composer puts on the wire, plus the pixel size the optimistic thumbnail is drawn at. */
export type PreparedImage = MessageImageInput & { width: number; height: number };

/** Re-encoding an animated GIF would flatten it to its first frame, so a GIF goes as it came. */
const PASS_THROUGH = "image/gif";

/** JPEG has no lossless mode; 0.9 is the usual point where re-encoding stops being visible. */
const JPEG_QUALITY = 0.9;

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Base64 without the `data:` prefix, which is what `MessageImageInput.data` holds. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma === -1) reject(new Error("The image could not be read."));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function toBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error("The image could not be encoded.")) : resolve(blob)),
      mimeType,
      mimeType === "image/jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} could not be read as an image.`);
  }
}

/**
 * Downsize a picked image to something a model will actually look at. Providers scale anything
 * larger than `MAX_IMAGE_EDGE` down themselves before billing for it, so sending the full-resolution
 * original only costs the user upload time; the byte cap is checked on the result, because that is
 * what the request carries.
 */
async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await decode(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));

  // A GIF, and an image already small enough, are sent byte for byte: re-encoding either one can
  // only lose something (the animation, or a little more detail) for no saving worth having.
  if (file.type === PASS_THROUGH || scale === 1) {
    bitmap.close();
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${file.name} is ${megabytes(file.size)}; the limit is ${megabytes(MAX_IMAGE_BYTES)}.`);
    }
    return { data: await toBase64(file), mimeType: file.type, width, height };
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new Error(`${file.name} could not be resized in this browser.`);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await toBlob(canvas, file.type);
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${file.name} is still ${megabytes(blob.size)} after resizing; the limit is ${megabytes(MAX_IMAGE_BYTES)}.`,
    );
  }
  return {
    data: await toBase64(blob),
    // A browser that cannot write the asked-for type quietly hands back a PNG, so trust the blob.
    mimeType: blob.type || file.type,
    width: canvas.width,
    height: canvas.height,
  };
}

/** A message's images: the payloads for the request, and the blocks the optimistic echo shows. */
export interface PreparedImages {
  input: MessageImageInput[];
  blocks: LocalImage[];
}

/**
 * Downsize a whole message's attachments at once. It rejects as soon as any one of them fails, so
 * the caller can keep the draft intact and let the user drop the offending picture.
 */
export async function prepareImages(images: PendingImage[]): Promise<PreparedImages> {
  const prepared = await Promise.all(images.map((image) => prepareImage(image.file)));
  return {
    input: prepared.map(({ data, mimeType }) => ({ data, mimeType })),
    blocks: prepared.map((ready, index) => ({
      type: "image",
      data: "",
      attachment: "",
      mimeType: ready.mimeType,
      // The picked file's size: the echo only needs a plausible figure, and the server will write
      // the real one once it has saved the downsized copy.
      bytes: images[index].file.size,
      width: ready.width,
      height: ready.height,
      previewUrl: images[index].previewUrl,
    })),
  };
}
