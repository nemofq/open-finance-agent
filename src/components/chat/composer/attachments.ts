import { inlineBudget } from "@/lib/attachments/budget";
import { isImageMimeType, rejected as rejectedFormat, supported } from "@/lib/attachments/formats";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS_PER_MESSAGE, MAX_IMAGES_PER_MESSAGE } from "@/lib/attachments/limits";
import type { StoredAttachment, StoredImage } from "@/lib/attachments/types";
import type { ModelRef } from "@/lib/config/schema";
import { modelLabel } from "@/lib/llm/catalog";
import type { ProviderModels } from "@/lib/llm/types";

/*
 * What the composer holds before a message goes, and what it will take: the files it accepts, the
 * images and documents waiting to be sent, and what this chat's model allows. How a sent turn's
 * attachments render is in ../message-attachments.ts.
 */

/**
 * An image the composer holds but has not sent yet. The file is kept as the user gave it, so
 * `prepareImage` can downsize it at send time rather than on every keystroke, and `previewUrl` is
 * an object URL whose lifetime the chat owns (it revokes on removal and once a turn the server accepted has settled).
 */
export interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
}

/** An image block on the optimistic echo: the server's shape, pointed at a local object URL. */
export interface LocalImage extends StoredImage {
  /** Empty until the server answers with the content-addressed name it saved the file under. */
  attachment: "";
  /**
   * Client-only, and the reason the transcript can show a thumbnail before the upload lands. A
   * message that came from the server never carries it.
   */
  previewUrl: string;
}

/**
 * A document the composer holds. Unlike an image, it goes to the server the moment it is picked:
 * parsing is what turns it into something the model can read, and the descriptor that comes back is
 * all the message carries. Until then `document` and `error` are both unset and the chip says so.
 */
export interface PendingDocument {
  id: string;
  /** Kept so a scanned PDF's pages can still be rendered in the browser once the parse lands. */
  file: File;
  name: string;
  bytes: number;
  /** What the upload parsed the file into; the message sends `document.attachment`. */
  document?: StoredAttachment;
  /** Why the upload failed. The chip shows it, and the file is left out of the message. */
  error?: string;
}

/** Everything the composer is holding for the next message. */
export interface Attached {
  images: PendingImage[];
  documents: PendingDocument[];
}

/** A file the composer turned away, with the line to show the user. */
export interface RejectedFile {
  file: File;
  reason: string;
}

/** True while the upload is still parsing, which is what holds the send button. */
export function isParsing(entry: PendingDocument): boolean {
  return entry.document === undefined && entry.error === undefined;
}

/** Everything in a drop, whatever it is: an unsupported file earns a reason from `acceptFiles`. */
export function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files];
}

/**
 * The files on the clipboard. A screenshot arrives as an item rather than a file, which is why
 * this reads `items` first and only falls back to `files`.
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = [...(data.items ?? [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  return fromItems.length > 0 ? fromItems : [...data.files];
}

/**
 * Which of `files` may join `current`, split by what they are. The browser's declared type decides
 * only whether the user meant to attach a picture; everything else goes by extension, because a
 * `.csv` arrives as `application/vnd.ms-excel` on plenty of machines. The kind is settled before the
 * count, so a file that could never be attached does not use up one of the message's slots, and the
 * two limits are independent: images and documents do not compete for the same five slots.
 */
export function acceptFiles(
  current: Attached,
  files: File[],
): { images: File[]; documents: File[]; rejected: RejectedFile[] } {
  const images: File[] = [];
  const documents: File[] = [];
  const rejected: RejectedFile[] = [];
  let imageRoom = MAX_IMAGES_PER_MESSAGE - current.images.length;
  let documentRoom = MAX_DOCUMENTS_PER_MESSAGE - current.documents.length;

  for (const file of files) {
    const explained = rejectedFormat(file.name);
    if (explained !== undefined) {
      rejected.push({ file, reason: `${file.name} can't be read — ${explained}.` });
      continue;
    }

    if (file.type.startsWith("image/")) {
      if (!isImageMimeType(file.type)) {
        rejected.push({ file, reason: `${file.name} is not a PNG, JPEG, WebP or GIF.` });
      } else if (imageRoom <= 0) {
        rejected.push({ file, reason: `You can attach up to ${MAX_IMAGES_PER_MESSAGE} images to a message.` });
      } else {
        images.push(file);
        imageRoom -= 1;
      }
      continue;
    }

    if (supported(file.name) === undefined) {
      rejected.push({ file, reason: `${file.name} is not a kind of file that can be attached.` });
      continue;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      rejected.push({ file, reason: `${file.name} is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.` });
      continue;
    }
    if (documentRoom <= 0) {
      rejected.push({ file, reason: `You can attach up to ${MAX_DOCUMENTS_PER_MESSAGE} documents to a message.` });
      continue;
    }
    documents.push(file);
    documentRoom -= 1;
  }

  return { images, documents, rejected };
}

/**
 * What one message may inline on this model, in tokens, worked out by the same function the server
 * spends it with. `undefined` only for a model the loaded catalogues do not list: an endpoint that
 * states no window still gets the figure the server will use, but a model we know nothing about
 * would only earn a guess, and the chip is better off saying nothing.
 */
export function documentBudget(providers: ProviderModels[], ref: ModelRef | null): number | undefined {
  if (ref === null) return undefined;
  const provider = providers.find((candidate) => candidate.provider === ref.provider);
  const model = provider?.models.find((candidate) => candidate.id === ref.model);
  return model === undefined ? undefined : inlineBudget(model.contextLength);
}

/** Returns the reason images cannot be attached for the model, or undefined if allowed. */
export function imageSupportReason(providers: ProviderModels[], ref: ModelRef | null): string | undefined {
  if (ref === null) return undefined;
  const provider = providers.find((candidate) => candidate.provider === ref.provider);
  const model = provider?.models.find((candidate) => candidate.id === ref.model);
  if (!provider || !model || model.supportsImages !== false) return undefined;
  // An endpoint's catalogue cannot be asked what it accepts, so its models carry whatever the
  // user ticked in settings; that is where the flag is turned back on.
  const hint = provider.type === "openai-compatible" ? " Turn on Images for it in Settings › LLM." : "";
  return `${modelLabel(provider.name, model.name)} can't see images.${hint}`;
}
