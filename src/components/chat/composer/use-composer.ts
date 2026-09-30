"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { postForm } from "@/components/shared/http-client";
import { UPLOAD_URL } from "@/lib/attachments/formats";
import type { StoredAttachment } from "@/lib/attachments/types";
import { errorMessage, randomId } from "@/lib/utils";
import { acceptFiles, type Attached, type PendingDocument, type PendingImage } from "./attachments";
import { parseCommand } from "./commands";
import { prepareImages, type PreparedImages } from "./prepare-image";
import { renderPdfToImageFiles } from "./prepare-pdf";

export interface ComposerState {
  draft: string;
  setDraft: (draft: string) => void;
  skill: string | undefined;
  setSkill: (skill: string | undefined) => void;
  /** Images the composer is holding for the next message, each with its own object URL. */
  images: PendingImage[];
  /** Documents the composer is holding; each is uploaded and parsed the moment it is picked. */
  documents: PendingDocument[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Append a token (a `$TICKER`, say) to the draft and focus the input. */
  insert: (text: string) => void;
  /** Put an example prompt in the draft, with its skill. */
  pick: (example: { text: string; skill?: string }) => void;
  addFiles: (files: File[]) => void;
  removeImage: (id: string) => void;
  removeDocument: (id: string) => void;
  /** Send the draft with its skill and attachments, emptying the composer. */
  submit: () => Promise<void>;
}

/**
 * What the composer holds before a message goes: the draft, the skill, and the images and
 * documents attached to it. Image previews are object URLs, so they are revoked when an image is
 * removed or the chat goes away, but never at send: the optimistic bubble draws from them until
 * the server echoes the turn, and the session revokes them then.
 */
export function useComposer({
  send,
  compact,
  attachDisabledReason,
}: {
  send: (text: string, skill?: string, attached?: PreparedImages, documents?: StoredAttachment[]) => Promise<void>;
  compact: (focus?: string) => Promise<void>;
  /** Why this turn's model cannot take images, if it cannot. */
  attachDisabledReason: string | undefined;
}): ComposerState {
  const [draft, setDraft] = useState("");
  const [skill, setSkill] = useState<string | undefined>(undefined);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insert = useCallback((text: string) => {
    setDraft((current) => (current === "" || current.endsWith(" ") ? `${current}${text} ` : `${current} ${text} `));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const pick = useCallback((example: { text: string; skill?: string }) => {
    setDraft(example.text);
    setSkill(example.skill);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  /**
   * What the composer is holding, as a ref: an upload settles long after the render that started
   * it, and what may still join the message has to be read at that moment, not at that render.
   */
  const attachedRef = useRef<Attached>({ images: [], documents: [] });
  useEffect(() => {
    attachedRef.current = { images, documents };
  }, [images, documents]);

  /** Take accepted image files into the composer, each with the object URL its thumbnail draws. */
  const holdImages = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setImages((current) => [
      ...current,
      ...files.map((file) => ({
        id: randomId(),
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType: file.type,
      })),
    ]);
  }, []);

  /**
   * Send one document to be parsed. It goes up before the message does, and before this chat has a
   * session at all: the file waits in staging under the name its bytes hash to, and the message
   * claims it by that name. Until the descriptor comes back the chip says "Parsing…" and the turn
   * cannot be sent.
   */
  const upload = useCallback(
    async (file: File) => {
      const id = randomId();
      setDocuments((current) => [...current, { id, file, name: file.name, bytes: file.size }]);
      const settle = (patch: Partial<PendingDocument>) =>
        setDocuments((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

      try {
        const form = new FormData();
        form.append("file", file);
        const { document } = await postForm<{ document: StoredAttachment }>(UPLOAD_URL, form);
        settle({ document });

        // Pages with no text layer are the one thing the parse cannot hand the model. On a model
        // that sees pictures they ride along as images beside the document; on one
        // that does not, the digest says which pages they were. Whatever happens here, the document
        // itself has been read: a page that will not render is a toast, never the file's failure.
        const scanned = document.scannedParts ?? [];
        if (scanned.length === 0 || attachDisabledReason !== undefined) return;
        try {
          const pageFiles = await renderPdfToImageFiles(file, scanned);
          const { images: accepted, rejected } = acceptFiles(attachedRef.current, pageFiles);
          for (const reason of new Set(rejected.map((entry) => entry.reason))) toast.error(reason);
          holdImages(accepted);
        } catch (err) {
          toast.error(`The scanned pages of ${file.name} could not be rendered: ${errorMessage(err)}`);
        }
      } catch (err) {
        settle({ error: errorMessage(err) });
      }
    },
    [attachDisabledReason, holdImages],
  );

  /** Everything the composer collected, from the button, a drop or a paste. */
  const addFiles = useCallback(
    (files: File[]) => {
      const { images: accepted, documents: picked, rejected } = acceptFiles(attachedRef.current, files);
      // Several files usually fail for the same reason; say it once.
      for (const reason of new Set(rejected.map((entry) => entry.reason))) toast.error(reason);
      // Only the pictures are turned away: a document reaches the model as text on any model.
      if (accepted.length > 0 && attachDisabledReason !== undefined) toast.error(attachDisabledReason);
      else holdImages(accepted);
      for (const file of picked) void upload(file);
    },
    [attachDisabledReason, holdImages, upload],
  );

  const removeImage = useCallback((id: string) => {
    setImages((current) => {
      const image = current.find((candidate) => candidate.id === id);
      if (image) URL.revokeObjectURL(image.previewUrl);
      return current.filter((candidate) => candidate.id !== id);
    });
  }, []);

  /** The staged file is left where it is; the daily sweep collects what no chat ever claimed. */
  const removeDocument = useCallback((id: string) => {
    setDocuments((current) => current.filter((candidate) => candidate.id !== id));
  }, []);

  /** Nothing on screen is using the previews once the chat goes away. */
  useEffect(
    () => () => {
      for (const image of attachedRef.current.images) URL.revokeObjectURL(image.previewUrl);
    },
    [],
  );

  /**
   * What the composer's send button does: run the images through the canvas first, so a picture
   * too large to send is refused before the turn starts rather than after it has been posted.
   */
  const submit = useCallback(async () => {
    const text = draft.trim();
    const sent = skill;
    setDraft("");
    setSkill(undefined);
    const command = parseCommand(text);
    if (command) {
      void compact(command.focus);
      return;
    }
    // A new chat can still switch models after a picture was attached, which is the one way
    // images and a model that cannot read them meet at send time.
    if (images.length > 0 && attachDisabledReason !== undefined) {
      toast.error(attachDisabledReason);
      setDraft(text);
      setSkill(sent);
      return;
    }
    const failed = documents.filter((entry) => entry.error !== undefined);
    if (failed.length > 0) {
      toast.error(`${failed.map((entry) => entry.name).join(", ")} could not be read and ${failed.length === 1 ? "was" : "were"} not attached.`);
    }
    const ready = documents.flatMap((entry) => (entry.document === undefined ? [] : [entry.document]));

    let attached: PreparedImages | undefined;
    if (images.length > 0) {
      try {
        attached = await prepareImages(images);
      } catch (err) {
        toast.error(errorMessage(err));
        // The composer has already emptied itself, so put the turn back: the images stay
        // attached, and the user can drop the one that failed and send again.
        setDraft(text);
        setSkill(sent);
        return;
      }
    }
    // Cleared, not revoked: the optimistic bubble draws from these object URLs until the echo.
    setImages([]);
    setDocuments([]);
    await send(text, sent, attached, ready);
  }, [attachDisabledReason, compact, send, draft, skill, images, documents]);

  return {
    draft,
    setDraft,
    skill,
    setSkill,
    images,
    documents,
    textareaRef,
    insert,
    pick,
    addFiles,
    removeImage,
    removeDocument,
    submit,
  };
}
