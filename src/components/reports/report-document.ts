/**
 * Host side of the report contract: skills emit HTML that reads its colours from
 * `--report-*` variables (with its own fallbacks), and the panel supplies the values
 * for the theme the app is currently in.
 */

import { reportStyles } from "@/lib/reports/render/theme";

export type ReportTheme = "light" | "dark";

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  surface: string;
  accent: string;
  positive: string;
  negative: string;
}

/** Taken from the app palette in `globals.css`, plus a restrained green/red pair. */
const PALETTES: Record<ReportTheme, Palette> = {
  light: {
    bg: "oklch(1 0 0)",
    fg: "oklch(0.145 0 0)",
    muted: "oklch(0.556 0 0)",
    border: "oklch(0.922 0 0)",
    surface: "oklch(0.97 0 0)",
    accent: "oklch(0.205 0 0)",
    positive: "oklch(0.55 0.15 150)",
    negative: "oklch(0.6 0.2 25)",
  },
  dark: {
    bg: "oklch(0.145 0 0)",
    fg: "oklch(0.985 0 0)",
    muted: "oklch(0.708 0 0)",
    // A touch stronger than the app's 10% border: the iframe has no other depth cues.
    border: "oklch(1 0 0 / 14%)",
    surface: "oklch(0.205 0 0)",
    accent: "oklch(0.922 0 0)",
    positive: "oklch(0.72 0.14 150)",
    negative: "oklch(0.72 0.17 25)",
  },
};

const FONT_STACK =
  '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, "Noto Sans", "Liberation Sans", sans-serif';

/**
 * Base rules use `:where()` so they carry no specificity: the report's own styles,
 * which may be parsed before this block, still win. The current report stylesheet then follows,
 * so a report saved with an older layout takes the latest one when shown here; the stored HTML
 * itself stays as it was, which is what a download gets.
 */
function styleBlock(theme: ReportTheme): string {
  const palette = PALETTES[theme];
  return `<style>
:root {
  color-scheme: ${theme};
  --report-bg: ${palette.bg};
  --report-fg: ${palette.fg};
  --report-muted: ${palette.muted};
  --report-border: ${palette.border};
  --report-surface: ${palette.surface};
  --report-accent: ${palette.accent};
  --report-positive: ${palette.positive};
  --report-negative: ${palette.negative};
}
:where(html) { background: var(--report-bg); }
:where(body) {
  margin: 0;
  padding: 1.25rem;
  background: var(--report-bg);
  color: var(--report-fg);
  font-family: ${FONT_STACK};
  font-size: 14px;
  line-height: 1.6;
}
:where(img, svg, table) { max-width: 100%; }
</style>${reportStyles()}`;
}

/**
 * How the panel is showing the report: a document scrolls as one page, a deck shows
 * one slide at a time (the iframe runs no scripts, so the host pages by re-rendering),
 * and `print` lays every slide out for a new tab or the printer.
 */
export type ReportView =
  | { format: "doc" }
  | { format: "slides"; slide: number }
  | { format: "slides"; print: true };

/** Viewport-relative, so a slide keeps its proportions in the panel and full screen alike. */
const SLIDE_PADDING = "6vmin 8vmin";

/**
 * Slide layout, appended after the theme block so it outranks the report's own rules
 * on ties. Plain selectors on purpose: the deck's chrome is the host's call, not the
 * report's.
 */
function viewBlock(view: ReportView): string {
  if (view.format !== "slides") return "";
  if ("print" in view) {
    return `<style>
body > section {
  min-height: 100vh;
  box-sizing: border-box;
  padding: ${SLIDE_PADDING};
  page-break-after: always;
  border-bottom: 1px solid var(--report-border);
}
</style>`;
  }
  return `<style>
html, body { height: 100%; margin: 0; overflow: hidden; }
body > section {
  display: none;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: ${SLIDE_PADDING};
}
body > section:nth-of-type(${view.slide}) { display: block; }
</style>`;
}

/**
 * How many slides the deck has. The contract is one `<section>` per slide directly
 * inside `<body>` and never nested, so counting the opening tags is exact.
 */
export function countSlides(html: string): number {
  return html.match(/<section[\s/>]/gi)?.length ?? 0;
}

const HEAD_END = /<\/head\s*>/i;

/**
 * Build the `srcdoc` for the report iframe: the theme's variables go right before
 * `</head>` when the report is a whole document, and a fragment is wrapped in a
 * minimal one.
 */
export function reportSrcDoc(html: string, theme: ReportTheme, view: ReportView = { format: "doc" }): string {
  const style = styleBlock(theme) + viewBlock(view);
  const match = HEAD_END.exec(html);
  if (match) {
    return `${html.slice(0, match.index)}${style}${html.slice(match.index)}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}
