import type { SandboxStatus } from "@/lib/sandbox/protocol";

/**
 * The calculator's Settings line and tool description, both generated from the runtime that is
 * actually installed. Nothing here is hard-coded about the libraries or the
 * `fin` API: an environment without scipy never claims scipy, and the API reference comes from
 * `fin`'s own registry, so the description cannot name a function the runtime lacks.
 */

/** The one-line status Settings shows next to the calculator. */
export function statusLine(status: SandboxStatus): string {
  switch (status.state) {
    case "ready": {
      const passed = status.isolation === "passed";
      const isolation = passed
        ? "isolation check passed"
        : `isolation check ${status.isolation ?? "untested"}${status.message ? ` — ${status.message}` : ""}`;
      const parts = [
        `${passed ? "Ready" : "Disabled"} · Python ${status.pythonVersion ?? "?"} (Pyodide ${status.pyodideVersion ?? "?"})`,
        (status.packages ?? []).join(", "),
        `fin ${status.finVersion ?? "?"}`,
        isolation,
      ];
      return parts.filter(Boolean).join(" · ");
    }
    case "missing":
      return `Not available · ${status.message ?? "the calculator runtime is not installed"}`;
    case "failed":
      return `Disabled · ${status.message ?? "the calculator runtime failed"}`;
  }
}

const RULES = `How to use it:
- **Data comes by reference.** List the evidence ids you need in \`evidence\` and each one is preloaded as a pandas DataFrame under its own name: \`evidence: ["E7"]\` gives you \`E7\`, with the source metadata on \`E7.attrs\`. Never retype a number you were shown — reference it, so the result is traceable to its source.
- Use the frame's actual index and columns. SEC statement amounts are in base dollars or shares, even when the displayed statement uses millions; EPS remains dollars per share. Rows use metric keys such as \`revenue\`, \`grossProfit\` and \`dilutedEps\`; columns are period-end dates, newest first. Inspect unfamiliar frames instead of guessing labels. Preserve source dates and values; flag anomalies instead of reconstructing history from proxies. For consecutive quarterly data, sort dates before comparing adjacent quarters or four periods apart.
- Filing prose and scalar entries (C, A, U) preload rows with \`value\`, \`unit\` and \`context\` columns. Select by context and unit; a scalar is \`C3.loc[0, "value"]\`. Reuse these inputs instead of declaring them again as assumptions.
- **Declare every other constant** with \`assume(name, value, why)\`, which returns the value and records it as an assumption. A bare number in the code that is not a conventional constant is reported as an undeclared assumption against your answer.
- **Record every result** with \`emit(name, value, unit=None)\`. Only emitted values become citable figures; anything you merely print is scratch. \`emit\` takes \`fin\` results, plain numbers, and vectors or dicts of numbers, and keeps the formula \`fin\` reports.
- Group related calculations in one call. Emit a period-keyed dict for a series, with one unit throughout; keep money and rates in separate emissions. Imports and variables do not persist between calls.
- **Percentages:** both \`fin\` and \`emit(..., unit="%")\` take decimals: 0.124 becomes 12.4%. Source prose stores the quoted percentage, so divide its percent value by 100 before using it as a rate or emitting it with \`%\`. Quote the emitted result, not the unconverted input.
- \`print(...)\` still works for intermediate output.

There is no network, no filesystem and no way to start a process: fetch data with the data tools first, then compute here.`;

/**
 * The tool description sent to the model.
 *
 * The libraries are listed by the name that is typed, not the name that is installed, and the
 * list is the whole inventory rather than the readable subset Settings shows: a model that is
 * told the boundary does not spend a tool call discovering that `ta` was never there.
 */
export function toolDescription(status: SandboxStatus): string {
  const imports = (status.importNames ?? status.packages ?? []).join(", ");
  return [
    "Compute financial figures from evidence you have already retrieved, by writing Python.",
    "",
    `Runtime: Python ${status.pythonVersion ?? "3"} (Pyodide ${status.pyodideVersion ?? "?"}).`,
    imports ? `Libraries, by the name you import them under: ${imports}, plus the Python standard library.` : "",
    imports
      ? "Nothing else can be imported: there is no pip and no network, and an import that is not on that list is refused before your code runs. scipy and statsmodels load on first import, which takes a moment."
      : "",
    `\`fin\` ${status.finVersion ?? ""} is preloaded with reviewed formulas and pinned conventions; prefer it to writing a formula yourself, so every figure carries its method.`.trim(),
    "",
    RULES,
    "",
    "Example with complete, consecutive quarterly SEC income statements (keep source dates as labels):",
    "```python",
    'periods = sorted(E7.columns)',
    'revenue = E7.loc["revenue"]',
    'emit("Gross margin", {p: fin.margin(E7.loc["grossProfit", p], revenue[p]) for p in periods}, unit="%")',
    'emit("Revenue QoQ", {now: fin.qoq(revenue[now], revenue[prior]) for prior, now in zip(periods, periods[1:])}, unit="%")',
    'emit("Revenue YoY", {now: fin.yoy(revenue[now], revenue[prior]) for prior, now in zip(periods, periods[4:])}, unit="%")',
    "```",
    "",
    status.finApi ? `fin API:\n${status.finApi}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
