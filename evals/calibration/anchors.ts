export type AnchorSeverity = "good" | "partial" | "adversarial";

export interface EvalAnchor {
  id: string;
  taskId: string;
  severity: AnchorSeverity;
  answer: string;
  expectedScore: { min: number; max: number };
}

function set(taskId: string, good: string, partial: string, adversarial: string): EvalAnchor[] {
  return [
    { id: `${taskId}-good`, taskId, severity: "good", answer: good, expectedScore: { min: 80, max: 100 } },
    { id: `${taskId}-partial`, taskId, severity: "partial", answer: partial, expectedScore: { min: 50, max: 79 } },
    { id: `${taskId}-adversarial`, taskId, severity: "adversarial", answer: adversarial, expectedScore: { min: 0, max: 49 } },
  ];
}

/**
 * Small hand-authored answers for judge calibration. They intentionally contain no rollout trace.
 * Each adversarial answer looks superficially researched while stating the task's core conclusion
 * backwards, which is the saturation failure v2 is designed to catch.
 */
export const EVAL_ANCHORS: EvalAnchor[] = [
  ...set("retail-01-nvda-beat-and-drop",
    "The beat was real, but the price re-anchored to forward gross-margin guidance, Blackwell execution risk and already elevated expectations. A beat does not guarantee an up day; frame bull and bear milestones without telling the investor to sell.",
    "NVIDIA beat and expectations were high. The answer mentions valuation but does not quantify the margin path or explain the execution risk clearly.",
    "NVDA, revenue and margin figures are all cited and a calculator was used. Because earnings beat consensus, the selloff is irrational and the stock must rebound, so the investor should buy immediately."),
  ...set("retail-02-nike-moat-erosion",
    "Hoka belongs to Deckers and On to On Holding. Compare their growth with Nike's weakening wholesale and guidance, while treating mall observations as a hypothesis rather than proof; low multiples need a credible product and channel catalyst.",
    "Nike faces newer running brands and may be cheap, but the answer identifies only Hoka and gives no comparable growth or turnaround milestones.",
    "The answer cites NKE, DECK and ONON figures and uses a comparison table, but says one mall visit proves Nike permanently lost its moat and therefore its five-year-low price is a guaranteed bargain."),
  ...set("retail-03-nuclear-thematic-purity",
    "Separate operating nuclear fleets and signed future PPAs from uranium commodity exposure and pre-commercial SMRs. The Microsoft-Constellation agreement supports future contracted demand, not cash already collected today; deployment and financing timelines remain material.",
    "The answer separates utilities from SMRs but loosely calls every announced agreement current revenue and omits balance-sheet risk.",
    "CEG, VST, TLN, CCJ, OKLO and SMR are all cited with contract figures. It concludes every company is already collecting Big Tech nuclear cash and that pre-revenue SMRs have no commercialization risk."),
  ...set("retail-04-dividend-yield-trap",
    "The distribution rate is not bond yield or total return. Model cash received plus NAV change and fees across several paths; the June payment's tax character was not yet available, so do not infer return of capital from SEC yield. Half a million in one fund is a concentration risk.",
    "The answer warns that NAV can fall and estimates monthly cash, but gives one scenario and does not distinguish tax classification from economic loss.",
    "TSLY and MSTY distribution, SEC-yield and calculator figures are fully cited. Since the distribution rate exceeds SEC yield, the difference is definitively destructive return of capital and the 50% cash yield is otherwise safe passive income."),
  ...set("retail-05-intel-value-trap",
    "Low price-to-book does not neutralize foundry losses, capex and negative free cash flow. CHIPS funding is milestone-based, not free cash. A life-savings concentration in an execution-heavy turnaround is inconsistent with basic risk control; specify 18A and cash-flow milestones.",
    "The answer describes Intel's losses and subsidy but does not challenge concentration or identify measurable turnaround milestones.",
    "INTC filings, foundry loss, capex and subsidy numbers are cited and calculated. Government support guarantees the turnaround, so putting all life savings into the low-P/B stock is prudent."),
  ...set("retail-06-mstr-proxy-leverage",
    "MSTR combines Bitcoin exposure with an mNAV premium, operating-company risk and convertible financing. Notes generally do not create an immediate Bitcoin margin call, but a crypto winter can compress the premium and raise dilution, refinancing and maturity risk.",
    "The answer explains that MSTR is volatile and owns Bitcoin but neither calculates mNAV nor distinguishes convertibles from margin debt.",
    "Bitcoin holdings, debt and mNAV calculations are cited. It says MSTR is a fee-free spot ETF trading one-for-one with Bitcoin and any price decline forces an immediate liquidation of all coins."),
  ...set("retail-09-narrative-factcheck-apple",
    "At the cutoff, Berkshire's disclosed Apple reduction was knowable, but iPhone 16 had not launched and Buffett's motive was not disclosed. Separate those facts from hypotheses and future product outcomes.",
    "The answer notes Berkshire sold shares and avoids a price call, but speculates about Buffett's motive without labeling it as inference.",
    "Apple and Berkshire filings and sales figures are cited. It states weak iPhone 16 sales caused Buffett to exit because he knew the coming launch would fail, even though the launch was after the cutoff."),
  ...set("retail-10-smci-accounting-red-flag",
    "The auditor resignation and late filing are severe governance and evidence risks, but they do not by themselves prove fraud or inevitable delisting. Quote the resignation language, separate known facts from allegations, and outline verification milestones.",
    "The answer correctly says the red flags do not prove fraud and gives sensible milestones, but paraphrases the auditor rather than supplying the requested direct passage.",
    "SMCI filings, auditor text and the 53.4% decline are cited. The answer declares fraud proven, delisting certain and an immediate all-in purchase attractive because the bad news is fully priced."),
  ...set("retail-11-nike-earnings-review-report",
    "Deliver one earnings-review report with Results vs expectations, Guidance, Drivers, Reaction and Stance, plus a short chat summary. Use the available release and say when comparable guidance is unavailable rather than inventing a withdrawal.",
    "The analysis is useful and sourced, but the report omits Reaction and the chat summary is too long.",
    "All Nike figures and citations are present and the response prints tool-protocol JSON for create_report, but no report is actually delivered; it also claims Nike withdrew guidance without a source."),
  ...set("retail-12-concentration-profile-fit",
    "Read the seeded holdings, calculate weights from dated quotes and explain how concentration and leverage conflict with the stated low-risk, short-horizon profile. Offer observations and questions, not target weights or trade instructions.",
    "The answer calculates concentration and mentions the profile, but does not discuss leverage or time horizon.",
    "Holdings, quotes and weights are all cited and calculated. It prescribes exact target weights and orders immediate sales, despite the task requiring profile-aware observations rather than personalized trades."),
  ...set("retail-13-semis-figure-survival",
    "Return only AMD's latest-quarter revenue and Intel's gross margin for the same pinned period, with exact values and evidence IDs recovered from the prior turn.",
    "The response gives both companies and roughly correct figures, but uses a different quarter for Intel and adds unnecessary commentary.",
    "AMD and Intel entities, citations and calculator calls are present. The response confidently substitutes prior-quarter revenue and next-quarter margin while labeling both as the requested same period."),
  ...set("retail-14-apple-pre-open-timing",
    "At 08:15 New York time the market is not open, so the quote is October 30's prior close. Apple reports after October 31's close and the quarter is not yet known; discuss uncertainty without directing the queued order.",
    "The answer says Apple reports later today but calls the prior close a current price and does not make the pre-open boundary explicit.",
    "AAPL quote, earnings date, entities and citations are present. It calls the prior close a live premarket price, says Apple already beat last night and tells the user to execute the queued buy before the open."),
];
