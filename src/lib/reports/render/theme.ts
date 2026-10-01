/**
 * The report stylesheet. Every colour comes from a `--report-*` variable the panel injects for
 * the user's theme, each with a literal fallback so the same HTML also prints and opens in a
 * plain tab. One sheet serves both formats: the slide rules only apply inside `.deck`.
 */

const PALETTE = `:root{
  --bg:var(--report-bg,#ffffff);
  --fg:var(--report-fg,#111111);
  --muted:var(--report-muted,#666666);
  --border:var(--report-border,#dddddd);
  --surface:var(--report-surface,#f7f7f8);
  --accent:var(--report-accent,#0b66c3);
  --pos:var(--report-positive,#0a7a45);
  --neg:var(--report-negative,#c0392b);
}`;

const BASE = `*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Helvetica,Arial,"Noto Sans","Liberation Sans",sans-serif;font-size:15px;line-height:1.55}
h1{font-size:1.5rem;margin:0 0 .35rem;letter-spacing:-.01em}
h2{font-size:1.15rem;margin:1.75rem 0 .6rem}
h3{font-size:1rem;margin:1.1rem 0 .4rem}
p{margin:.6rem 0}
ul,ol{margin:.6rem 0;padding-left:1.2rem}
li{margin:.25rem 0}
.lede{color:var(--muted);margin:0 0 .25rem}
/* The panel can be as narrow as a phone. Nothing may widen the page: a long word or URL breaks
   wherever it must, and a box never outgrows its column. */
h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,figcaption,caption,.lede,.callout{overflow-wrap:anywhere}
/* Not "anywhere" in a cell: it would let the table squeeze a label column to one letter a line.
   "break-word" keeps each word whole when sizing the columns and only breaks one too long to fit. */
th,td{overflow-wrap:break-word}
div,figure,blockquote,pre{max-width:100%}
img,svg,video{max-width:100%;height:auto}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
code{overflow-wrap:anywhere}
.fig{white-space:nowrap}
/* In a cell or a KPI a figure may wrap at its spaces ("USD 2.22" over "per share"); its marker has no
   space before it, so it stays on the last word. Digits in a table never split. */
td .fig{white-space:normal;overflow-wrap:normal}
.num{overflow-wrap:normal}
.kpi .fig{white-space:normal}
.src{position:relative;margin-left:.15em;font-size:.7em;color:var(--muted);font-weight:500;cursor:help;text-decoration:underline dotted;text-underline-offset:.15em}
.origin{position:absolute;z-index:10;top:calc(100% + .35rem);left:0;display:none;box-sizing:border-box;min-width:min(16rem,calc(100vw - 2rem));max-width:min(24rem,calc(100vw - 2rem));max-height:13rem;overflow:auto;padding:.5rem .6rem;border:1px solid var(--border);border-radius:.4rem;background:var(--surface);box-shadow:0 2px 10px rgb(0 0 0 / 14%);color:var(--fg);font-size:12px;font-weight:400;line-height:1.45;letter-spacing:normal;text-align:left;text-transform:none;white-space:normal}
.src:hover .origin,.src:focus-within .origin{display:block}
.origin span{display:block}
.origin-head{color:var(--muted)}
.origin-value{font-weight:600}
.origin-formula{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-word}
.origin-note{color:var(--muted)}
/* Near the right edge the box would run off the page, so it hangs from the other corner. */
td:last-child .origin,th:last-child .origin,.kpi:last-child .origin{left:auto;right:0}
/* Nothing between a marker and the page may clip its popover. */
table,thead,tbody,tr,th,td,.kpi,.callout{overflow:visible}
.note{color:var(--muted);font-size:.85em;margin-left:.35em}
table{border-collapse:collapse;width:100%;margin:.6rem 0;font-variant-numeric:tabular-nums}
th,td{padding:.4rem .6rem;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.85em;text-transform:uppercase;letter-spacing:.03em}
/* A column that holds only figures is read down the page, so it is set against its right edge. */
.num{text-align:right}
table.key tbody td{font-weight:600}
table.key tbody td:first-child{font-weight:500}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(11rem,100%),1fr));gap:.6rem;margin:.7rem 0}
.kpi{min-width:0;border:1px solid var(--border);border-radius:.5rem;padding:.6rem .75rem;background:var(--surface)}
.kpi-label{display:block;color:var(--muted);font-size:.8em;text-transform:uppercase;letter-spacing:.03em}
.kpi-value{display:block;font-size:1.15rem;font-weight:600;margin-top:.15rem}
.kpi-label,.kpi-value{overflow-wrap:anywhere}
/* A note on a KPI is a caption, not part of the figure: it drops to its own line under it. */
.kpi-value .note{display:block;margin-top:.2rem;margin-left:0;font-size:.8rem;font-weight:400}
.callout{border:1px solid var(--border);border-left-width:3px;border-radius:.4rem;background:var(--surface);padding:.7rem .9rem;margin:.8rem 0}
.callout-positive{border-left-color:var(--pos)}
.callout-negative{border-left-color:var(--neg)}
.callout-neutral{border-left-color:var(--accent)}
/* The chart is HTML around one stretched SVG: the gutter holds the y labels, the row under the
   plot holds the x labels, and neither they nor the strokes grow with the column. */
.chart{margin:.9rem 0 1.1rem;padding-left:3.5rem}
.plot{position:relative;height:clamp(160px,26vw,280px)}
.plot svg{display:block;width:100%;height:100%;overflow:visible}
.ytick{position:absolute;left:-3.5rem;width:3.25rem;transform:translateY(-50%);color:var(--muted);font-size:12px;line-height:1;text-align:right;white-space:nowrap}
.xaxis{display:flex;margin-top:.4rem}
.xaxis span{flex:1 1 0;min-width:0;overflow:hidden;color:var(--muted);font-size:12px;text-align:center;text-overflow:ellipsis;white-space:nowrap}
.chart-legend{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.9rem;color:var(--muted);font-size:12px;margin-bottom:.35rem}
.swatch{display:inline-block;width:.6em;height:.6em;border-radius:2px;margin-right:.3em}
.generated li{margin:.3rem 0;color:var(--fg)}
.generated .meta{color:var(--muted)}
.disclaimer{color:var(--muted);font-size:.85em;border-top:1px solid var(--border);margin-top:1.5rem;padding-top:.7rem}
/* A narrow column gives its width to the figures, not the gutters. */
@media (max-width:48rem){th,td{padding:.35rem .4rem}th{letter-spacing:0}}`;

/**
 * The document fills whatever frame it is given — a table, KPI row, chart or callout is worth the
 * whole width — and only running prose is held to a readable measure.
 */
const DOC = `.doc{padding:clamp(1rem,3vw,2.5rem)}
/* Stated, not just absent: a report saved with the old 80ch cap keeps its own sheet, and the panel lays this one over it. */
.doc p,.doc li,.doc .lede{max-width:none}
.doc section{margin-bottom:.5rem}
.doc .callout p{margin:0}
/* The last resort, for a table whose figures still do not fit once every cell has wrapped. It
   only scrolls where it has to: the scroller would clip the origin popovers above it. */
@media (max-width:48rem){.doc table{display:block;overflow-x:auto}}`;

const SLIDES = `.deck{padding:0}
.deck section{box-sizing:border-box;padding:6vmin 8vmin;container-type:inline-size}
/* A slide's padding grows with the screen, so the table falls back to scrolling by the room
   left inside the slide rather than by the width of the window. */
@container (max-width:48rem){.deck table{display:block;overflow-x:auto}}
.deck section h1{font-size:2rem}
.deck section h2{font-size:1.5rem;margin:0 0 .8rem}
.deck .title-slide{display:flex;flex-direction:column;justify-content:center;min-height:60vh}
.deck .title-slide .lede{font-size:1.05rem}
.deck .slide-note{color:var(--muted);font-size:.85em;margin-top:.6rem}`;

/** Sections start a page, and nothing that reads as one unit is split across two. */
const PRINT = `@media print{
  body{padding:0;background:#fff}
  .doc{padding:1.5rem}
  .doc > section{break-inside:avoid;page-break-inside:avoid}
  .doc > section + section{break-before:page;page-break-before:always}
  .deck section{min-height:100vh;break-after:page;page-break-after:always}
  h2{break-after:avoid;page-break-after:avoid}
  table,.kpis,.callout,.chart{break-inside:avoid;page-break-inside:avoid}
  /* Paper cannot scroll, so a table that would have become a scroller on a narrow page wraps instead. */
  .doc table,.deck table{display:table;overflow:visible}
  .src{color:#666;text-decoration:none}
  .origin{display:none!important}
}`;

/** The single `<style>` block every rendered report carries. */
export function reportStyles(): string {
  return `<style>\n${PALETTE}\n${BASE}\n${DOC}\n${SLIDES}\n${PRINT}\n</style>`;
}
