/**
 * The artifact column's state and geometry, kept free of React so both are unit-testable:
 * which of the three views the column is in, how wide it is, and what a browser tab remembers.
 */

/** What the artifact column is showing: nothing, the chooser, or one report. */
export type ArtifactView = { kind: "hidden" } | { kind: "gallery" } | { kind: "report"; id: string };

/** Only the identity of a report matters here; the panel and the gallery take the whole ref. */
type Listed = { id: string };

/** The view a chat with these reports falls back to when nothing is remembered. */
function defaultView(reports: readonly Listed[]): ArtifactView {
  if (reports.length === 0) return { kind: "hidden" };
  // One report is unambiguous, so show it; more than one is a choice, so offer the gallery.
  if (reports.length === 1) return { kind: "report", id: reports[0].id };
  return { kind: "gallery" };
}

/** The view a chat opens in, honouring what this tab last chose for it. */
export function initialView(reports: readonly Listed[], remembered: ArtifactView | null): ArtifactView {
  if (reports.length === 0) return { kind: "hidden" };
  if (remembered === null) return defaultView(reports);
  // A remembered report that has since left the transcript is no choice at all.
  if (remembered.kind === "report" && !reports.some((report) => report.id === remembered.id)) {
    return defaultView(reports);
  }
  return remembered;
}

/** Keep a view answerable as the transcript changes under it (a retry drops a report, say). */
export function reconcile(view: ArtifactView, reports: readonly Listed[]): ArtifactView {
  if (view.kind === "hidden") return view;
  if (reports.length === 0) return { kind: "hidden" };
  if (view.kind === "report" && !reports.some((report) => report.id === view.id)) return defaultView(reports);
  return view;
}

/* ---------------------------------------------------------------- geometry */

/** The panel's share of the chat area before anyone drags it. */
export const DEFAULT_PANEL_RATIO = 0.55;
const MIN_RATIO = 0.35;
const MAX_RATIO = 0.7;
/** The transcript stays readable: it never gives up more than this. */
const CHAT_MIN = 400;
/** Below this a report is not worth showing beside the chat. */
const PANEL_MIN = 360;

/** Hold a requested share inside the range the drag handle allows. */
export function clampPanelRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_PANEL_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * The panel's width in px for a row of `containerWidth`. The panel yields first, down to its
 * own minimum, so the transcript keeps its 400px; when even that does not fit, `0` says the
 * row cannot be split and the panel has to take the whole area.
 */
export function panelWidth(containerWidth: number, ratio: number): number {
  if (containerWidth < CHAT_MIN + PANEL_MIN) return 0;
  const wanted = Math.round(containerWidth * clampPanelRatio(ratio));
  return Math.max(PANEL_MIN, Math.min(wanted, containerWidth - CHAT_MIN));
}

/* ------------------------------------------------------------------- times */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const shortDate = (value: number, sameYear: boolean): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(value));

/** How long ago a report was made, at a glance. Future times read as "just now" (clock skew). */
export function relativeTime(fromMs: number, nowMs: number): string {
  const elapsed = nowMs - fromMs;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return shortDate(fromMs, new Date(fromMs).getFullYear() === new Date(nowMs).getFullYear());
}

/* --------------------------------------------------------------- downloads */

/** Longer than this and the name stops telling the reader anything a folder view can show. */
const NAME_MAX = 80;

/**
 * A report's title as a file name: lower case, ASCII, and free of anything a shell or a file
 * system might read as punctuation. A title that survives none of that (a CJK one, say) falls
 * back to a plain "report", which the browser's own numbering keeps unique.
 */
export function reportFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, NAME_MAX)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "report" : slug;
}

/* ------------------------------------------------------------- persistence */

const viewKey = (sessionId: string): string => `open-finance.artifacts.view.${sessionId}`;

function isView(value: unknown): value is ArtifactView {
  const view = value as ArtifactView | null;
  if (view === null || typeof view !== "object") return false;
  if (view.kind === "hidden" || view.kind === "gallery") return true;
  return view.kind === "report" && typeof view.id === "string";
}

/**
 * The column's state per chat, per tab: two tabs on the same chat can look at different
 * reports, and neither choice outlives the tab. Storage may be unavailable or full, in which
 * case the column simply opens on its default.
 */
export function rememberView(sessionId: string, view: ArtifactView): void {
  try {
    window.sessionStorage.setItem(viewKey(sessionId), JSON.stringify(view));
  } catch {
    // No memory for this tab; the default view is still correct.
  }
}

/** The stored choice as it was written, which a `useSyncExternalStore` snapshot can compare. */
export function readStoredView(sessionId: string): string | null {
  try {
    return window.sessionStorage.getItem(viewKey(sessionId));
  } catch {
    return null;
  }
}

export function parseView(stored: string | null): ArtifactView | null {
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isView(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
