import { MAX_IMAGE_EDGE } from "@/lib/attachments/limits";

/** Maximum number of pages to render. */
const MAX_PAGES = 4;

/** Strip file extension from filename for display in page labels. */
function baseNameOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Render pages of a PDF document into PNG Image File objects in the browser.
 * Uses pdfjs-dist dynamically loaded with a local worker. `pages` are 1-based, in order: the
 * server's parse names the pages that have no text layer, and those are the only ones worth a
 * picture.
 */
export async function renderPdfToImageFiles(file: File, pages: number[]): Promise<File[]> {
  if (typeof window === "undefined") {
    throw new Error("PDF rendering is only supported in browser environments.");
  }

  const pdfjsLib = await import("pdfjs-dist");

  // Point to the local worker in public/
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  });

  const pdf = await loadingTask.promise;
  const pagesToRender = pages
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pdf.numPages)
    .slice(0, MAX_PAGES);
  const base = baseNameOf(file.name);
  const files: File[] = [];

  for (const pageNum of pagesToRender) {
    const page = await pdf.getPage(pageNum);
    const unscaled = page.getViewport({ scale: 1.0 });

    // Financial reports are typically standard 72 DPI letter/A4 (~612x792 pt).
    // Scale up to 2.0x for crisp text, capped at MAX_IMAGE_EDGE (1568px).
    const longest = Math.max(unscaled.width, unscaled.height);
    const scale = Math.min(2.0, MAX_IMAGE_EDGE / Math.max(1, longest));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(`Failed to create 2D canvas context for page ${pageNum}.`);
    }

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });

    if (!blob) {
      throw new Error(`Failed to export page ${pageNum} to PNG.`);
    }

    const pageFileName = `${base} (p. ${pageNum}).png`;
    files.push(new File([blob], pageFileName, { type: "image/png" }));
  }

  return files;
}
