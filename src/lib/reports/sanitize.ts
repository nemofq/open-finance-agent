/**
 * The `html` block lets a skill lay out something the other blocks cannot, but it lands in the
 * same scriptless iframe as the rest of the report. Everything outside the allowlist is dropped
 * here rather than rejected, so one stray tag does not cost the model a whole retry.
 */

/**
 * `h1`, `h2` and `section` are deliberately absent: the renderer owns the report title, the
 * section headings, and — in slides — the one-`<section>`-per-slide contract the panel pages by.
 */
const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "strong", "b", "em", "i", "u", "s", "small", "sup", "sub", "span", "div", "code", "pre",
  "blockquote", "figure", "figcaption", "mark", "abbr",
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "desc",
]);

/** Tags whose content is dropped with them: markup that would escape the block entirely. */
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "head", "title"]);

const GLOBAL_ATTRIBUTES = new Set(["class", "title", "colspan", "rowspan", "scope", "role", "aria-hidden", "aria-label"]);

/** The SVG elements, which alone may carry geometry: on an HTML tag a `width` would size the box. */
const SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "desc",
]);

const SVG_ATTRIBUTES = new Set([
  "viewbox", "preserveaspectratio", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-opacity", "stroke", "stroke-width",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "text-anchor", "dominant-baseline",
  "transform", "opacity", "font-size", "font-weight", "font-family",
]);

/** SVG attribute names are case-sensitive, unlike HTML's; these two must keep their capitals. */
const SVG_ATTRIBUTE_CASE: Record<string, string> = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
};

/**
 * A `style` attribute may set colours, emphasis and modest spacing, nothing that sizes, places or
 * unwraps a box: the report is read in a column as narrow as a phone, and a fixed width, a
 * `nowrap` or an absolute position there pushes the whole page sideways. Anything else is dropped
 * one declaration at a time, so the colours survive a stray `width`.
 */
const STYLE_PROPERTIES = new Set([
  "color", "background", "background-color", "font-weight", "font-style", "text-align", "text-decoration",
  "vertical-align",
]);

/** Borders, padding and margins, in any of their longhands. */
const SPACING_PROPERTY = /^(?:border|padding|margin)(?:-[a-z-]+)?$/;

/** A font size that follows the report's own: relative units only. */
const RELATIVE_SIZE = /^\d*\.?\d+(?:em|rem|%)$/;

/** A length in a value, never the digits of a hex colour or a name. */
const LENGTH = /(?<![\w#.-])(-?\d*\.?\d+)([a-z%]+)/gi;

/** Spacing past these is layout rather than spacing; so is spacing in viewport or print units. */
const MAX_SPACING: Record<string, number> = { px: 48, pt: 36, em: 3, rem: 3, "%": 5 };
const LAYOUT_UNITS = new Set(["vw", "vh", "vmin", "vmax", "dvw", "svw", "lvw", "ch", "ex", "cm", "mm", "in", "pc", "q"]);

/** Whatever the property, a style never fetches or executes anything. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:/i;

function spacingAllowed(value: string): boolean {
  for (const [, amount, rawUnit] of value.matchAll(LENGTH)) {
    const unit = rawUnit.toLowerCase();
    if (LAYOUT_UNITS.has(unit)) return false;
    const limit = MAX_SPACING[unit];
    if (limit !== undefined && Math.abs(Number(amount)) > limit) return false;
  }
  return true;
}

function declarationAllowed(property: string, value: string): boolean {
  if (value === "") return false;
  if (property === "font-size") return RELATIVE_SIZE.test(value);
  // A rounded corner sizes nothing, so `border-radius:50%` is as harmless as a colour.
  if (STYLE_PROPERTIES.has(property) || property === "border-radius") return true;
  return SPACING_PROPERTY.test(property) && spacingAllowed(value);
}

/** The declarations of a `style` value that pass the allowlist; `""` when none do. */
function sanitizeStyle(style: string): string {
  if (UNSAFE_STYLE.test(style)) return "";
  return style
    .split(";")
    .flatMap((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return [];
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      return declarationAllowed(property, value) ? [`${property}:${value}`] : [];
    })
    .join(";");
}

const TAG_START = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/;
const ATTRIBUTE_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;

function escapeText(text: string): string {
  return text.replace(/&(?![a-zA-Z#][a-zA-Z0-9]*;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attributeAllowed(tag: string, name: string): boolean {
  if (name.startsWith("on")) return false;
  if (GLOBAL_ATTRIBUTES.has(name)) return true;
  if (name === "style") return true;
  return SVG_ATTRIBUTES.has(name) && SVG_TAGS.has(tag);
}

function renderAttributes(tag: string, source: string): string {
  let out = "";
  for (const match of source.matchAll(ATTRIBUTE_RE)) {
    const name = match[1].toLowerCase();
    const raw = match[2] ?? match[3] ?? match[4] ?? "";
    if (!attributeAllowed(tag, name)) continue;
    const value = name === "style" ? sanitizeStyle(raw) : raw;
    if (name === "style" && value === "") continue;
    const written = SVG_ATTRIBUTE_CASE[name] ?? name;
    out += ` ${written}="${value.replace(/"/g, "&quot;")}"`;
  }
  return out;
}

/** Strip everything outside the allowlist from a model-supplied HTML block. */
export function sanitizeHtml(html: string): string {
  let out = "";
  let i = 0;

  while (i < html.length) {
    const next = html.indexOf("<", i);
    if (next === -1) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, next));

    if (html.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", next) || html.startsWith("<?", next)) {
      const end = html.indexOf(">", next);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const match = TAG_START.exec(html.slice(next));
    if (match === null) {
      out += "&lt;";
      i = next + 1;
      continue;
    }

    const end = html.indexOf(">", next);
    if (end === -1) {
      out += escapeText(html.slice(next));
      break;
    }

    const tag = match[1].toLowerCase();
    const closing = html[next + 1] === "/";
    const inner = html.slice(next + match[0].length, end).replace(/\/$/, "");

    if (DROP_WITH_CONTENT.has(tag)) {
      const closeAt = html.toLowerCase().indexOf(`</${tag}`, end);
      if (closing || closeAt === -1) {
        i = end + 1;
      } else {
        const closeEnd = html.indexOf(">", closeAt);
        i = closeEnd === -1 ? html.length : closeEnd + 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap rather than drop: the words inside are the model's analysis, the tag is not.
      i = end + 1;
      continue;
    }

    out += closing ? `</${tag}>` : `<${tag}${renderAttributes(tag, inner)}>`;
    i = end + 1;
  }

  return out;
}

/**
 * The words a sanitized block shows, with the markup taken out, for figure checking. `&amp;` is
 * decoded last, or the `&amp;lt;` a block shows as the text `&lt;` would decode twice into `<`.
 */
export function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
