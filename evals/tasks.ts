import type { EvalTask, EvalTaskContract } from "./types";
import { evidenceRequirementsForTask } from "./offline/coverage-contract";

/** The task definitions; each task's required evidence comes from the dataset's coverage contract. */
const TASKS: Omit<EvalTask, "requiredEvidence" | "contracts">[] = [
  {
    id: "retail-01-nvda-beat-and-drop",
    category: "earnings_paradox",
    title: "Earnings Beat & Drop Paradox (NVIDIA)",
    prompt:
      "Why is Nvidia dumping today when their earnings literally beat Wall Street estimates last night? Is the AI trade completely falling apart, or should I cut my losses and sell?",
    asOfDate: "2024-08-29",
    dataset: {
      peerTickers: ["AMD", "INTC", "AVGO", "TSM", "SMCI", "SMH"],
      searchTopics: ["nvidia", "nvda", "blackwell", "data center", "gross margin", "earnings", "chip stocks", "selloff", "sell-off", "forecast", "guidance", "stock drop", "beat"],
    },
    latentIntent:
      "The retail investor confuses headline EPS/revenue beats with forward expectations and margin direction. The agent must recognize: 1) Whisper expectations and lofty valuation multiples demanded an enormous beat; 2) Blackwell chip manufacturing delay concerns and Q3 gross margin guidance compressing sequentially; 3) Deceleration from astronomical law-of-large-numbers base effects in Data Center revenue.",
    expectedEntities: [
      { label: "NVIDIA", aliases: ["NVDA", "NVIDIA"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Recognize user confusion around the post-earnings sell-off following the August 2024 Q2 FY25 report, identifying the gap between headline beats and sequential gross margin / guidance slowdown.",
      dataGroundingCriteria:
        "Accurately cite EDGAR 8-K/10-Q figures for quarterly revenue growth, Data Center segment contribution, and sequential gross margin compression with filing dates/accessions.",
      financialReasoningCriteria:
        "Differentiate headline trailing beats from forward guidance re-anchoring; calculate sequential growth rates and explain how high valuation multiples require accelerating beats.",
      retailClarityCriteria:
        "Deconstruct the 'beat means stock must go up' misconception in plain language, outline balanced bull/bear scenarios, and provide risk guardrails without personal buy/sell advice.",
    },
  },
  {
    id: "retail-02-nike-moat-erosion",
    category: "moat_erosion",
    title: "Moat Erosion & Competitor Disruption (Nike vs On / Hoka)",
    prompt:
      "Nike stock is getting crushed and walking around the mall it feels like nobody is wearing them anymore—it's all On and Hoka. Did these new brands actually steal Nike's lunch? Is Nike at a 5-year low an incredible bargain or a trap?",
    asOfDate: "2024-07-05",
    dataset: {
      peerTickers: ["DECK", "ONON", "LULU"],
      searchTopics: ["nike", "nke", "deckers", "hoka", "on holding", "on running", "onon", "athleisure", "competitor", "brand", "growth"],
    },
    latentIntent:
      "The retail investor infers industry disruption from everyday foot traffic. The agent must identify the undisclosed competitor equities: Deckers ($DECK, parent of Hoka) and On Holding ($ONON). It must compare revenue growth rates, DTC margin dynamics, and inventory turnover to determine whether Nike's low P/E represents a value trap versus a cyclical turnaround.",
    expectedEntities: [
      { label: "Nike", aliases: ["NKE", "NIKE"] },
      { label: "Deckers (Hoka)", aliases: ["DECK", "DECKERS"] },
      { label: "On Holding", aliases: ["ONON", "ON HOLDING", "ON RUNNING"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Map 'Hoka' to $DECK and 'On' to $ONON; reframe the observation into a structural competitive moat erosion and market share loss analysis.",
      dataGroundingCriteria:
        "Compare YoY revenue growth and inventory metrics between NKE (-2% decline and guidance cut) vs DECK (+20%+ with Hoka +34%) and ONON (+25%+).",
      financialReasoningCriteria:
        "Explain why a historically low P/E multiple can be a value trap when wholesale relationships weaken, innovation lags, and competitors capture high-end running market share.",
      retailClarityCriteria:
        "Deliver a structured comparison table, explain retail turnaround hurdles, and caution against blind dip-buying without catalyst visibility.",
    },
  },
  {
    id: "retail-03-nuclear-thematic-purity",
    category: "thematic_purity",
    title: "AI Power & Nuclear Thematic Purity (CEG/VST vs CCJ/SMR)",
    prompt:
      "Everyone says AI data centers will break the power grid and nuclear energy is the only solution. I want to bet big on nuclear, but which companies are actually cashing real checks from Big Tech right now instead of just peddling PowerPoint hype?",
    asOfDate: "2024-09-23",
    dataset: {
      peerTickers: ["VST", "TLN", "SMR", "OKLO", "CCJ", "BWXT", "LEU", "GEV", "VRT"],
      searchTopics: ["constellation", "ceg", "talen", "tln", "vistra", "vst", "three mile island", "nuclear", "smr", "uranium", "power deal", "restart", "reactor", "utility"],
    },
    latentIntent:
      "The retail investor seeks pure-play exposure to the AI power thematic trade but lacks supply chain depth. The agent must distinguish operational independent power producers with signed hyperscaler PPAs (Constellation Energy $CEG, Vistra $VST, Talen $TLN) from cyclical uranium miners ($CCJ) and pre-revenue, speculative small modular reactor startups ($OKLO, $SMR).",
    expectedEntities: [
      { label: "Constellation Energy", aliases: ["CEG", "CONSTELLATION"] },
      { label: "Vistra / Talen", aliases: ["VST", "VISTRA", "TLN", "TALEN"] },
    ],
    requiresMathCalculation: false,
    rubric: {
      intentScoreCriteria:
        "Identify the September 2024 Microsoft-Constellation 20-year PPA reopening Three Mile Island; separate immediate commercial cash-flow generators from early-stage concept plays.",
      dataGroundingCriteria:
        "Cite commercial PPA contract terms, capacity commitments (e.g. 835 MW for CEG), and differentiate from pre-revenue SMR balance sheets.",
      financialReasoningCriteria:
        "Break down the value chain into operational nuclear fleets (high power premiums), uranium feedstock (commodity cycle), and advanced SMRs (multi-year regulatory and dilution risk).",
      retailClarityCriteria:
        "Provide a clear thematic categorization table and warn against speculative penny-stock hype lacking commercial deployment timelines.",
    },
  },
  {
    id: "retail-04-dividend-yield-trap",
    category: "dividend_trap",
    title: "Covered Call Yield Trap & NAV Decay (TSLY / MSTY)",
    prompt:
      "I'm thinking of putting $500,000 of my savings into those 50%+ yield ETFs like TSLY or MSTY so I can collect over $20,000 a month in distributions. Is this a safe passive income strategy, or what's the catch?",
    asOfDate: "2024-06-15",
    dataset: {
      peerTickers: ["TSLA", "MSTR", "IBIT"],
      searchTopics: ["tsly", "msty", "yieldmax", "covered call", "option income", "return of capital", "distribution", "fees", "yield"],
      sourceMaterials: "retail-04",
    },
    latentIntent:
      "The investor is lured by astronomical distribution rates and is treating them as bond-like yields. The agent must use the prospectuses and the June 5, 2024 distribution announcement available by the cutoff, separate distribution rate from total return, explain the funds' option-income strategies and path-dependent payoff, and say that the tax character of the June 7 distribution cannot be confirmed from then-available sources. It must not claim a specific return-of-capital share or assert that every return-of-capital distribution is automatically destructive or that NAV decay is inevitable in every path.",
    expectedEntities: [
      { label: "TSLY", aliases: ["TSLY", "YIELDMAX"] },
      { label: "MSTY", aliases: ["MSTY"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Diagnose the retail misconception that 50%+ yield equals safe 'yield', clarifying that total return equals capital appreciation plus distributions.",
      dataGroundingCriteria:
        "Use the funds' dated prospectuses and the June 5, 2024 issuer distribution announcement to identify option-income mechanics, fees, distribution variability and the announced payouts. Explain that the stated distribution rate is not total return and distributions may include ordinary dividends, capital gains or return of capital; do not assign a specific tax character or return-of-capital percentage to the June 7 payment without a notice available by the cutoff. Distinguish tax classification from economic loss.",
      financialReasoningCriteria:
        "Calculate the user's proposed monthly cash flow and show at least three total-return paths, including the effect of capped upside, underlying drawdowns, fees and reinvestment; avoid claiming one path is guaranteed.",
      retailClarityCriteria:
        "Directly debunk the 'perpetual money machine' belief, showing scenarios where principal shrinks faster than cash distributed, and outline safer income alternatives.",
    },
  },
  {
    id: "retail-05-intel-value-trap",
    category: "value_trap",
    title: "Turnaround vs Value Trap (Intel Capex & FCF Drain)",
    prompt:
      "Intel's price-to-book ratio is at rock bottom and the US government is handing them billions in CHIPS Act subsidies. Warren Buffett says 'be greedy when others are fearful.' Should I put my life savings into an INTC turnaround?",
    asOfDate: "2024-08-05",
    dataset: {
      peerTickers: ["NVDA", "AMD", "TSM", "SMH"],
      searchTopics: ["intel", "intc", "foundry", "18a", "chips act", "capex", "free cash flow", "layoffs", "manufacturing", "subsidy"],
    },
    latentIntent:
      "The retail investor uses famous quotes to justify high-risk bottom-fishing based on trailing book value and headline subsidies. The agent must reveal catastrophic operational headwinds: IFS foundry operating losses ($2.8B/quarter), deep negative free cash flow driven by massive Capex ($11B+), dividend suspension, and execution risks on the 18A node.",
    expectedEntities: [
      { label: "Intel", aliases: ["INTC", "INTEL"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Contextualize the August 2024 Q2 earnings collapse (dividend elimination, 15% layoffs) and challenge the simplistic low-P/B turnaround thesis.",
      dataGroundingCriteria:
        "Cite cash flow statement figures from EDGAR showing negative quarterly free cash flow, Foundry segment losses, and multi-billion capital expenditure run-rates.",
      financialReasoningCriteria:
        "Demonstrate why capital-intensive manufacturing makes low P/B deceptive, clarify that subsidies are milestone-reimbursements rather than free cash, and calculate opportunity costs.",
      retailClarityCriteria:
        "Vigorously caution against concentrating life savings in turnaround plays, providing tangible operational milestones needed before re-evaluating.",
    },
  },
  {
    id: "retail-06-mstr-proxy-leverage",
    category: "proxy_leverage",
    title: "Leveraged Proxy & Balance Sheet Leverage (MSTR vs Spot BTC)",
    prompt:
      "Spot Bitcoin ETFs charge annual expense ratios, but MicroStrategy stock seems to surge way harder than Bitcoin anyway. Shouldn't I just go all-in on MSTR instead? What happens if crypto enters a brutal winter—will MicroStrategy go bankrupt?",
    asOfDate: "2024-11-25",
    dataset: {
      peerTickers: ["BTC-USD", "IBIT", "COIN", "TSLA"],
      searchTopics: ["microstrategy", "mstr", "bitcoin", "btc", "convertible debt", "mnav", "premium", "leverage", "purchases"],
    },
    latentIntent:
      "The retail investor treats MSTR as a free-fee leveraged Bitcoin surrogate, unaware of the net asset value (mNAV) premium (trading at ~2.0x-2.5x the value of its BTC holdings) and convertible debt dynamics. The investor also harbors exaggerated fears of immediate bankruptcy during a downturn.",
    expectedEntities: [
      { label: "MicroStrategy", aliases: ["MSTR", "MICROSTRATEGY"] },
      { label: "Bitcoin", aliases: ["BTC", "BITCOIN"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Analyze MSTR as an operating company running a debt-financed Bitcoin treasury reserve; address both the valuation premium and liquidation/bankruptcy concerns.",
      dataGroundingCriteria:
        "Extract MSTR's total Bitcoin holdings (~331k BTC as of Nov 2024), calculate implied mNAV per share, and reference debt maturities from SEC filings.",
      financialReasoningCriteria:
        "Demonstrate how reflexivity expands premiums in bull markets and compresses them in bear markets; explain that unsecured zero/low-coupon convertible notes prevent immediate margin calls but carry long-term share dilution risk.",
      retailClarityCriteria:
        "Demystify the 'buying $1 of Bitcoin for $2.50' premium reality in accessible terms while dispelling immediate liquidation panics.",
    },
  },
  {
    id: "retail-09-narrative-factcheck-apple",
    category: "narrative_factcheck",
    title: "Narrative Fact-Checking: Apple AI Slowdown & Buffett Selling",
    prompt:
      "Everyone online is saying Apple has completely lost the AI race, iPhone 16 is a flop, and even Warren Buffett sold half his Apple position. Is Apple becoming the next Nokia?",
    asOfDate: "2024-08-06",
    dataset: {
      peerTickers: ["MSFT", "GOOGL", "AMZN", "META"],
      searchTopics: ["apple", "aapl", "berkshire", "buffett", "iphone 16", "apple intelligence", "services", "reduction", "ai"],
    },
    latentIntent:
      "The investor is panicked by social-media claims that mix one real disclosure with one claim that was impossible to verify on the as-of date. Berkshire's Q2 filing disclosed a large Apple stake reduction, but iPhone 16 had not launched by August 6, 2024, so calling it a flop is look-ahead speculation. The agent must separate known facts, plausible concerns and unknowable claims before reviewing Apple's services economics and capital returns; it must not invent Buffett's motive.",
    expectedEntities: [
      { label: "Apple", aliases: ["AAPL", "APPLE"] },
      { label: "Berkshire / Buffett", aliases: ["BUFFETT", "BERKSHIRE"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Separate the real Berkshire stake reduction from the temporally impossible iPhone 16 flop claim, then test the broader Nokia analogy with primary financial facts.",
      dataGroundingCriteria:
        "Cite EDGAR financials for Services revenue ($24.2B record, 74% gross margin) and quarterly capital return ($25B+ repurchases).",
      financialReasoningCriteria:
        "Contrast platform/installed-base economics with handset disruption risk and distinguish disclosed facts from possible explanations for Berkshire's sale; do not present tax or concentration motives as known without evidence.",
      retailClarityCriteria:
        "Deliver a calm, evidence-based fact-check that acknowledges legitimate AI rollout pacing while debunking existential collapse hype.",
    },
  },
  {
    id: "retail-10-smci-accounting-red-flag",
    category: "accounting_red_flag",
    title: "Meme/Hype Stock Accounting Red Flag vs Dip Buying (SMCI)",
    prompt:
      "My friends were bragging about making a fortune on Super Micro Computer servers, but now the stock has crashed over 50% in just a few days. Is this an insane dip-buying opportunity or what?",
    asOfDate: "2024-10-31",
    dataset: {
      peerTickers: ["NVDA", "AMD", "DELL"],
      searchTopics: ["super micro", "supermicro", "smci", "ernst", "young", "auditor", "10-k", "resignation", "listing", "delayed filing", "accounting"],
    },
    latentIntent:
      "The investor suffers from anchoring bias, equating a severe price drop with a discount. The agent must identify $SMCI and the Ernst & Young resignation disclosed on October 30, 2024, the delayed 10-K and the resulting reporting/listing uncertainty. It should distinguish severe evidence-reliability risk from a proven fraud conclusion and date any exchange-compliance deadline it discusses.",
    expectedEntities: [
      { label: "Super Micro Computer", aliases: ["SMCI", "SUPER MICRO"] },
    ],
    requiresMathCalculation: false,
    rubric: {
      intentScoreCriteria:
        "Identify Super Micro Computer ($SMCI) and the October 30, 2024 Ernst & Young auditor resignation 8-K filing.",
      dataGroundingCriteria:
        "Directly quote the 8-K disclosure language where EY states it can no longer rely on management's representations and will not be associated with the financial statements.",
      financialReasoningCriteria:
        "Explain why an auditor resignation and overdue audited statements make ordinary valuation inputs unusually unreliable; distinguish filing delinquency and possible delisting from an inevitable delisting or a proven fraud conclusion.",
      retailClarityCriteria:
        "Give a calm, unmistakable explanation of the governance and evidence risk, list the filings and remediation milestones that would reduce uncertainty, and avoid a buy or sell command.",
    },
  },

  // Harness task definitions (report delivery, portfolio fit, figures, pre-open timing).

  {
    id: "retail-11-nike-earnings-review-report",
    category: "report_delivery",
    title: "Report Delivery Through a Skill (Nike FY24 Q4)",
    skill: "earnings-review",
    prompt:
      "Nike dropped their numbers last night and my account is bleeding this morning. Can you put together a proper write-up of the quarter so I can actually understand what happened?",
    asOfDate: "2024-06-28",
    dataset: {
      peerTickers: ["DECK", "ONON", "LULU"],
      searchTopics: ["nike", "nke", "earnings", "guidance", "wholesale", "direct", "price reaction", "next day"],
    },
    latentIntent:
      "The user asked for a document, not a chat answer, and invoked a skill that promises one. The agent must follow the earnings-review procedure, locate the June 27 2024 8-K and read Exhibit 99.1 for the FY24 Q4 results, and deliver through a single create_report call with template earnings-review carrying all five required sections — results vs expectations, guidance, drivers, reaction, stance — every numeric cell backed by an evidence entry. The substance is the guidance cut: a revenue decline guided for FY25 against a quarter whose EPS cleared consensus, which is why the stock fell roughly 20%. The chat reply must be two or three lines, never the report pasted back.",
    expectedEntities: [{ label: "Nike", aliases: ["NKE", "NIKE"] }],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Recognize that the request is for a full earnings write-up and follow the earnings-review skill end to end, rather than answering conversationally or improvising a different structure.",
      dataGroundingCriteria:
        "Take revenue, EPS, segment and guidance figures from the June 27 2024 8-K Exhibit 99.1 with its filing date and accession, and label every EPS figure GAAP or adjusted.",
      financialReasoningCriteria:
        "Separate the beat on the reported quarter from the FY25 guidance cut, quantify the guided revenue decline against prior guidance and consensus, and explain why the guide, not the print, moved the stock.",
      retailClarityCriteria:
        "Deliver exactly one valid report with all five required sections and a two-or-three-line chat summary; no pasted tables in chat, no price target, no buy or sell call.",
    },
  },
  {
    id: "retail-12-concentration-profile-fit",
    category: "profile_fit",
    title: "Concentration Against a Declared Profile (holdings fixture)",
    prompt:
      "Most of my savings are sitting in a handful of tech names and a buddy keeps telling me to add one of those leveraged ETFs to catch up. Am I taking way too much risk here?",
    asOfDate: "2024-09-20",
    dataset: {
      peerTickers: ["AMZN", "GOOGL", "META", "AVGO", "SMH"],
      searchTopics: ["apple", "aapl", "microsoft", "msft", "nvidia", "nvda", "voo", "concentration", "portfolio", "weight", "sector"],
      sourceMaterials: "retail-12",
    },
    profile: {
      experience: { level: "beginner", role: "individual" },
      objectives: { primary: "preservation", horizon: "1_3y" },
      risk: { tolerance: "low", capacityForLoss: "low", liquidityNeeds: "high" },
      constraints: { allowedInstruments: ["stocks", "etfs"] },
      jurisdiction: { country: "US", baseCurrency: "USD" },
      style: { depth: "brief" },
    },
    profilePrompt: "retail-12.md",
    holdings: [
      { accountId: "bench-taxable", symbol: "NVDA", kind: "equity", quantity: 260, averagePrice: 42.5, currency: "USD", acquiredAt: "2023-08-14" },
      { accountId: "bench-taxable", symbol: "AAPL", kind: "equity", quantity: 55, averagePrice: 168.2, currency: "USD", acquiredAt: "2023-02-06" },
      { accountId: "bench-taxable", symbol: "MSFT", kind: "equity", quantity: 18, averagePrice: 372.4, currency: "USD", acquiredAt: "2023-11-27" },
      { accountId: "bench-taxable", symbol: "VOO", kind: "etf", quantity: 12, averagePrice: 455.1, currency: "USD", acquiredAt: "2024-01-16" },
    ],
    latentIntent:
      "The user believes they hold 'a handful of tech names' and does not know how lopsided the portfolio is. The agent must read the holdings with portfolio_get rather than guessing, value and weight them from fetched prices through the calculator, and find that one position dominates. It must then read the declared profile — low risk tolerance, low capacity for loss, a one-to-three-year horizon and an instrument list that allows only stocks and ETFs — and say plainly that leverage is outside what the user declared, that four positions in one end market is one bet rather than four, and that a short horizon with high liquidity needs sits badly with that concentration. Observations and questions only; no rebalancing instruction and no target weight.",
    expectedEntities: [{ label: "NVIDIA", aliases: ["NVDA", "NVIDIA"] }],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Read the actual holdings instead of answering in the abstract, surface that the portfolio is dominated by one name, and connect the answer to the profile fields the user declared rather than to a generic risk lecture.",
      dataGroundingCriteria:
        "Cite position quantities and cost basis as holdings entries and prices as fetched market data, with the trading date on every quote; state clearly that gain against cost is not a return.",
      financialReasoningCriteria:
        "Compute weights, the top-position and top-three share and a concentration measure from the real positions, and recognize that several large-cap technology names are correlated exposure rather than diversification.",
      retailClarityCriteria:
        "Name the leveraged-ETF suggestion as outside the user's declared instruments without moralizing, phrase every finding as an observation or a question, and give no rebalancing instruction, target weight or buy or sell call.",
    },
  },
  {
    id: "retail-13-semis-figure-survival",
    category: "figure_survival",
    title: "Cross-Turn Figure Recovery (AI semis, two turns)",
    prompt:
      "I'm trying to get my head around the AI chip names before I do anything. Can you pull the last eight quarters of revenue, gross margin and diluted EPS for Nvidia, AMD and Intel and walk me through how each one has trended? I want the whole picture, not a summary.",
    followUpPrompts: [
      "Quick check before I forget — what exactly was AMD's revenue in the most recent quarter you pulled, and what was Intel's gross margin in that same quarter? Just those two numbers, and tell me where each came from.",
    ],
    asOfDate: "2024-11-22",
    dataset: {
      peerTickers: ["AMD", "NVDA", "INTC", "TSM", "AVGO"],
      searchTopics: ["nvidia", "nvda", "amd", "intel", "intc", "semiconductor", "revenue", "cash flow", "filing", "margin"],
    },
    latentIntent:
      "The first turn is deliberately data-heavy: three companies, three statements each, eight quarters. The second answer is the one graded, and it must recover two exact figures from the first turn's data with their evidence still attached, whether or not the selected model compacted its context. The failure this catches is a model that recalls a rounded, drifted or invented number across turns, or that re-fetches and quietly answers from a different period than the one it showed. Re-reading the exact slice through evidence_get is the correct behaviour; answering from memory is not.",
    expectedEntities: [
      { label: "NVIDIA", aliases: ["NVDA", "NVIDIA"] },
      { label: "AMD", aliases: ["AMD", "ADVANCED MICRO"] },
      { label: "Intel", aliases: ["INTC", "INTEL"] },
    ],
    requiresMathCalculation: true,
    rubric: {
      intentScoreCriteria:
        "Answer the follow-up with exactly the two figures asked for, taken from the same periods presented in the first turn, and say which filing each came from.",
      dataGroundingCriteria:
        "Both figures match the as-reported XBRL values to the precision shown earlier and carry their evidence, with the fiscal quarter labelled; evidence_get successfully re-reads the exact slice before the answer rather than relying on memory.",
      financialReasoningCriteria:
        "The first turn computes growth and margins through the calculator over eight quarters per company and identifies each company's inflection; the second turn keeps the fiscal-period alignment straight across three different fiscal calendars.",
      retailClarityCriteria:
        "The follow-up answer is short and direct as asked, states plainly if a figure could not be recovered rather than approximating it, and gives no buy or sell call.",
    },
  },
  {
    id: "retail-14-apple-pre-open-timing",
    category: "pre_open_timing",
    title: "Time-Sensitive Question Before the Open (Apple, 08:15 ET)",
    prompt:
      "It's early and I'm seeing headlines everywhere that Apple reports today. I've got an order queued up for the open — what do I need to know before the bell?",
    asOfDate: "2024-10-31",
    asOfTime: "08:15",
    dataset: {
      peerTickers: ["MSFT", "GOOGL", "AMZN"],
      searchTopics: ["apple", "aapl", "earnings", "pre-market", "market open", "october 31", "schedule", "closed", "previous close", "timing"],
    },
    latentIntent:
      "Asked at 08:15 New York time on 31 October 2024, the market is shut: the last completed session was 30 October, no price has printed today, and Apple's FY24 Q4 results are due after today's close, so nothing about the quarter is knowable yet. The agent must say all three things, label the most recent quote as the previous session's close rather than a current price, and refuse to characterize results that have not been released. The failure this catches is an answer that reads yesterday's close as live, or that discusses the print as if it were already out.",
    expectedEntities: [{ label: "Apple", aliases: ["AAPL", "APPLE"] }],
    requiresMathCalculation: false,
    rubric: {
      intentScoreCriteria:
        "State that the market has not opened, that the last completed session was the previous trading day, and that Apple reports after today's close so the quarter is still unknown.",
      dataGroundingCriteria:
        "Every price carries its trading date and is labelled a previous close, not a current price; the report timing is confirmed from the company's own filings or a source that cites the company, never inferred from last year's calendar.",
      financialReasoningCriteria:
        "Frame the setup as expectations and what would change them — the guide, services growth, iPhone units — rather than as an outcome, and explain why the print's direction cannot be known before the release.",
      retailClarityCriteria:
        "Answer the queued order without telling the user to place or cancel it, note plainly that holding into a print is a decision about uncertainty, and give no price prediction or buy or sell call.",
    },
  },
];

/** The benchmark's twelve tasks: fully historical 2024 retail-investor scenarios. */
function contracts(task: Omit<EvalTask, "requiredEvidence" | "contracts">): EvalTaskContract[] {
  switch (task.id) {
    case "retail-01-nvda-beat-and-drop":
      return [{ id: "guided-growth", kind: "verified_calculation", label: "Calculate NVIDIA's guided sequential revenue growth from its Q2 FY25 release", points: 8,
        target: { kind: "filing_guidance_growth", url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581024000262/q2fy25pr.htm", currentRevenue: 30_040_000_000, guidedRevenue: 32_500_000_000 }, tolerance: 0.3 }];
    case "retail-02-nike-moat-erosion":
      return [{ id: "deck-growth", kind: "verified_calculation", label: "Calculate Deckers FY2024 revenue growth from the correct fiscal years", points: 8,
        target: { kind: "fact_growth", ticker: "DECK", metric: "revenue", periodType: "annual", currentPeriod: "2024-03-31", priorPeriod: "2023-03-31" }, tolerance: 0.2 }];
    case "retail-03-nuclear-thematic-purity":
      return [
        { id: "ceg-ppa", kind: "required_evidence_cited", label: "Cite the Constellation-Microsoft PPA announcement", points: 4, requirementLabels: ["Constellation-Microsoft Crane PPA announcement"], match: "all" },
        { id: "tln-ppa", kind: "required_evidence_cited", label: "Cite the Talen-AWS PPA filing", points: 4, requirementLabels: ["Talen-AWS data-center PPA (Q2 2024 10-Q)"], match: "all" },
      ];
    case "retail-04-dividend-yield-trap":
      return [{ id: "income-rate", kind: "verified_calculation", label: "Annualize the investor's $20,000 monthly target against $500,000 principal", points: 8,
        target: { kind: "annual_income_rate", principal: 500_000, monthlyIncome: 20_000 }, tolerance: 0.1 }];
    case "retail-05-intel-value-trap":
      return [{ id: "intel-h1-fcf", kind: "verified_calculation", label: "Sum Intel's first-half 2024 free cash flow from its two quarterly facts", points: 8,
        target: { kind: "fact_sum", ticker: "INTC", metric: "freeCashFlow", periodType: "quarterly", periods: ["2024-03-30", "2024-06-29"] }, tolerance: 5_000_000 }];
    case "retail-06-mstr-proxy-leverage":
      return [
        { id: "btc-holdings-filing", kind: "required_evidence_cited", label: "Cite the November 25 MSTR holdings 8-K", points: 4, requirementLabels: ["MSTR bitcoin holdings as of Nov 2024 (Nov 25 8-K)"], match: "all" },
        { id: "convertible-filing", kind: "required_evidence_cited", label: "Cite an official MSTR filing with the announced or final convertible-note terms", points: 4,
          requirementLabels: ["MSTR $2.6B 0% 2029 convertible notes (Nov 20 8-K)", "MSTR bitcoin holdings as of Nov 2024 (Nov 25 8-K)"], match: "any" },
      ];
    case "retail-09-narrative-factcheck-apple":
      return [{ id: "apple-revenue-growth", kind: "verified_calculation", label: "Calculate Apple's Q3 FY24 revenue growth against the year-earlier quarter", points: 8,
        target: { kind: "fact_growth", ticker: "AAPL", metric: "revenue", periodType: "quarterly", currentPeriod: "2024-06-29", priorPeriod: "2023-07-01" }, tolerance: 0.2 }];
    case "retail-10-smci-accounting-red-flag":
      return [
        { id: "ey-resignation", kind: "required_evidence_cited", label: "Cite SMCI's EY resignation 8-K", points: 4, requirementLabels: ["SMCI 8-K Item 4.01: EY resignation"], match: "all" },
        { id: "delayed-filing", kind: "required_evidence_cited", label: "Cite SMCI's overdue 10-K disclosure", points: 4, requirementLabels: ["SMCI delayed 10-K / Nasdaq non-compliance"], match: "all" },
      ];
    case "retail-11-nike-earnings-review-report":
      return [{ id: "earnings-report", kind: "report", label: "Agent-created earnings review with all required sections", points: 8,
        template: "earnings-review", sections: ["Results vs expectations", "Guidance", "Drivers", "Reaction", "Stance"], requireAgentDelivery: true }];
    case "retail-12-concentration-profile-fit":
      return [
        { id: "portfolio-read", kind: "required_evidence_used", label: "Read and use the seeded holdings", points: 4, requirementLabels: ["Declared holdings read and cited"] },
        { id: "top-weight", kind: "verified_calculation", label: "Calculate the largest position weight from all four dated quotes and declared quantities", points: 4,
          target: { kind: "portfolio_top_weight", quoteDate: "2024-09-20" }, tolerance: 0.2 },
      ];
    case "retail-13-semis-figure-survival": {
      const labels = ["AMD revenue, latest quarter (2024-09-28)", "Intel gross margin, same quarter (2024-09-28)"];
      return [
        { id: "evidence-reread", kind: "reread_required_evidence", label: "Recover the exact AMD and Intel facts from their evidence ids or an exact re-fetch", points: 4, requirementLabels: labels },
        { id: "exact-figures", kind: "required_evidence_used", label: "Use both requested period-specific figures", points: 4, requirementLabels: labels },
      ];
    }
    case "retail-14-apple-pre-open-timing":
      return [
        { id: "dated-quote", kind: "dated_quote", label: "Use Apple's October 30 prior close, not a later quote", points: 4, ticker: "AAPL", date: "2024-10-30" },
        { id: "no-lookahead", kind: "no_lookahead", label: "Use no post-cutoff evidence", points: 4 },
      ];
    default:
      throw new Error(`No deterministic task contracts defined for ${task.id}.`);
  }
}

export const RETAIL_EVAL_TASKS: EvalTask[] = TASKS.map((task) => ({
  ...task,
  requiredEvidence: evidenceRequirementsForTask(task.id),
  contracts: contracts(task),
}));
