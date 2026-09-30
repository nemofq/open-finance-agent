import { describe, expect, it } from "vitest";
import { extractFigures, figureEquals, figureProblem, matchFigures } from "./figures";
import { createLedger } from "./ledger";
import { extractNumbers } from "./normalizers/text";
import type { Figure } from "./types";

function only(text: string): Figure[] {
  return extractFigures(text).filter((figure) => !figure.exempt);
}

function first(text: string): Figure {
  const [figure] = only(text);
  expect(figure, `no figure found in ${text}`).toBeDefined();
  return figure;
}

it("distinguishes row references and legal/account identifiers from amounts", () => {
  expect(only("Line 1 + line 3 + line 4; row 21; column 2. §1091 and §267; IRC section 1091(b); 1099-B; 401(k); 529 plan.")).toEqual([]);
  expect(only("Line 1 is $1; §1091 does not support $1091; 529 plan contributions were $529; row 21%.").map((f) => f.value))
    .toEqual([1, 1091, 529, 21]);
  expect(only("1099 USD, 401 shares, 529 dollars and a 529% gain.").map((f) => f.value)).toEqual([1099, 401, 529, 529]);
});

it("keeps parenthesized ages and prose quantities positive while retaining accounting negatives", () => {
  expect(only("You (61) and Spouse (58); the sample (42) remains small.").map((f) => f.value)).toEqual([61, 58, 42]);
  expect(only("Projected income for You (61) and Spouse (58).").map((f) => f.value)).toEqual([61, 58]);
  expect(only("| You (61) | Spouse (58) |\n| Loss | (123) |\nThe loss was (123); expense ($123); margin (15%).").map((f) => f.value))
    .toEqual([61, 58, -123, -123, -123, -15]);
  const ledger = createLedger({ sessionId: "ages" });
  ledger.add({ kind: "U", summary: "User age", value: 61 });
  expect(matchFigures("You (61) [U1]", ledger)[0].matches).toEqual(["U1"]);
  expect(matchFigures("You (62) [U1]", ledger)[0].matches).toEqual([]);
});

it("classifies identifiers, Unicode dates, fiscal labels and list indices without exempting quantities", () => {
  expect(only("iPhone 15 with iOS 18; Form 1099; BWRX-300; 52-week range; FQ4 FY23; Q3-24; 2024‑08‑06")).toEqual([]);
  expect(only("1. Revenue grew 18%.\n2. Net income was $15B.").map((f) => f.raw)).toEqual(["18%", "$15B"]);
  expect(only("Model 18 costs $18 and produces a 15% margin.").map((f) => f.raw)).toEqual(["$18", "15%"]);
  expect(only("USD-300 and EUR-450 are losses.")).toHaveLength(2);
});

it("separates product codes, abbreviated year ranges and heading labels from quantities", () => {
  expect(only("The 2000–02 cycle; FY25–26; 2024Q3; 2025-Q1; 18A and A100.\nClaim 1: foundry progress\nStep 2: review the evidence")).toEqual([]);
  expect(only("Claim 18% growth; $18; 18M of revenue; 18X earnings; 835MW of capacity.").map((f) => f.raw))
    .toEqual(["18%", "$18", "18M", "18X", "835"]);
});

it("recognizes dates without a year and exhibit abbreviations without hiding amounts", () => {
  expect(only("Quarter ended May 31; filed June 27 in Ex-99.1. Read 27 June or Sept. 3rd.")).toEqual([]);
  expect(only("May 12% growth; June $27M revenue; Exhibit 99.1 reports $31B.").map((f) => f.raw))
    .toEqual(["12%", "$27M", "$31B"]);
});

it("recognizes abbreviated month-year labels without treating their years as amounts", () => {
  expect(only("Quarters ended Dec-22, Mar-23, Sep-24 and January-2025; Feb '23, Sept. ’24, October’25.")).toEqual([]);
  expect(only("Apr-23 net loss was $0.66 per share; Sep-24 margin was 15.03%.").map((figure) => figure.value))
    .toEqual([0.66, 15.03]);
});

it("requires actual month names instead of exempting words that share their prefix", () => {
  expect(only("Margin 25; market 18; mayhem 12; decline 20; novelty 22.").map((figure) => figure.value))
    .toEqual([25, 18, 12, 20, 22]);
  expect(only("January 12, 2024; February 13; 14 March 2025; April 2026; September-2024.")).toEqual([]);
});

it("keeps quantities and decimal values checked beside abbreviated months", () => {
  expect(only("Sep-24%; Mar-23.5; April 12.5; June 18M; Dec ’24 USD.").map((figure) => figure.value))
    .toEqual([24, 23.5, 12.5, 18_000_000, 24]);
  expect(only("Market 15% and September $24M.").map((figure) => figure.value)).toEqual([15, 24_000_000]);
  expect(only("September 99; March 12.5; 12.5 March.").map((figure) => figure.value)).toEqual([99, 12.5, 12.5]);
});

it("recognizes clock labels with a zone, meridiem or explicit time context", () => {
  expect(only("At 08:15 ET pre-market; opens 09:30 EDT; closes 16:00; entered at 09:30. At 23:59:59 UTC; 9:30 a.m.; 4:00 PM; before 9:30; after 16:00.")).toEqual([]);
  expect(only("Ratios 8:15 and 20:50; at 25:30 ET; at 08:60 ET.").map((figure) => figure.value))
    .toEqual([8, 15, 20, 50, 25, 30, 8, 60]);
  expect(only("Ratios at 8:15 and at 20:50.").map((figure) => figure.value)).toEqual([8, 15, 20, 50]);
  expect(only("At 09:30 ET, price was $30 and yield 8.15%; the ratio was 8:15.").map((figure) => figure.value))
    .toEqual([30, 8.15, 8, 15]);
  expect(extractFigures("At 09:30%; at 09:30M; at 09:30.5; at 09:30:90.").every((figure) => !figure.exempt)).toBe(true);
});

it("still rejects unsupported prices beside clock labels", () => {
  const ledger = createLedger({ sessionId: "clock-labels" });
  const price = ledger.add({ kind: "E", summary: "Prior close", value: 30, unit: "USD" });
  expect(matchFigures(`At 08:15 ET, the prior close was $30 [${price.id}].`, ledger).map((m) => m.matches))
    .toEqual([[price.id]]);
  expect(matchFigures(`At 08:15 ET, the prior close was $31 [${price.id}].`, ledger).map((m) => m.matches))
    .toEqual([[]]);
});

it("recognizes plural filing names, industry codes and structural list labels", () => {
  expect(only("Read the 10-Qs and 8-Ks, then the 10-K's note. SIC 4911; NAICS 221113. Steps 1–2; tier-1 source; bucket 2.")).toEqual([]);
  expect(only("Sequence: (1) verify the filings; (2) inspect the result; (3) decide what remains open.")).toEqual([]);
  expect(only("Caveats. (1) Source dates differ. (2) Shares appear inconsistent. (3) Charges are unverified.")).toEqual([]);
  expect(only("Caveats. (1) Revenue fell 8%. (2) Loss was (12). (3) Margin was 15%.").map((figure) => figure.value))
    .toEqual([-8, -12, 15]);
  expect(only("Tier 1% yield; step 2M; loss was (12); costs: (1) million; (2) million.").map((figure) => figure.value))
    .toEqual([1, 2_000_000, -12, -1, -2]);
});

it("recognizes bold numbered list markers without exempting numeric claims", () => {
  expect(only("**1. The mechanism**\n**2. The uncertainty**\n> __3.__ The decision")).toEqual([]);
  expect(only("**1.** Revenue grew 18%.\n__2.__ The loss was (12).\n**18.5%** margin at **$15B** revenue.")
    .map((figure) => figure.value)).toEqual([18, -12, 18.5, 15_000_000_000]);
});

it.each([
  "Two routes: (1) inspect filings, and (2) check the release.",
  'Three claims: (1) "sales collapsed," (2) “margins vanished,” (3) **prices soared**.',
  "Two bets — (1) existing plants earn cash, or (2) developers reach production.",
])("recognizes sequential inline labels in clauses: %s", (text) => {
  expect(only(text)).toEqual([]);
});

it("keeps amounts and non-sequential parentheses checked beside inline labels", () => {
  expect(only("Items: (1) Revenue grew 18%, (2) the loss was (12), and (3) margin was 15%.")
    .map((figure) => figure.value)).toEqual([18, -12, 15]);
  expect(only('Costs: (1) **million**; (2) "billion".').map((figure) => figure.value)).toEqual([-1, -2]);
  expect(only("Costs: (1) USD, and (2) EUR.").map((figure) => figure.value)).toEqual([-1, -2]);
  expect(only("Balances: (1) loss, (3) revenue.").map((figure) => figure.value)).toEqual([-1, -3]);
  expect(only("The expense was (1).").map((figure) => figure.value)).toEqual([-1]);
});

it("recognizes numbered Markdown headings while checking quantities within headings", () => {
  expect(only("## 3) Where it actually breaks\n### 4. The decision\n> ## **5.** The uncertainty\n###### __6)__ The conclusion")).toEqual([]);
  expect(only("## 1) Revenue grew 18%.\n### 2. Net income was $15B.\n## 4.2B revenue\n## $4. profit\n## 18% yield")
    .map((figure) => figure.value)).toEqual([18, 15_000_000_000, 4_200_000_000, 4, 18]);
});

it("does not treat a source value on the previous line as a form identifier", () => {
  const source = "Form 13F Information Table Entry Total:\n133\nForm 13F Information Table Value Total:\n331,680,406,332";
  expect(extractNumbers(source).map((figure) => figure.value)).toEqual([133, 331_680_406_332]);
  expect(only("1099 forms and 1040 tax forms; 1040\tform")).toEqual([]);
  expect(only("Total:\n133\nForm 13F").map((figure) => figure.value)).toEqual([133]);
});

it.each([
  "Read Items 7.01/8.01/9.01 in the 8-K.",
  "Read Items 2.02, 7.01, and 9.01 before drawing a conclusion.",
  "Item 1.01 and 2.03; Item 1A remains a document heading.",
])("recognizes lists of decimal document items: %s", (text) => {
  expect(only(text)).toEqual([]);
});

it("ends an item-code list before quantities, prose or a new line", () => {
  expect(only("Items 2.02, 9.01; revenue $9.01 and yield 2.02%.").map((f) => f.raw))
    .toEqual(["$9.01", "2.02%"]);
  expect(only("Items 2.02, 9.01%, 8.01 million, 7.01 USD and 6.01x.").map((f) => f.value))
    .toEqual([9.01, 8_010_000, 7.01, 6.01]);
  for (const suffix of [" percentage points", "×", " per diluted share", "/share"]) {
    expect(only(`Items 2.02, 9.01${suffix}.`).map((f) => f.value)).toEqual([9.01]);
  }
  expect(only("Item 2.02 grew 9.01; Item 2.02,\n8.01.").map((f) => f.value))
    .toEqual([9.01, 8.01]);
});

it("keeps mixed-case processor names and quarter counts separate from financial quantities", () => {
  expect(only("x86 CPUs and MI300 accelerators; an 8-qtr revenue history.")).toEqual([]);
  expect(only("USD100, usd100, EUR30.5, 18x earnings and 18M revenue").map((figure) => figure.value))
    .toEqual([100, 100, 30.5, 18, 18_000_000]);
});

it("treats numbered forecast periods as labels while retaining amounts and rates", () => {
  expect(only("End of year 1; after year 2; years 3–5; quarter 4; month 12; period 10.")).toEqual([]);
  expect(only("Year 1% return; year 2M revenue; year 3 USD; year 1.5; loss (12).").map((figure) => figure.value))
    .toEqual([1, 2_000_000, 3, 1.5, -12]);
  const ledger = createLedger({ sessionId: "forecast-periods" });
  const balance = ledger.add({ kind: "C", summary: "Scenario balance", unit: "USD", table: {
    columns: ["label", "value"], rows: [["End of year 1", 245_000]], index: "label",
  } });
  expect(matchFigures(`$245,000 after year 1 [${balance.id}:End of year 1].`, ledger).map((m) => m.matches))
    .toEqual([[balance.id]]);
  expect(matchFigures(`$246,000 after year 1 [${balance.id}:End of year 1].`, ledger)[0].matches).toEqual([]);
});

it("requires a figure to match its cited evidence and excludes unavailable evidence", () => {
  const ledger = createLedger({ sessionId: "citation-test" });
  const a = ledger.add({ kind: "C", summary: "Growth", value: 18, unit: "%" });
  const b = ledger.add({ kind: "C", summary: "Margin", value: 25, unit: "%" });
  expect(matchFigures(`Margin was 18% [${b.id}].`, ledger)[0].matches).toEqual([]);
  expect(matchFigures(`Margin was 18% [${b.id}].`, ledger)[0].candidates).toEqual([a.id]);
  expect(matchFigures(`Growth was 18% [${a.id}].`, ledger)[0].matches).toEqual([a.id]);
  expect(matchFigures(`Growth was 18% and margin 25% [${a.id}][${b.id}].`, ledger).map((m) => m.matches)).toEqual([[a.id], [b.id]]);
  a.lookAhead = true;
  expect(matchFigures(`Growth was 18% [${a.id}].`, ledger)[0].matches).toEqual([]);
  expect(matchFigures(`Margin was 18% [${b.id}].`, ledger)[0].candidates).toBeUndefined();
});

it("matches a signed decline to its source prose while rejecting the opposite direction", () => {
  const ledger = createLedger({ sessionId: "decline-test" });
  const source = ledger.add({ kind: "E", summary: "Release", numbers: extractNumbers("Direct revenue fell 8 percent.") });
  expect(matchFigures(`Direct revenue: -8% [${source.id}].`, ledger)[0].matches).toEqual([source.id]);
  expect(matchFigures(`Direct revenue: +8% [${source.id}].`, ledger)[0].matches).toEqual([]);
});

it("reads decline direction consistently across tenses while keeping levels and explicit signs", () => {
  expect(only("Returns fall 8%; would fall by 8%; are falling 8%; margins decline 8 pp; costs decrease 8%; sales contract 8%; shares drop 8%; spending reduces by 8%.")
    .map((figure) => figure.value)).toEqual(Array(8).fill(-8));
  expect(only("Margin falls from 45% to 43%; yield declines to 8%; revenue falls to $5B; shares fall +8%.")
    .map((figure) => figure.value)).toEqual([45, 43, 8, 5_000_000_000, 8]);
  const ledger = createLedger({ sessionId: "drawdown-prose" });
  const drawdown = ledger.add({ kind: "C", summary: "Scenario drawdown", value: -66.6666666667, unit: "%" });
  expect(matchFigures(`The stock falls 66.67% [${drawdown.id}].`, ledger)[0].matches).toEqual([drawdown.id]);
  expect(matchFigures(`The stock rises 66.67% [${drawdown.id}].`, ledger)[0].matches).toEqual([]);
  expect(extractNumbers("The stock falls 66.67%.")[0]).toMatchObject({ value: -66.67, unit: "%" });
});

it("validates a quarterly series citation without interpreting its period as another financial claim", () => {
  const ledger = createLedger({ sessionId: "period-citation-test" });
  const margin = ledger.add({ kind: "C", summary: "Quarterly margin", unit: "%", table: {
    columns: ["label", "value"], rows: [["2024Q3", 15.0331]], index: "label",
  } });
  const answer = `Gross margin was 15.03% for 2024Q3 [${margin.id}:2024Q3].`;
  expect(matchFigures(answer, ledger).map(({ figure, matches }) => [figure.raw, matches]))
    .toEqual([["15.03%", [margin.id]]]);
  expect(matchFigures(answer.replace("15.03%", "16.03%"), ledger)[0].matches).toEqual([]);
});

it("matches the middle of a citation range without admitting other evidence", () => {
  const ledger = createLedger({ sessionId: "range-test" });
  for (const value of [350_000, 245_000, 171_500, 120_050]) ledger.add({ kind: "C", summary: "Scenario balance", value, unit: "USD" });
  for (const dash of ["-", "–", "—"]) {
    const text = `$350,000, $245,000, $171,500 [C1${dash}C3].`;
    expect(matchFigures(text, ledger).map((m) => m.matches)).toEqual([["C1"], ["C2"], ["C3"]]);
  }
  expect(matchFigures("$120,050 [C1–C3].", ledger)[0].matches).toEqual([]);
  expect(matchFigures("$245,000 [C3–C1].", ledger)[0].matches).toEqual([]);
  expect(matchFigures("$245,000 [C1–E3].", ledger)[0].matches).toEqual([]);
  ledger.get("C2")!.lookAhead = true;
  expect(matchFigures("$245,000 [C1–C3].", ledger)[0].matches).toEqual([]);
});

describe("extractFigures: normalisation", () => {
  it("reads scale letters and words", () => {
    expect(first("Revenue of $30,040M").value).toBe(30_040_000_000);
    expect(first("Revenue of $4.32B").value).toBe(4_320_000_000);
    expect(first("guided to $32.5 billion").value).toBe(32_500_000_000);
    expect(first("a 1.2T market").value).toBe(1_200_000_000_000);
    expect(first("payroll of 45K").value).toBe(45_000);
    expect(first("16,599 million of net income").value).toBe(16_599_000_000);
  });

  it("keeps currencies apart", () => {
    expect(first("$4.32B").unit).toBe("USD");
    expect(first("US$4.32B").unit).toBe("USD");
    expect(first("USD 4.32B").unit).toBe("USD");
    expect(first("4.32B USD").unit).toBe("USD");
    expect(first("€1.4B").unit).toBe("EUR");
    expect(first("£820M").unit).toBe("GBP");
    expect(first("¥3.1T").unit).toBe("JPY");
    expect(first("RMB 55M").unit).toBe("CNY");
  });

  it("reads percents, basis points and per-share units", () => {
    expect(first("gross margin of 75.1%")).toMatchObject({ value: 75.1, unit: "%" });
    expect(first("down 330 bps")).toMatchObject({ value: -330, unit: "bps" });
    expect(first("50 basis points")).toMatchObject({ value: 50, unit: "bps" });
    expect(first("$0.67 per diluted share")).toMatchObject({ value: 0.67, unit: "USD/share" });
    expect(first("rose 122.4 percent")).toMatchObject({ value: 122.4, unit: "%" });
  });

  it("reads signs, unicode minus and parenthesised negatives", () => {
    expect(first("operating income of -1,205").value).toBe(-1205);
    expect(first("margin change of −3.3%").value).toBe(-3.3);
    expect(first("free cash flow of ($2,410)").value).toBe(-2410);
    expect(first("up +122.4%").value).toBe(122.4);
    expect(first("a (−1.0) swing").value).toBe(-1);
  });

  it("retains signed source spans without changing accounting-negative matching", () => {
    const text = "Income −$20M; change -3.3%; gain +3.3%; margin (15.0%); expense ($2,410).";
    const figures = only(text);
    expect(figures.map((f) => [f.raw, f.value])).toEqual([
      ["−$20M", -20_000_000], ["-3.3%", -3.3], ["+3.3%", 3.3], ["(15.0%)", -15], ["($2,410)", -2410],
    ]);
    for (const f of figures) expect(text.slice(f.index, f.index + f.raw.length)).toBe(f.raw);
    const ledger = createLedger({ sessionId: "signed-span-test" });
    ledger.add({ kind: "C", summary: "Positive margin", value: 15, unit: "%" });
    const problem = matchFigures("Margin (15.0%) [C1].", ledger)[0];
    expect(problem.matches).toEqual([]);
    expect(figureProblem(problem)).toContain('"(15.0%)" (parentheses are read as a negative amount)');
    expect(matchFigures("Margin +15.0% [C1].", ledger)[0].matches).toEqual(["C1"]);
    ledger.add({ kind: "C", summary: "Negative margin", value: -15, unit: "%" });
    expect(matchFigures("Margin (15.0%) [C2].", ledger)[0].matches).toEqual(["C2"]);
  });

  it("reads percentage points written as pp", () => {
    expect(first("| −1.0pp |")).toMatchObject({ value: -1, unit: "pp" });
    expect(first("widened by +1.3pp")).toMatchObject({ value: 1.3, unit: "pp" });
    expect(only("gaps from −0.5 to −4.3pp").map((figure) => figure.value)).toEqual([-0.5, -4.3]);
  });

  it("reads a decline's sign from prose without changing reported levels or money amounts", () => {
    expect(only("Direct sales fell 8%; overhead decreased by 9 percent; margin down 110 bps.").map((f) => f.value))
      .toEqual([-8, -9, -110]);
    expect(only("Margin fell from 45% to 43%; yield decreased to 8%; revenue was down to $5B.").map((f) => f.value))
      .toEqual([45, 43, 8, 5_000_000_000]);
    expect(only("Growth up 8%; a decline of -9%; down +10%.").map((f) => f.value)).toEqual([8, -9, 10]);
  });
});

/**
 * A hyphen or dash glued to a number is punctuation, not a minus. Every case here was flagged as
 * an unsourced figure on a real answer before the sign rule looked at what precedes it.
 */
describe("extractFigures: hyphens and dashes", () => {
  const reason = (text: string): string | undefined => extractFigures(text)[0]?.exempt;

  it("reads a hyphenated month as a date, not a negative year", () => {
    expect(reason("Total revenue growth Sep-2024 → Jun-2026")).toBe("date");
    expect(reason("Microsoft's June-2026 quarter")).toBe("date");
    expect(reason("through December-2025")).toBe("date");
    expect(only("from 11.8% (Dec-2024) to 24.2% (Jun-2026)").map((figure) => figure.value)).toEqual([11.8, 24.2]);
  });

  it("reads mid-2025 and a year range as years", () => {
    expect(reason("Alphabet overtook it in mid-2025")).toBe("year");
    expect(reason("early-2024 shipments")).toBe("year");
    expect(reason("late-2026 guidance")).toBe("year");
    expect(extractFigures("over 2024–2026").map((figure) => figure.exempt)).toEqual(["year", "year"]);
    expect(extractFigures("over 2024-2026").map((figure) => figure.exempt)).toEqual(["year", "year"]);
  });

  it("reads a range dash as a range, so both ends keep their sign", () => {
    expect(only("a fairly stable band around 12–18%").map((figure) => [figure.value, figure.unit])).toEqual([
      [12, undefined],
      [18, "%"],
    ]);
    expect(only("12-18% of revenue").map((figure) => figure.value)).toEqual([12, 18]);
  });
});

describe("extractFigures: sign before the currency symbol", () => {
  it("reads -$5M and $-5M as the same negative amount", () => {
    for (const text of ["FCF was -$5M", "FCF was $-5M", "FCF was ($5M)"]) {
      const [figure] = extractFigures(text);
      expect(figure.value, text).toBe(-5_000_000);
      expect(figure.unit, text).toBe("USD");
    }
  });

  it("keeps a glued dash before a currency as punctuation", () => {
    const [figure] = extractFigures("FY24-$5M").filter((candidate) => !candidate.exempt);
    expect(figure.value).toBe(5_000_000);
  });
});

describe("extractFigures: exemptions", () => {
  const reason = (text: string): string | undefined => extractFigures(text)[0]?.exempt;

  it("exempts years, dates, fiscal labels and ordinals", () => {
    expect(reason("filed in 2024 by the company")).toBe("year");
    expect(reason("as of 2024-08-28")).toBe("date");
    expect(reason("on Aug 28, 2024")).toBe("date");
    expect(reason("on 8/28/2024")).toBe("date");
    expect(reason("FY25 Q2 revenue")).toBe("fiscal");
    expect(reason("Q2 came in ahead")).toBe("fiscal");
    expect(reason("FY2025 Q3 guidance")).toBe("fiscal");
    expect(reason("H1 shipments")).toBe("fiscal");
    expect(reason("the 3rd consecutive beat")).toBe("ordinal");
  });

  it("exempts our own citations, SEC form names, items and exhibits", () => {
    // A rule that strips unsourced figures must not fire on the citation proving the source.
    expect(only("Revenue was $30,040M [E7], up 122.4% [C3].").map((figure) => figure.value)).toEqual([
      30_040_000_000, 122.4,
    ]);
    expect(reason("the 10-Q filed last week")).toBe("id");
    expect(reason("8-K with Item 2.02")).toBe("id");
    expect(reason("Exhibit 99.1 carries the release")).toBe("id");
    expect(reason("a 13F holder")).toBe("id");
    // Scientific notation is not a citation.
    expect(reason("1E7 units")).toBeUndefined();
  });

  it("exempts ids and tickers", () => {
    expect(reason("Accession: 0001045810-24-000029")).toBe("id");
    expect(reason("CIK 0001045810")).toBe("id");
    expect(only("Compare $NVDA with $AMD")).toHaveLength(0);
    // Tickers may carry a digit; the ticker rule must win over the number rule.
    expect(reason("$V2X was added")).toBe("ticker");
    // A dollar amount is never a ticker, even though it follows the same "$" sign.
    expect(reason("$3M of buybacks")).toBeUndefined();
  });

  it("exempts small counts, written as digits or words", () => {
    expect(reason("eight quarters of growth")).toBe("count");
    expect(reason("3 analysts cover it")).toBe("count");
    expect(reason("8 periods, newest first")).toBe("count");
    // Above the small-count ceiling it is a figure again.
    expect(reason("48 analysts cover it")).toBeUndefined();
  });

  it("keeps real figures out of every exemption", () => {
    const figures = only("Revenue was $30,040M in FY25 Q2, up 122.4% from 2024 levels.");
    expect(figures.map((figure) => figure.value)).toEqual([30_040_000_000, 122.4]);
  });
});

describe("figureEquals", () => {
  it("does not cite an amount or valuation multiple as a percentage", () => {
    expect(figureEquals(first("18%"), 18, "USD")).toBe(false);
    expect(figureEquals(first("18%"), 18, "x")).toBe(false);
    expect(figureEquals(first("$18"), 18, "%")).toBe(false);
    expect(figureEquals(first("18x"), 18, "%")).toBe(false);
    expect(figureEquals(first("18%"), 0.18, "ratio")).toBe(true);
    expect(figureEquals(first("18x"), 18, "ratio")).toBe(true);
    expect(first("18 times earnings")).toMatchObject({ value: 18, unit: "x" });
    expect(first("18× earnings")).toMatchObject({ value: 18, unit: "x" });
  });

  it("matches a source's declared scale and currency in the same units used for display", () => {
    expect(figureEquals(first("$1.5B"), 1.5, "USD bn")).toBe(true);
    expect(figureEquals(first("$12.6M"), 12.6, "usd mn")).toBe(true);
    expect(figureEquals(first("$1.5B"), 1.5, "EUR bn")).toBe(false);
    expect(figureEquals(first("$1.5B"), 1.5, "eur bn")).toBe(false);
    expect(figureEquals(first("$1.5B"), 1.6, "USD bn")).toBe(false);
    expect(first("$12.6mn").value).toBe(12_600_000);
    expect(first("$12.6MN").value).toBe(12_600_000);
    expect(first("USD 1.5 BILLION").value).toBe(1_500_000_000);
  });

  it("matches at the precision shown", () => {
    expect(figureEquals(first("$4.32B"), 4_318_000_000)).toBe(true);
    expect(figureEquals(first("$4.32B"), 4_390_000_000)).toBe(false);
    expect(figureEquals(first("30,040"), 30_040)).toBe(true);
  });

  it("treats a percent and its ratio as the same claim", () => {
    expect(figureEquals(first("11.2%"), 0.11237)).toBe(true);
    expect(figureEquals(first("11.2%"), 11.2)).toBe(true);
    expect(figureEquals(first("11.2%"), 0.118)).toBe(false);
    expect(figureEquals(first("330 bps"), 0.033)).toBe(true);
    expect(figureEquals(first("330 bps"), 3.3, "%")).toBe(true);
  });

  it("crosses a scale mismatch when the digits agree", () => {
    expect(figureEquals(first("30,040"), 30_040_000_000)).toBe(true);
    expect(figureEquals(first("$30.04B"), 30_040)).toBe(true);
    // One decimal on a billions figure is a claim to ±50M, so 30,140M is outside it.
    expect(figureEquals(first("$30.0B"), 30_140)).toBe(false);
    // Two significant digits are not enough to cross a scale.
    expect(figureEquals(first("4 contracts"), 4_000)).toBe(false);
  });

  it("refuses a different currency", () => {
    expect(figureEquals(first("€4.32B"), 4_318_000_000, "USD")).toBe(false);
    expect(figureEquals(first("€4.32B"), 4_318_000_000, "EUR")).toBe(true);
  });
});

describe("matchFigures", () => {
  it("returns the entries holding each non-exempt figure", () => {
    const ledger = createLedger({ sessionId: "s1" });
    ledger.add({
      kind: "E",
      summary: "EDGAR income statement",
      facts: [{ metric: "revenue", period: "2024-07-28", value: 30_040_000_000, unit: "USD" }],
    });
    ledger.add({ kind: "C", summary: "Gross margin", name: "gross margin", value: 75.1, unit: "%" });

    const matches = matchFigures("Revenue was $30,040M in FY25 Q2 at a 75.1% gross margin, filed 2024-08-28.", ledger);
    expect(matches).toHaveLength(2);
    expect(matches[0].matches).toEqual(["E1"]);
    expect(matches[1].matches).toEqual(["C1"]);
  });

  it("reports an unsourced figure with no matches", () => {
    const ledger = createLedger({ sessionId: "s1" });
    const [match] = matchFigures("Bitcoin is 4.4% of all supply.", ledger);
    expect(match.matches).toEqual([]);
  });
});
