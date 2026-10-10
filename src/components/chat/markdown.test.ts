import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, unwrapWholeFence } from "./markdown";
import { withTickerChips } from "@/components/market/ticker-chip";

describe("unwrapWholeFence", () => {
  it("unwraps a reply that is one markdown fence", () => {
    expect(unwrapWholeFence("```markdown\n# Title\n\n| a |\n```")).toBe("# Title\n\n| a |");
    expect(unwrapWholeFence("```\ntext\n```\n")).toBe("text");
  });
  it("leaves partial fences and real code blocks alone", () => {
    expect(unwrapWholeFence("Intro\n```ts\nx\n```")).toBe("Intro\n```ts\nx\n```");
    expect(unwrapWholeFence("```markdown\na\n```\nb\n```\n```")).toContain("b");
  });
});

describe("withTickerChips", () => {
  it("does not convert math formula variables like $$FV into ticker chips", () => {
    const result = withTickerChips("$$FV = 1{,}000{,}000 \\times (1.12)^{10} = 3{,}105{,}848$$");
    expect(result).toEqual(["$$FV = 1{,}000{,}000 \\times (1.12)^{10} = 3{,}105{,}848$$"]);
  });

  it("does not convert inline math variables like $FV$ or $PV$", () => {
    const result = withTickerChips("Where $FV$ is future value and $PV$ is present value");
    expect(result).toEqual(["Where $FV$ is future value and $PV$ is present value"]);
  });

  it("converts normal cashtags like $AAPL into ticker chips", () => {
    const result = withTickerChips("Check $AAPL now") as React.ReactNode[];
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("Check ");
    expect(React.isValidElement<{ symbol: string }>(result[1]) && result[1].props.symbol).toBe("AAPL");
    expect(result[2]).toBe(" now");
  });
});

describe("Markdown", () => {
  it("renders display math formula with KaTeX", () => {
    const html = renderToStaticMarkup(
      React.createElement(Markdown, null, "$$FV = 1{,}000{,}000 \\times (1.12)^{10} = 3{,}105{,}848$$"),
    );
    expect(html).toContain("katex");
    expect(html).toContain("1,000,000");
  });

  it("renders math markup that the imported KaTeX stylesheet styles", () => {
    const html = renderToStaticMarkup(React.createElement(Markdown, null, "$$a^2 + b^2$$"));
    // The first span inside .katex-html is the layout box; a renderer and stylesheet from
    // different KaTeX versions disagree on its class name.
    const box = /class="katex-html"[^>]*><span class="([^" ]+)"/.exec(html)?.[1];
    expect(box).toBeDefined();
    const css = readFileSync(createRequire(import.meta.url).resolve("katex/dist/katex.min.css"), "utf8");
    expect(css).toContain(`.${box}{`);
  });

  it("preserves price currency like $100 and cashtags alongside formulas", () => {
    const html = renderToStaticMarkup(
      React.createElement(Markdown, null, "Costs $100 per share. Check $AAPL.\n\n$$FV = PV(1+r)^n$$"),
    );
    expect(html).toContain("$100");
    expect(html).toContain("AAPL");
    expect(html).toContain("katex");
  });
});
