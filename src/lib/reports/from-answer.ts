import type { ReportSpec } from "./spec";

/**
 * A spec built from an answer the model wrote in chat: headings open sections, pipe tables become
 * tables, bullet runs become lists, everything else is prose. Plain but complete, so a turn that
 * promised a report and ended without one still delivers the analysis as a document.
 */
export function specFromAnswer(answer: string, fallbackTitle: string): ReportSpec {
  type Section = ReportSpec["sections"][number];
  const sections: Section[] = [];
  let title: string | undefined;
  let current: Section | undefined;
  const open = (heading: string): Section => { current = { heading, blocks: [] }; sections.push(current); return current; };
  const blocks = () => (current ?? open("Summary")).blocks;
  const lines = answer.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      if (!title && sections.length === 0) title = heading[1]; else open(heading[1]);
      i += 1; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
        i += 1;
      }
      if (rows.length > 0) blocks().push({ type: "table", columns: rows[0], rows: rows.slice(1) });
      continue;
    }
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()); i += 1; }
      blocks().push({ type: "list", items });
      continue;
    }
    if (line.trim() === "") { i += 1; continue; }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s{0,3}#{1,6}\s|^\s*\|.*\|\s*$|^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[i])) { paragraph.push(lines[i].trim()); i += 1; }
    blocks().push({ type: "text", text: paragraph.join(" ") });
  }
  if (sections.length === 0) open("Summary");
  return { title: title ?? fallbackTitle, format: "doc", sections };
}
