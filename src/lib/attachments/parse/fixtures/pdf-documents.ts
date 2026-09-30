/**
 * Minimal PDFs written by hand, so the fixtures stay readable source instead of committed binaries.
 * They carry only what the parser looks at: a page tree, one uncompressed content stream per page,
 * an optional outline, and an optional security handler for the password-protected case.
 */

/** One `Tj` at an absolute position on the page; the y axis grows upwards, as PDF's does. */
interface PdfRun {
  x: number;
  y: number;
  text: string;
  /** Font size in points. Defaults to 12. */
  size?: number;
}

export interface PdfPage {
  /** A page with no runs has no text layer at all: what a scanned page looks like to pdf.js. */
  runs: PdfRun[];
}

interface PdfOutlineItem {
  title: string;
  /** 1-based page number the entry opens. */
  page: number;
}

export interface PdfSpec {
  pages: PdfPage[];
  outline?: PdfOutlineItem[];
  /**
   * The page box in points; letter size by default. pdf.js drops the glyphs that fall off the
   * page, so a fixture with a long line needs a page wide enough to hold it.
   */
  width?: number;
  height?: number;
  /**
   * Adds a standard security handler whose user password check cannot succeed, which is what a
   * password-protected file looks like before the password is known.
   */
  encrypted?: boolean;
}

/** `(` , `)` and `\` end or escape a PDF string literal. */
function escape(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

function stream(contents: string): string {
  return `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`;
}

function contentOf(page: PdfPage): string {
  return page.runs
    .map((run) => `BT /F1 ${run.size ?? 12} Tf ${run.x} ${run.y} Td (${escape(run.text)}) Tj ET`)
    .join("\n");
}

export function buildPdf(spec: PdfSpec): Uint8Array {
  const { encrypted = false, height = 792, outline = [], pages, width = 612 } = spec;
  const pageNumber = (index: number) => 4 + index * 2;
  const outlineRoot = 4 + pages.length * 2;
  const outlineItem = (index: number) => outlineRoot + 1 + index;
  const encryptNumber = outlineRoot + (outline.length > 0 ? outline.length + 1 : 0);

  const objects: string[] = [];
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${outline.length > 0 ? ` /Outlines ${outlineRoot} 0 R` : ""} >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageNumber(index)} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((page, index) => {
    objects[pageNumber(index) - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNumber(index) + 1} 0 R >>`;
    objects[pageNumber(index)] = stream(contentOf(page));
  });
  if (outline.length > 0) {
    objects[outlineRoot - 1] =
      `<< /Type /Outlines /First ${outlineItem(0)} 0 R /Last ${outlineItem(outline.length - 1)} 0 R /Count ${outline.length} >>`;
    outline.forEach((item, index) => {
      const siblings = [
        index > 0 ? `/Prev ${outlineItem(index - 1)} 0 R` : "",
        index < outline.length - 1 ? `/Next ${outlineItem(index + 1)} 0 R` : "",
      ].join(" ");
      objects[outlineItem(index) - 1] =
        `<< /Title (${escape(item.title)}) /Parent ${outlineRoot} 0 R ${siblings} /Dest [${pageNumber(item.page - 1)} 0 R /Fit] >>`;
    });
  }
  if (encrypted) {
    const digest = (byte: string) => byte.repeat(64);
    objects[encryptNumber - 1] =
      `<< /Filter /Standard /V 1 /R 2 /O <${digest("2")}> /U <${digest("1")}> /P -1 >>`;
  }

  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const id = "<0102030405060708090a0b0c0d0e0f10>";
  const trailer = encrypted ? ` /Encrypt ${encryptNumber} 0 R /ID [${id} ${id}]` : "";
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailer} >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
