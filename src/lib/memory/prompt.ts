import { maxMemoryChars } from "./store";

const headingRe = /^ {0,3}(#{1,6})\s/;

function headingLevel(line: string): number {
  return headingRe.exec(line)?.[1].length ?? 0;
}

/**
 * Drops a heading with nothing under it before the next heading of its level or higher, so the
 * template's empty sections cost no tokens and a file with no notes injects nothing.
 */
function withoutEmptySections(lines: string[]): string[] {
  return lines.filter((line, i) => {
    const level = headingLevel(line);
    if (level === 0) return true;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = headingLevel(lines[j]);
      if (next > 0 && next <= level) return false;
      if (next === 0 && lines[j].trim() !== "") return true;
    }
    return false;
  });
}

/**
 * memory.md as the system prompt carries it, or undefined when it holds no notes. The notes keep
 * the headings `memory_update` names sections by, inside a `<memory>` block so those headings never
 * read as the prompt's and the prompt text after them never reads as the user's notes. HTML
 * comments (the template's hints) are left out.
 */
export function memoryPromptBlock(memory: string | undefined): string | undefined {
  if (!memory) return undefined;
  const lines = memory
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .split("\n")
    .map((line) => line.trimEnd());
  // The file's own `# Memory` title only repeats the block's.
  const titled = lines.findIndex((line) => line.trim() !== "");
  if (titled !== -1 && /^ {0,3}#{1,6}\s+memory\s*$/i.test(lines[titled])) lines.splice(titled, 1);
  const text = withoutEmptySections(lines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    // A note cannot close the block early.
    .replace(/<\/memory>/gi, "</ memory>");
  if (!text) return undefined;
  const truncated = text.length > maxMemoryChars;
  return [
    "## Memory",
    "",
    "Durable notes about the user from memory.md, kept with memory_update:",
    "",
    "<memory>",
    truncated ? text.slice(0, maxMemoryChars) : text,
    "</memory>",
    ...(truncated ? ["(Memory was truncated because it exceeded the size limit. Ask the user to prune memory.md.)"] : []),
  ].join("\n");
}
