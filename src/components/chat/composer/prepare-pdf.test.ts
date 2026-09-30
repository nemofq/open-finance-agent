import { describe, expect, it } from "vitest";
import { renderPdfToImageFiles } from "./prepare-pdf";

describe("renderPdfToImageFiles", () => {
  it("rejects when run outside a browser environment", async () => {
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });
    await expect(renderPdfToImageFiles(file, [1])).rejects.toThrow(
      "PDF rendering is only supported in browser environments.",
    );
  });
});
