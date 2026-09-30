/**
 * pptx → one Markdown part per slide.
 *
 * A pptx is a zip of XML parts. `ppt/presentation.xml` lists the slides in presentation order by
 * relationship id, which `ppt/_rels/presentation.xml.rels` resolves to the slide parts; the file
 * names carry no order of their own. Each slide gives its title, its bullets at the outline level
 * PowerPoint recorded, its tables as GFM, and the speaker notes from the matching notes slide.
 *
 * The file is untrusted, so the parser never expands an entity and the zip's entry count and
 * declared decompressed size are checked before a single entry is unpacked.
 */
import { XMLParser } from "fast-xml-parser";
import type JSZip from "jszip";
import { MAX_TEXT_CHARS } from "../limits";
import type { AttachmentOutlineEntry, AttachmentPart, ParsedAttachment } from "../types";
import { count, errorMessage } from "../wording";
import { inspectZip, ZipTooLarge } from "../zip";
import { textBudget } from "./text";

/* ------------------------------------------------------------- xml */

/** One element of the parser's output: its tag maps to the children, `:@` to the attributes. */
type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseTagValue: false,
  // Document order is the reading order: bullets and tables interleave inside one slide.
  preserveOrder: true,
  // A DOCTYPE entity is never expanded; `decodeXml` below decodes the predefined ones instead.
  processEntities: false,
  // Runs carry their own spacing — "Total " + "revenue" is one line in two runs.
  trimValues: false,
});

function tagOf(node: XmlNode): string {
  for (const key of Object.keys(node)) if (key !== ":@") return key;
  return "";
}

function childrenOf(node: XmlNode): XmlNode[] {
  const children = node[tagOf(node)];
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

function attrOf(node: XmlNode, name: string): string | undefined {
  return (node[":@"] as Record<string, string> | undefined)?.[`@_${name}`];
}

function firstOf(nodes: XmlNode[], tag: string): XmlNode | undefined {
  return nodes.find((node) => tagOf(node) === tag);
}

function allOf(nodes: XmlNode[], tag: string): XmlNode[] {
  return nodes.filter((node) => tagOf(node) === tag);
}

/** Every element with this tag at any depth, in document order. */
function deepOf(nodes: XmlNode[], tag: string): XmlNode[] {
  const found: XmlNode[] = [];
  for (const node of nodes) {
    if (tagOf(node) === tag) found.push(node);
    else found.push(...deepOf(childrenOf(node), tag));
  }
  return found;
}

const PREDEFINED: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };

/**
 * The five predefined entities and numeric character references, and nothing else: the parser runs
 * with entity processing off, so an `&xxe;` declared in a DOCTYPE stays the five characters the
 * file actually contains.
 */
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, reference: string) => {
    if (!reference.startsWith("#")) return PREDEFINED[reference.toLowerCase()] ?? entity;
    const hex = reference.startsWith("#x") || reference.startsWith("#X");
    const code = hex ? Number.parseInt(reference.slice(2), 16) : Number(reference.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** The text of every run under these nodes, with a line break counting as a space. */
function textOf(nodes: XmlNode[]): string {
  let text = "";
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "a:br") text += " ";
    else if (tag !== "a:t") text += textOf(childrenOf(node));
    else {
      for (const child of childrenOf(node)) {
        if (typeof child["#text"] === "string") text += child["#text"];
      }
    }
  }
  return text;
}

/* ------------------------------------------------------------- slides */

interface Bullet {
  /** `a:pPr/@lvl`: 0 is the outermost level. */
  level: number;
  text: string;
}

/** The paragraphs of one text body, blank ones dropped. */
function bulletsOf(txBody: XmlNode): Bullet[] {
  return allOf(childrenOf(txBody), "a:p")
    .map((paragraph) => {
      const properties = firstOf(childrenOf(paragraph), "a:pPr");
      const level = Number(properties && attrOf(properties, "lvl"));
      return {
        level: Number.isInteger(level) && level > 0 ? level : 0,
        text: decodeXml(textOf(childrenOf(paragraph))).replace(/\s+/g, " ").trim(),
      };
    })
    .filter((bullet) => bullet.text.length > 0);
}

/** Placeholders whose text is furniture the reader already has, or an image frame with no text. */
const FURNITURE = new Set(["dt", "ftr", "sldImg", "sldNum"]);
const TITLES = new Set(["ctrTitle", "title"]);

/** The placeholder a shape fills, if any; a `p:ph` without a type is a body placeholder. */
function placeholderOf(shape: XmlNode): string | undefined {
  const nvSpPr = firstOf(childrenOf(shape), "p:nvSpPr");
  const nvPr = nvSpPr && firstOf(childrenOf(nvSpPr), "p:nvPr");
  const placeholder = nvPr && firstOf(childrenOf(nvPr), "p:ph");
  return placeholder ? (attrOf(placeholder, "type") ?? "body") : undefined;
}

/** `a:tbl` as a GFM table. The first row becomes the header, which GFM requires one of. */
function tableOf(table: XmlNode): string {
  const rows = allOf(childrenOf(table), "a:tr").map((row) =>
    allOf(childrenOf(row), "a:tc").map((cell) => {
      const txBody = firstOf(childrenOf(cell), "a:txBody");
      const text = txBody ? bulletsOf(txBody).map((bullet) => bullet.text).join(" ") : "";
      return text.replace(/\|/g, "\\|");
    }),
  );
  const [header, ...body] = rows;
  if (!header) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, column) => cells[column] ?? "").join(" | ")} |`;
  const rule = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  return [line(header), rule, ...body.map(line)].join("\n");
}

interface Slide {
  title: string;
  blocks: string[];
}

/** Walks a shape tree in document order; groups are flattened into their parent's sequence. */
function collect(nodes: XmlNode[], slide: Slide): void {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "p:grpSp") {
      collect(childrenOf(node), slide);
      continue;
    }
    if (tag === "p:graphicFrame") {
      for (const table of deepOf(childrenOf(node), "a:tbl")) {
        const markdown = tableOf(table);
        if (markdown) slide.blocks.push(markdown);
      }
      continue;
    }
    if (tag !== "p:sp") continue;
    const placeholder = placeholderOf(node);
    if (placeholder && FURNITURE.has(placeholder)) continue;
    const txBody = firstOf(childrenOf(node), "p:txBody");
    const bullets = txBody ? bulletsOf(txBody) : [];
    if (bullets.length === 0) continue;
    if (placeholder && TITLES.has(placeholder) && !slide.title) {
      slide.title = bullets.map((bullet) => bullet.text).join(" ");
      continue;
    }
    slide.blocks.push(
      bullets.map((bullet) => `${"  ".repeat(Math.min(bullet.level, 8))}- ${bullet.text}`).join("\n"),
    );
  }
}

/** The notes slide's own text, without the thumbnail of the slide it annotates. */
function notesOf(root: XmlNode[]): string {
  const paragraphs: string[] = [];
  for (const shape of shapeTreeOf(root)) {
    if (tagOf(shape) !== "p:sp") continue;
    const placeholder = placeholderOf(shape);
    if (placeholder && FURNITURE.has(placeholder)) continue;
    const txBody = firstOf(childrenOf(shape), "p:txBody");
    if (txBody) paragraphs.push(...bulletsOf(txBody).map((bullet) => bullet.text));
  }
  return paragraphs.join("\n\n");
}

/** `p:sld/p:cSld/p:spTree`, the shapes of a slide or a notes slide. */
function shapeTreeOf(root: XmlNode[]): XmlNode[] {
  const tree = deepOf(root, "p:spTree")[0];
  return tree ? childrenOf(tree) : [];
}

/* ------------------------------------------------------------- package */

async function readXml(zip: JSZip, path: string): Promise<XmlNode[] | undefined> {
  const entry = zip.file(path);
  if (!entry) return undefined;
  return parser.parse(await entry.async("string")) as XmlNode[];
}

/** A relationship target is relative to the directory of the part that declares it. */
function resolvePath(directory: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = directory.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  }
  return segments.join("/");
}

/** `<dir>/_rels/<file>.rels` as relationship id → part path from the zip root. */
async function relsOf(zip: JSZip, part: string): Promise<Map<string, string>> {
  const slash = part.lastIndexOf("/");
  const directory = part.slice(0, Math.max(slash, 0));
  const root = await readXml(zip, `${directory}/_rels/${part.slice(slash + 1)}.rels`);
  const rels = new Map<string, string>();
  for (const relationship of deepOf(root ?? [], "Relationship")) {
    const id = attrOf(relationship, "Id");
    const target = attrOf(relationship, "Target");
    if (id && target && attrOf(relationship, "TargetMode") !== "External") {
      rels.set(id, resolvePath(directory, target));
    }
  }
  return rels;
}

/** The slide parts in presentation order, falling back to the file names when the list is gone. */
async function slidePathsOf(zip: JSZip): Promise<string[]> {
  const presentation = await readXml(zip, "ppt/presentation.xml");
  const rels = await relsOf(zip, "ppt/presentation.xml");
  const paths = deepOf(presentation ?? [], "p:sldId")
    .map((slide) => rels.get(attrOf(slide, "r:id") ?? ""))
    .filter((path): path is string => Boolean(path));
  if (paths.length > 0) return paths;
  return Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));
}

/**
 * The zip caps are enforced from the central directory before anything is unpacked. An encrypted
 * pptx is an OLE2 file, not a zip, and `sniff` refuses it by name before it gets here.
 */
async function open(bytes: Uint8Array, name: string): Promise<JSZip> {
  try {
    return await inspectZip(bytes, name);
  } catch (cause) {
    if (cause instanceof ZipTooLarge) throw cause;
    throw new Error(`${name} is not a readable .pptx file.`, { cause });
  }
}

/* ------------------------------------------------------------- parse */

/**
 * One slide. The markdown never names the slide: `markdownOf` puts the part's own label above it,
 * and a slide that said `## Slide 3` as well would say it twice. The title is the slide's heading,
 * and a slide without one opens on its bullets.
 */
async function slideOf(zip: JSZip, path: string): Promise<{ title: string; markdown: string }> {
  const root = (await readXml(zip, path)) ?? [];
  const slide: Slide = { blocks: [], title: "" };
  collect(shapeTreeOf(root), slide);

  const notesPath = [...(await relsOf(zip, path)).values()].find((target) =>
    target.startsWith("ppt/notesSlides/"),
  );
  const notes = notesPath ? notesOf((await readXml(zip, notesPath)) ?? []) : "";

  const blocks = slide.title ? [`## ${slide.title}`, ...slide.blocks] : [...slide.blocks];
  if (notes) blocks.push(`### Notes\n\n${notes}`);
  return { markdown: blocks.join("\n\n"), title: slide.title };
}

export async function parse(bytes: Uint8Array, name: string): Promise<ParsedAttachment> {
  const zip = await open(bytes, name);

  let paths: string[];
  try {
    paths = await slidePathsOf(zip);
  } catch (cause) {
    throw new Error(`${name} is not a readable .pptx file.`, { cause });
  }
  // A zip with no presentation in it is some other format wearing the extension.
  if (paths.length === 0 && !zip.file("ppt/presentation.xml")) {
    throw new Error(`${name} is not a readable .pptx file.`);
  }

  const parts: AttachmentPart[] = [];
  const outline: AttachmentOutlineEntry[] = [];
  const warnings: string[] = [];
  const budget = textBudget();

  for (const [index, path] of paths.entries()) {
    const number = index + 1;
    let slide: { title: string; markdown: string };
    try {
      slide = await slideOf(zip, path);
    } catch (error) {
      warnings.push(`Slide ${number} could not be read (${errorMessage(error)}).`);
      continue;
    }
    const { text, cut, spent } = budget(slide.markdown);
    // A slide after the cap is used up is not a part; one cut short still is.
    if (!spent) {
      parts.push({ label: `Slide ${number}`, markdown: text, type: "text" });
      outline.push({ level: 1, part: parts.length - 1, title: slide.title || `Slide ${number}` });
    }
    if (cut) {
      warnings.push(
        `Stopped at slide ${number} of ${paths.length}, at the ${count(MAX_TEXT_CHARS)}-character cap.`,
      );
      return { kind: "document", outline, parts, truncated: true, version: 1, warnings };
    }
  }

  if (paths.length === 0) warnings.push(`${name} has no slides.`);
  return { kind: "document", outline, parts, version: 1, warnings };
}
