/**
 * Draws the README's quality-against-cost chart, `docs/images/benchmark-quality-cost-{light,dark}.svg`,
 * from the README table: each row's name, thinking level, Total and cost. It also keeps two things in
 * the README in step with the rows' baselines, which evals/baselines/README.md names for each row:
 * every row's Total, Integrity and Judged, with the "−x capped" mark beside a Total for the points
 * critical caps took off it, the table's order by Total, and the chart's alt text.
 *
 *   node scripts/benchmark-chart.mjs
 *
 * Every point is labelled with its name, score and cost. Labels are placed around their point without
 * overlapping another label, point, the Pareto line or the legend; a label that has to sit away from
 * its point is tied to it by a leader line. Dependency-free ESM, Node >= 24.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// --- Data: the README table, and each row's baseline from the baselines doc.

const isRow = (line) => /^\| .+ avg@\d+ \|/.test(line);
const sections = [...read("evals/baselines/README.md").matchAll(/^## (.+?) avg@\d+(?:, (\w+))?\n\n\[`([^`]+\.json)`\]/gm)];

/**
 * A row's scores from its baseline: Total, Integrity and Judged as the table shows them, and the points
 * critical caps took off it (per answer, integrity plus judged score less total, averaged over all answers).
 */
function baselineScores(name, level) {
  const section = sections.find(([, title, sectionLevel]) => title === name && (!sectionLevel || sectionLevel === level));
  if (!section) throw new Error(`No baselines section for ${name} (${level})`);
  const { results, agentSummaries: [summary] } = JSON.parse(read(path.join("evals/baselines", section[3])));
  const lost = results.reduce((sum, r) => sum + (r.judgeResult ? Math.max(0, r.integrityScore + r.qualityScore - r.totalScore) : 0), 0);
  return { total: summary.expectedUserScore, integrity: summary.averageIntegrityScore, judged: summary.averageSemanticScore, capped: lost / results.length };
}

const rows = read("README.md").split("\n").filter(isRow).map((line) => {
  const [model, level, , , , , cost] = line.split("|").slice(1, -1).map((cell) => cell.trim());
  const name = model.replace(/ avg@\d+$/, ""), levelKey = level.toLowerCase();
  return { name, level: levelKey, cost: Number(cost.replace("$", "")), ...baselineScores(name, levelKey) };
});

// --- Geometry: cost on a log scale from $0.05 to $30, Total from 40 to 80.

const W = 1000, H = 680;
const plot = { left: 64, right: 968, top: 74, bottom: H - 64 };
const COST_MIN = 0.05, COST_MAX = 30, SCORE_MIN = 40, SCORE_MAX = 80;
const X = (cost) => plot.left + ((plot.right - plot.left) * Math.log(cost / COST_MIN)) / Math.log(COST_MAX / COST_MIN);
const Y = (score) => plot.bottom - ((plot.bottom - plot.top) * (score - SCORE_MIN)) / (SCORE_MAX - SCORE_MIN);
const money = (cost) => `$${cost.toFixed(2)}`;

const points = rows.map((row) => ({ ...row, x: X(row.cost), y: Y(row.total) }));

// The Pareto line: cheapest first, each row that scores above every cheaper one.
const pareto = [];
for (const point of [...points].sort((a, b) => a.cost - b.cost || b.total - a.total)) {
  if (pareto.length === 0 || point.total > pareto[pareto.length - 1].total) pareto.push(point);
}
for (const point of points) point.onPareto = pareto.includes(point);

// --- Labels. Text is measured with per-character advance widths for the system sans at 13 px
// semibold and 12 px regular, rounded up so a label never touches what it was placed beside.

const NARROW = new Set([..."iljtfrI.,:;'|!()[]· "]);
const WIDE = new Set([..."mwMW@%"]);
function textWidth(text, size, bold) {
  let em = 0;
  for (const ch of text) em += NARROW.has(ch) ? 0.32 : WIDE.has(ch) ? 0.86 : /[A-Z0-9$]/.test(ch) ? 0.64 : 0.56;
  return em * size * (bold ? 1.06 : 1) + 4;
}

const NAME_SIZE = 13, VALUE_SIZE = 12, LINE = 16;
for (const point of points) {
  // Most rows think at medium; a label names the level only where it differs, as the subtitle says.
  point.title = point.level === "medium" ? point.name : `${point.name} · ${point.level}`;
  point.value = `${point.total.toFixed(1)} · ${money(point.cost)}`;
  point.w = Math.max(textWidth(point.title, NAME_SIZE, true), textWidth(point.value, VALUE_SIZE, false));
  point.h = LINE * 2;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = (x, y, w, h) => ({ x, y, w, h });

// Everything a label must keep clear of: points, the Pareto line, the legend and the "better"
// note. Each is a box; the Pareto line is sampled along its segments.
const obstacles = [];
for (const point of points) obstacles.push(box(point.x - 9, point.y - 9, 18, 18));
for (let i = 1; i < pareto.length; i++) {
  const [a, b] = [pareto[i - 1], pareto[i]];
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    obstacles.push(box(a.x + (b.x - a.x) * t - 2, a.y + (b.y - a.y) * t - 2, 4, 4));
  }
}
const legend = box(812, 78, 156, 20);
const better = box(70, 78, 70, 20);
obstacles.push(legend, better);

// Candidate spots around a point: beside it (also nudged up or down), above and below it, and
// at its corners, each ring further out. Past the first ring a leader line ties the label back.
const SIDE_NUDGES = [0, -8, 8, -16, 16];
function* candidates(point) {
  for (let ring = 0; ring < 7; ring++) {
    const gap = 9 + ring * 12;
    for (const nudge of SIDE_NUDGES) {
      const y = point.y - point.h / 2 + nudge;
      yield { spot: box(point.x + gap, y, point.w, point.h), ring, cost: gap + Math.abs(nudge) * 0.5 };
      yield { spot: box(point.x - gap - point.w, y, point.w, point.h), ring, cost: gap + Math.abs(nudge) * 0.5 + 1 };
    }
    for (const dx of [0, -0.3, 0.3]) {
      const x = point.x - point.w / 2 + dx * point.w;
      yield { spot: box(x, point.y - gap - point.h + 2, point.w, point.h), ring, cost: gap + 3 + Math.abs(dx) * 10 };
      yield { spot: box(x, point.y + gap - 2, point.w, point.h), ring, cost: gap + 4 + Math.abs(dx) * 10 };
    }
    for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const x = sx > 0 ? point.x + gap * 0.7 : point.x - gap * 0.7 - point.w;
      const y = sy < 0 ? point.y - gap * 0.7 - point.h : point.y + gap * 0.7;
      yield { spot: box(x, y, point.w, point.h), ring, cost: gap + 6 };
    }
  }
}
const inside = (b) => b.x >= plot.left + 4 && b.x + b.w <= plot.right - 2 && b.y >= plot.top + 2 && b.y + b.h <= plot.bottom - 4;

/** Where a leader line from `point` meets `label`: the label's nearest edge. */
function leaderEnd(point, label) {
  return [Math.min(Math.max(point.x, label.x), label.x + label.w), Math.min(Math.max(point.y, label.y), label.y + label.h)];
}
/** A leader line as small boxes, so it can be tested against labels and points. */
function leaderBoxes(point, label) {
  const [lx, ly] = leaderEnd(point, label);
  const length = Math.hypot(lx - point.x, ly - point.y);
  const boxes = [];
  for (let d = 10; d < length - 2; d += 4) {
    const t = d / length;
    boxes.push(box(point.x + (lx - point.x) * t - 1.5, point.y + (ly - point.y) * t - 1.5, 3, 3));
  }
  return boxes;
}

/** Distance from a point to the nearest edge of a box; 0 inside it. */
const distanceTo = (point, b) => Math.hypot(Math.max(b.x - point.x, 0, point.x - b.x - b.w), Math.max(b.y - point.y, 0, point.y - b.y - b.h));

function layout(sequence) {
  const labels = [], leaders = [];
  let total = 0;
  const result = new Map();
  for (const point of sequence) {
    let chosen;
    for (const option of candidates(point)) {
      if (chosen && option.ring > chosen.ring) break;
      if (!inside(option.spot)) continue;
      if (obstacles.some((o) => overlaps(option.spot, o)) || labels.some((l) => overlaps(option.spot, l))) continue;
      if (leaders.some((l) => overlaps(option.spot, l))) continue;
      // A label beside its point must read as that point's: no other point may sit nearer to it.
      // A label further out has a leader line to say whose it is, and only keeps clear of others.
      const own = distanceTo(point, option.spot);
      const margin = option.ring === 0 ? own + 6 : 28;
      if (points.some((other) => other !== point && distanceTo(other, option.spot) < margin)) continue;
      const line = option.ring > 0 ? leaderBoxes(point, option.spot) : [];
      const isOwn = (o) => Math.abs(o.x + o.w / 2 - point.x) < 10 && Math.abs(o.y + o.h / 2 - point.y) < 10;
      if (line.some((segment) => labels.some((l) => overlaps(segment, l)) || obstacles.some((o) => !isOwn(o) && o.w <= 18 && overlaps(segment, o)))) continue;
      if (!chosen || option.cost < chosen.cost) chosen = { ...option, line };
    }
    if (!chosen) return undefined;
    labels.push(chosen.spot);
    leaders.push(...chosen.line);
    total += chosen.cost + (chosen.ring > 0 ? 40 + chosen.ring * chosen.ring * 12 : 0);
    result.set(point, chosen);
  }
  return { total, result };
}

// Greedy placement depends on the order labels are placed in, so try many orders and keep the
// layout with the shortest total distance and fewest leader lines. The orders are seeded, so the
// chart is the same on every run.
function* orders() {
  yield [...points].sort((a, b) => Number(b.onPareto) - Number(a.onPareto) || b.total - a.total);
  yield [...points].sort((a, b) => a.cost - b.cost);
  yield [...points].sort((a, b) => b.cost - a.cost);
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    const shuffled = [...points];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    yield shuffled;
  }
}
let best;
for (const sequence of orders()) {
  const attempt = layout(sequence);
  if (attempt && (!best || attempt.total < best.total)) best = attempt;
}
if (!best) throw new Error("No layout keeps every label clear; widen the chart or shorten a name");
for (const [point, chosen] of best.result) {
  point.label = chosen.spot;
  point.leader = chosen.ring > 0;
}

// --- Drawing.

const THEMES = {
  light: { surface: "#ffffff", ink: "#0b0b0b", sub: "#52514e", muted: "#6f6d68", axis: "#c3c2b7", grid: "#e1e0d9", pareto: "#8a8880", mark: "#2a78d6" },
  dark: { surface: "#0d1117", ink: "#ffffff", sub: "#c3c2b7", muted: "#9a988f", axis: "#4a4a46", grid: "#2c2c2a", pareto: "#9a988f", mark: "#3987e5" },
};
const n = (value) => Number(value.toFixed(2));
const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const TICKS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const tickLabel = (cost) => (cost < 1 ? `$${cost < 0.5 && cost !== 0.25 ? cost.toFixed(2) : cost}` : `$${cost}`);

function render(theme) {
  const t = THEMES[theme];
  const halo = `stroke="${t.surface}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;
  const num = `style="font-variant-numeric: tabular-nums"`;
  const desc = "Total score out of 100 against the agent's average cost per run in US dollars on a log scale. " +
    points.map((p) => `${p.name} ${p.level}: ${p.total.toFixed(1)} at ${money(p.cost)}`).join("; ") +
    `. The Pareto line joins ${pareto.map((p) => p.name).join(", ")}.`;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">Benchmark quality against cost</title>`);
  out.push(`<desc id="d">${esc(desc)}</desc>`);
  out.push(`<rect width="${W}" height="${H}" fill="${t.surface}"/>`);
  out.push(`<g font-family="system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">`);
  out.push(`<text x="64" y="30" font-size="17" font-weight="600" fill="${t.ink}">Quality against cost</text>`);
  out.push(`<text x="64" y="52" font-size="13" fill="${t.sub}">Benchmark v2 total (avg@3) against the agent's average cost per run, log scale; thinking medium unless marked</text>`);
  for (let score = SCORE_MIN; score <= SCORE_MAX; score += 10) {
    out.push(`<line x1="${plot.left}" x2="${plot.right}" y1="${n(Y(score))}" y2="${n(Y(score))}" stroke="${score === SCORE_MIN ? t.axis : t.grid}" stroke-width="1"/>`);
    out.push(`<text x="54" y="${n(Y(score) + 4)}" font-size="12" text-anchor="end" fill="${t.muted}" ${num}>${score}</text>`);
  }
  for (const cost of TICKS) {
    out.push(`<line x1="${n(X(cost))}" x2="${n(X(cost))}" y1="${plot.top}" y2="${plot.bottom}" stroke="${t.grid}" stroke-width="1"/>`);
    out.push(`<text x="${n(X(cost))}" y="${plot.bottom + 20}" font-size="12" text-anchor="middle" fill="${t.muted}" ${num}>${tickLabel(cost)}</text>`);
  }
  out.push(`<text x="516" y="${plot.bottom + 46}" font-size="12.5" text-anchor="middle" fill="${t.sub}">Avg. cost per run (USD, log scale) · lower is better</text>`);
  out.push(`<text transform="translate(18 ${n((plot.top + plot.bottom) / 2)}) rotate(-90)" font-size="12.5" text-anchor="middle" fill="${t.sub}">Total (/100) · higher is better</text>`);
  out.push(`<text x="74" y="92" font-size="12" fill="${t.muted}">↖ better</text>`);
  out.push(`<polyline points="${pareto.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" fill="none" stroke="${t.pareto}" stroke-width="2" stroke-dasharray="0.1 5" stroke-linecap="round"/>`);
  out.push(`<line x1="818" x2="842" y1="88" y2="88" stroke="${t.pareto}" stroke-width="2" stroke-dasharray="0.1 5" stroke-linecap="round"/>`);
  out.push(`<text x="850" y="92" font-size="12" fill="${t.muted}">Pareto line</text>`);
  for (const p of points.filter((point) => point.leader)) {
    // From the point's edge to the nearest edge of its label.
    const [lx, ly] = leaderEnd(p, p.label);
    const angle = Math.atan2(ly - p.y, lx - p.x);
    out.push(`<line x1="${n(p.x + Math.cos(angle) * 8)}" y1="${n(p.y + Math.sin(angle) * 8)}" x2="${n(lx)}" y2="${n(ly)}" stroke="${t.muted}" stroke-width="1"/>`);
  }
  for (const p of points) {
    out.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="6" fill="${t.mark}" stroke="${t.surface}" stroke-width="2"/>`);
  }
  for (const p of points) {
    const { x, y } = p.label;
    out.push(`<text x="${n(x + 2)}" y="${n(y + 12)}" font-size="${NAME_SIZE}" font-weight="600" fill="${t.ink}" ${halo}>${esc(p.title)}</text>`);
    out.push(`<text x="${n(x + 2)}" y="${n(y + 12 + LINE)}" font-size="${VALUE_SIZE}" fill="${t.sub}" ${halo} ${num}>${esc(p.value)}</text>`);
  }
  out.push(`</g></svg>`);
  return out.join("\n") + "\n";
}

for (const theme of Object.keys(THEMES)) {
  writeFileSync(path.join(root, `docs/images/benchmark-quality-cost-${theme}.svg`), render(theme));
}

// The README image's alt text says what the chart shows, so it follows the same rows.
const alt = "Scatter of total benchmark score against the agent's average cost per run, log scale: " +
  [...points].sort((a, b) => b.total - a.total).map((p) => `${p.name} ${p.level} ${p.total.toFixed(1)} at ${money(p.cost)}`).join(", ") +
  `; a dotted Pareto line joins ${pareto.map((p) => p.name).join(", ").replace(/, ([^,]+)$/, " and $1")}`;
// Each Total carries the points critical caps took off it, so the cap shows where the score is read.
const capMark = (capped) => (capped >= 0.05 ? ` <sub>−${capped.toFixed(1)} capped</sub>` : "");
const lines = read("README.md").split("\n");
const tableRows = lines.filter(isRow).map((line) => {
  const cells = line.split("|");
  const name = cells[1].trim().replace(/ avg@\d+$/, ""), level = cells[2].trim().toLowerCase();
  const row = rows.find((r) => r.name === name && r.level === level);
  cells[4] = ` ${row.total.toFixed(1)}${capMark(row.capped)} `;
  cells[5] = ` ${row.integrity.toFixed(1)} `;
  cells[6] = ` ${row.judged.toFixed(1)} `;
  return { line: cells.join("|"), total: row.total };
});
// The table is ordered by Total, highest first; rows that tie keep their order.
const sorted = tableRows.map((row, index) => ({ ...row, index })).sort((a, b) => b.total - a.total || a.index - b.index);
let next = 0;
const readme = lines.map((line) => (isRow(line) ? sorted[next++].line : line)).join("\n");
const withAlt = readme.replace(/(<img src="docs\/images\/benchmark-quality-cost-light\.svg" alt=")[^"]*(")/, (_, head, tail) => head + alt.replace(/"/g, "&quot;") + tail);
if (!withAlt.includes(alt.replace(/"/g, "&quot;"))) throw new Error("README has no benchmark chart image to describe");
writeFileSync(path.join(root, "README.md"), withAlt);
const leaders = points.filter((p) => p.leader).map((p) => p.name);
console.log(`${points.length} rows · Pareto: ${pareto.map((p) => p.name).join(" → ")} · leader lines: ${leaders.join(", ") || "none"}`);
