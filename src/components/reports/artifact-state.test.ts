import { describe, expect, it } from "vitest";
import {
  type ArtifactView,
  clampPanelRatio,
  DEFAULT_PANEL_RATIO,
  initialView,
  panelWidth,
  parseView,
  readStoredView,
  reconcile,
  reportFileName,
  relativeTime,
  rememberView,
} from "./artifact-state";

const list = (...ids: string[]) => ids.map((id) => ({ id }));

describe("initialView", () => {
  it("stays hidden for a chat with no reports", () => {
    expect(initialView([], null)).toEqual({ kind: "hidden" });
    expect(initialView([], { kind: "gallery" })).toEqual({ kind: "hidden" });
  });

  it("shows the only report, and the gallery once there is a choice", () => {
    expect(initialView(list("a"), null)).toEqual({ kind: "report", id: "a" });
    expect(initialView(list("a", "b"), null)).toEqual({ kind: "gallery" });
  });

  it("honours what the tab remembers", () => {
    expect(initialView(list("a", "b"), { kind: "report", id: "b" })).toEqual({ kind: "report", id: "b" });
    expect(initialView(list("a"), { kind: "gallery" })).toEqual({ kind: "gallery" });
    expect(initialView(list("a"), { kind: "hidden" })).toEqual({ kind: "hidden" });
  });

  it("falls back when the remembered report is gone", () => {
    expect(initialView(list("a"), { kind: "report", id: "gone" })).toEqual({ kind: "report", id: "a" });
    expect(initialView(list("a", "b"), { kind: "report", id: "gone" })).toEqual({ kind: "gallery" });
  });
});

describe("reconcile", () => {
  it("leaves a view its reports still support alone", () => {
    expect(reconcile({ kind: "report", id: "a" }, list("a", "b"))).toEqual({ kind: "report", id: "a" });
    expect(reconcile({ kind: "gallery" }, list("a", "b"))).toEqual({ kind: "gallery" });
    expect(reconcile({ kind: "hidden" }, list("a"))).toEqual({ kind: "hidden" });
  });

  it("moves on when the shown report leaves the transcript", () => {
    expect(reconcile({ kind: "report", id: "a" }, list("b", "c"))).toEqual({ kind: "gallery" });
    expect(reconcile({ kind: "report", id: "a" }, list("b"))).toEqual({ kind: "report", id: "b" });
    expect(reconcile({ kind: "report", id: "a" }, [])).toEqual({ kind: "hidden" });
  });

  it("closes the gallery once the last report is gone", () => {
    expect(reconcile({ kind: "gallery" }, [])).toEqual({ kind: "hidden" });
  });
});

describe("clampPanelRatio", () => {
  it("holds the ratio between a third and seven tenths", () => {
    expect(clampPanelRatio(0.55)).toBe(0.55);
    expect(clampPanelRatio(0.1)).toBe(0.35);
    expect(clampPanelRatio(0.95)).toBe(0.7);
    expect(clampPanelRatio(Number.NaN)).toBe(DEFAULT_PANEL_RATIO);
  });
});

describe("panelWidth", () => {
  it("gives the panel its share of a wide row", () => {
    expect(panelWidth(1400, 0.5)).toBe(700);
    expect(panelWidth(1400, 0.55)).toBe(770);
  });

  it("leaves the transcript 400px, whatever the ratio asks for", () => {
    expect(panelWidth(1000, 0.7)).toBe(600);
    expect(panelWidth(900, 0.7)).toBe(500);
  });

  it("holds the panel at its own minimum before the row runs out", () => {
    expect(panelWidth(760, 0.7)).toBe(360);
  });

  it("reports no room at all below the two minimums together", () => {
    expect(panelWidth(759, 0.55)).toBe(0);
    expect(panelWidth(0, 0.55)).toBe(0);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);
  const ago = (ms: number) => relativeTime(now - ms, now);

  it("counts minutes, hours and days", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59_000)).toBe("just now");
    expect(ago(5 * 60_000)).toBe("5 min ago");
    expect(ago(2 * 3_600_000)).toBe("2 h ago");
    expect(ago(23 * 3_600_000)).toBe("23 h ago");
    expect(ago(25 * 3_600_000)).toBe("yesterday");
    expect(ago(3 * 86_400_000)).toBe("3 days ago");
  });

  it("reads a clock that runs ahead as the present", () => {
    expect(relativeTime(now + 5_000, now)).toBe("just now");
  });

  it("falls back to a short date after a week", () => {
    const old = now - 30 * 86_400_000;
    expect(ago(30 * 86_400_000)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(old)),
    );
  });

  it("names the year when it is not this one", () => {
    const old = now - 400 * 86_400_000;
    expect(ago(400 * 86_400_000)).toBe(
      new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(old)),
    );
  });
});

describe("reportFileName", () => {
  it("turns a title into a plain, lower-case file name", () => {
    expect(reportFileName("$ACME — Earnings Preview: FY26 Q3")).toBe("acme-earnings-preview-fy26-q3");
    expect(reportFileName("  Q3   review  ")).toBe("q3-review");
  });

  it("never ends on a separator, even after being cut short", () => {
    const name = reportFileName(`${"a".repeat(79)} beta gamma`);
    expect(name).toHaveLength(79);
    expect(name.endsWith("-")).toBe(false);
  });

  it("falls back when nothing usable is left", () => {
    expect(reportFileName("—")).toBe("report");
    expect(reportFileName("")).toBe("report");
  });
});

describe("persistence without a browser", () => {
  it("stores nothing and reads the defaults rather than throwing", () => {
    const view: ArtifactView = { kind: "report", id: "a" };
    expect(() => rememberView("s1", view)).not.toThrow();
    expect(parseView(readStoredView("s1"))).toBeNull();
  });
});
