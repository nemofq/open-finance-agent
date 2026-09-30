/**
 * HTML attachments, and the html → Markdown conversion `docx.ts` reuses.
 *
 * `rehype-parse` is the tolerant parser a browser uses, so malformed markup never throws; it yields
 * a tree. That tree is cleaned before `rehype-remark` sees it: chrome elements go, because the text
 * of a `<nav>` or a `<script>` is navigation and code rather than the document. `remark-gfm` is
 * what keeps tables as tables on the way out — without it a table is flattened into paragraphs.
 */

import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import type { ParsedAttachment } from "../types";
import { decodeText, documentParse } from "./text";

/** Elements whose text is chrome or code, never document content. */
const DROPPED = new Set(["head", "script", "style", "noscript", "nav", "iframe"]);

const ROW_GROUPS = new Set(["thead", "tbody", "tfoot"]);

/** The slice of a hast node this module touches; `@types/hast` is not a dependency. */
interface HastNode {
  type: string;
  tagName?: string;
  children?: HastNode[];
}

function elements(node: HastNode, tagName: string): HastNode[] {
  return (node.children ?? []).filter((child) => child.type === "element" && child.tagName === tagName);
}

/** Every `tr` of a table, whether or not the parser put it inside an implied `tbody`. */
function tableRows(table: HastNode): HastNode[] {
  const groups = (table.children ?? []).flatMap((child) =>
    child.type === "element" && ROW_GROUPS.has(child.tagName ?? "") ? [child] : [],
  );
  return [table, ...groups].flatMap((parent) => elements(parent, "tr"));
}

/**
 * A GFM table always has a header row, so a table without one is serialised with an empty header
 * and its real headings pushed into the body. Word tables mark headings by style, not by `th`, so
 * this is the common case: the first row is promoted instead.
 */
function promoteHeaderRow(table: HastNode): void {
  const rows = tableRows(table);
  const [first] = rows;
  if (!first || rows.some((row) => elements(row, "th").length > 0)) return;
  for (const cell of elements(first, "td")) cell.tagName = "th";
}

function cleanTree() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (!node.children) return;
      node.children = node.children.filter((child) => !(child.type === "element" && DROPPED.has(child.tagName ?? "")));
      if (node.tagName === "table") promoteHeaderRow(node);
      node.children.forEach(walk);
    };
    walk(tree);
  };
}

const processor = unified()
  .use(rehypeParse)
  .use(cleanTree)
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", fences: true, rule: "-" });

export async function htmlToMarkdown(html: string): Promise<string> {
  return String(await processor.process(html)).trim();
}

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  const decoded = decodeText(bytes);
  return documentParse(name, await htmlToMarkdown(decoded.text), { warnings: decoded.warnings });
}
