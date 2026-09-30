import { describe, expect, it } from "vitest";
import type { StoredAttachment } from "@/lib/attachments/types";
import type { LlmModelInfo, ProviderModels } from "@/lib/llm/types";
import {
  acceptFiles,
  type Attached,
  documentBudget,
  filesFromClipboard,
  filesFromDataTransfer,
  imageSupportReason,
  isParsing,
  type PendingImage,
} from "./attachments";

function file(name: string, type: string, size = 6): File {
  const blob = new File(["x".repeat(size)], name, { type });
  return blob;
}

/** A `DataTransfer` as the two extractors read it; jsdom is not available in this suite. */
function transfer(files: File[], items?: { kind: string; file: File | null }[]): DataTransfer {
  return {
    files,
    items: items?.map(({ kind, file: carried }) => ({ kind, getAsFile: () => carried })),
    types: files.length > 0 || items ? ["Files"] : [],
  } as unknown as DataTransfer;
}

/** A file of a given size without the bytes to go with it; only `acceptFiles` reads the size. */
function sized(name: string, bytes: number): File {
  const entry = file(name, "");
  Object.defineProperty(entry, "size", { value: bytes });
  return entry;
}

function pending(count: number): PendingImage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    file: file(`held-${index}.png`, "image/png"),
    previewUrl: `blob:held-${index}`,
    mimeType: "image/png",
  }));
}

const descriptor = (name: string, extra: Partial<StoredAttachment> = {}): StoredAttachment => ({
  attachment: `${"a".repeat(40)}.${name.split(".").at(-1)}`,
  name,
  kind: "document",
  bytes: 4096,
  tokens: 1200,
  parts: 1,
  ...extra,
});

/** What the composer holds, as `acceptFiles` reads it. */
function held(images = 0, documents = 0): Attached {
  return {
    images: pending(images),
    documents: Array.from({ length: documents }, (_, index) => ({
      id: `d${index}`,
      file: file(`held-${index}.docx`, ""),
      name: `held-${index}.docx`,
      bytes: 10,
      document: descriptor(`held-${index}.docx`),
    })),
  };
}

describe("filesFromDataTransfer", () => {
  it("hands over everything that was dropped, so each file earns its own answer", () => {
    const shot = file("shot.png", "image/png");
    const doc = file("report.pdf", "application/pdf");
    const bundle = file("archive.zip", "application/zip");
    expect(filesFromDataTransfer(transfer([shot, doc, bundle]))).toEqual([shot, doc, bundle]);
  });

  it("has nothing to offer without a data transfer", () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
  });
});

describe("filesFromClipboard", () => {
  it("reads a pasted screenshot from the items", () => {
    const shot = file("screenshot.png", "image/png");
    expect(filesFromClipboard(transfer([], [{ kind: "file", file: shot }]))).toEqual([shot]);
  });

  it("reads a pasted PDF from the items", () => {
    const doc = file("report.pdf", "application/pdf");
    expect(filesFromClipboard(transfer([], [{ kind: "file", file: doc }]))).toEqual([doc]);
  });

  it("ignores the text flavour that rides along with a copied image", () => {
    const shot = file("shot.png", "image/png");
    const items = [
      { kind: "string", file: null },
      { kind: "file", file: shot },
    ];
    expect(filesFromClipboard(transfer([], items))).toEqual([shot]);
  });

  it("falls back to the file list when the clipboard carries no items", () => {
    const shot = file("shot.webp", "image/webp");
    expect(filesFromClipboard(transfer([shot]))).toEqual([shot]);
  });

  it("returns nothing for a plain text paste", () => {
    expect(filesFromClipboard(transfer([], [{ kind: "string", file: null }]))).toEqual([]);
  });
});

describe("acceptFiles", () => {
  it("takes the four supported image types", () => {
    const files = [
      file("a.png", "image/png"),
      file("b.jpg", "image/jpeg"),
      file("c.webp", "image/webp"),
      file("d.gif", "image/gif"),
    ];
    expect(acceptFiles(held(), files).images).toEqual(files);
  });

  it("names the image type it cannot take", () => {
    const { images, rejected } = acceptFiles(held(), [file("logo.svg", "image/svg+xml")]);
    expect(images).toEqual([]);
    expect(rejected).toEqual([
      { file: expect.any(File), reason: "logo.svg is not a PNG, JPEG, WebP or GIF." },
    ]);
  });

  it("sorts a mixed pick into images and documents", () => {
    const shot = file("shot.png", "image/png");
    const memo = file("Q3 memo.docx", "");
    const book = file("model.xlsx", "application/vnd.ms-excel");
    const filing = file("10-K.pdf", "application/pdf");
    const { images, documents, rejected } = acceptFiles(held(), [shot, memo, book, filing]);
    expect(images).toEqual([shot]);
    expect(documents).toEqual([memo, book, filing]);
    expect(rejected).toEqual([]);
  });

  it("goes by extension, whatever the browser called the file", () => {
    const { documents } = acceptFiles(held(), [file("holdings.csv", "application/vnd.ms-excel")]);
    expect(documents.map((entry) => entry.name)).toEqual(["holdings.csv"]);
  });

  it("explains the formats it turns away on purpose", () => {
    const { rejected } = acceptFiles(held(), [file("deck.ppt", "application/vnd.ms-powerpoint")]);
    expect(rejected[0].reason).toBe("deck.ppt can't be read — Save as .pptx and attach again.");
  });

  it("says so for a kind of file it has no use for", () => {
    const { rejected } = acceptFiles(held(), [file("archive.zip", "application/zip")]);
    expect(rejected[0].reason).toBe("archive.zip is not a kind of file that can be attached.");
  });

  it("turns away a document that is over the size cap", () => {
    const { documents, rejected } = acceptFiles(held(), [sized("huge.pdf", 21 * 1024 * 1024)]);
    expect(documents).toEqual([]);
    expect(rejected[0].reason).toBe("huge.pdf is larger than 20 MB.");
  });

  it("counts what is already attached against each limit", () => {
    const images = [file("a.png", "image/png"), file("b.png", "image/png")];
    const first = acceptFiles(held(3), images);
    expect(first.images.map((entry) => entry.name)).toEqual(["a.png"]);
    expect(first.rejected[0].reason).toBe("You can attach up to 4 images to a message.");

    const docs = [file("one.docx", ""), file("two.docx", "")];
    const second = acceptFiles(held(0, 4), docs);
    expect(second.documents.map((entry) => entry.name)).toEqual(["one.docx"]);
    expect(second.rejected[0].reason).toBe("You can attach up to 5 documents to a message.");
  });

  it("keeps the two limits apart", () => {
    const { images, documents, rejected } = acceptFiles(held(4, 0), [file("memo.docx", "")]);
    expect(images).toEqual([]);
    expect(documents.map((entry) => entry.name)).toEqual(["memo.docx"]);
    expect(rejected).toEqual([]);
  });

  it("does not let an unsupported file use up one of the slots", () => {
    const files = [file("logo.svg", "image/svg+xml"), file("b.png", "image/png")];
    const { images } = acceptFiles(held(3), files);
    expect(images.map((entry) => entry.name)).toEqual(["b.png"]);
  });
});

describe("isParsing", () => {
  const entry = { id: "d0", file: file("memo.docx", ""), name: "memo.docx", bytes: 10 };

  it("is true only while the upload has neither answered nor failed", () => {
    expect(isParsing(entry)).toBe(true);
    expect(isParsing({ ...entry, document: descriptor("memo.docx") })).toBe(false);
    expect(isParsing({ ...entry, error: "It could not be read." })).toBe(false);
  });
});

describe("imageSupportReason", () => {
  const model = (id: string, supportsImages: boolean): LlmModelInfo => ({
    id,
    name: id.toUpperCase(),
    contextLength: 128_000,
    pricing: { input: 1, output: 2 },
    supportsReasoning: false,
    supportsImages,
  });

  const providers: ProviderModels[] = [
    {
      provider: "openrouter",
      name: "OpenRouter",
      type: "openrouter",
      models: [model("text-only", false), model("sees-images", true)],
    },
    {
      provider: "lab",
      name: "Lab",
      type: "openai-compatible",
      models: [model("local", false)],
    },
  ];

  it("names the model that cannot see images", () => {
    expect(imageSupportReason(providers, { provider: "openrouter", model: "text-only" })).toBe(
      "OpenRouter · TEXT-ONLY can't see images.",
    );
  });

  it("points an endpoint's model at the setting that turns images on", () => {
    expect(imageSupportReason(providers, { provider: "lab", model: "local" })).toBe(
      "Lab · LOCAL can't see images. Turn on Images for it in Settings › LLM.",
    );
  });

  it("stays out of the way for a model that does see images", () => {
    expect(imageSupportReason(providers, { provider: "openrouter", model: "sees-images" })).toBeUndefined();
  });

  it("leaves attaching open when the model is not in the loaded catalogues", () => {
    expect(imageSupportReason(providers, { provider: "openrouter", model: "retired" })).toBeUndefined();
    expect(imageSupportReason(providers, { provider: "gone", model: "local" })).toBeUndefined();
  });

  it("has nothing to say before a model is chosen", () => {
    expect(imageSupportReason(providers, null)).toBeUndefined();
  });

  describe("documentBudget", () => {
    const withWindow = (contextLength: number): ProviderModels[] => [
      { ...providers[0], models: [{ ...model("sees-images", true), contextLength }] },
    ];
    const ref = { provider: "openrouter", model: "sees-images" };

    it("gives a fifth of the context window", () => {
      expect(documentBudget(withWindow(128_000), ref)).toBe(25_600);
    });

    it("clamps it at both ends", () => {
      expect(documentBudget(withWindow(8_000), ref)).toBe(4_000);
      expect(documentBudget(withWindow(1_000_000), ref)).toBe(60_000);
    });

    it("gives an endpoint that reports no window the figure the server will use", () => {
      expect(documentBudget(withWindow(0), ref)).toBe(6_000);
    });

    it("says nothing for a model it cannot find, or before one is chosen", () => {
      expect(documentBudget(providers, { provider: "openrouter", model: "retired" })).toBeUndefined();
      expect(documentBudget(providers, null)).toBeUndefined();
    });
  });
});
