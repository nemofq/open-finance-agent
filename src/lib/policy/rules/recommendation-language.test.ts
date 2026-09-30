import { describe, expect, it } from "vitest";
import type { BeforeStopEvent } from "../events";
import { testContext } from "../testing";
import { findRecommendations, p11RecommendationWording } from "./recommendation-language";

function stop(text: string): BeforeStopEvent {
  return { stage: "before_stop", text, request: "" };
}

describe("P11 recommendation wording", () => {
  it("flags a buy call", () => {
    const verdict = p11RecommendationWording(stop("Given the setup, you should buy before earnings."), testContext());

    expect(verdict?.kind).toBe("flag");
    expect(verdict?.reason).toContain("you should buy");
  });

  it("flags position sizing advice", () => {
    const verdict = p11RecommendationWording(stop("Allocate 5% of your portfolio to it."), testContext());

    expect(verdict?.kind).toBe("flag");
  });

  it("leaves research wording alone", () => {
    const answer = "The setup rests on data-centre revenue; a buyer at this multiple is paying for FY27 growth.";

    expect(p11RecommendationWording(stop(answer), testContext())).toBeUndefined();
  });

  it("leaves an analyst rating being reported alone", () => {
    const answer = "Three analysts moved to a buy rating after the print, citing margin recovery.";

    expect(p11RecommendationWording(stop(answer), testContext())).toBeUndefined();
  });
});

describe("findRecommendations", () => {
  it("finds advice wording", () => {
    expect(findRecommendations("You should buy before the print.")).toEqual(["You should buy"]);
    expect(findRecommendations("I would recommend selling half.")).toEqual(["I would recommend selling"]);
    expect(findRecommendations("This is a strong buy.")).toEqual(["strong buy"]);
    expect(findRecommendations("Time to sell.")).toEqual(["Time to sell"]);
    expect(findRecommendations("Put 10% into it.")).toEqual(["Put 10% into"]);
  });

  it("leaves research wording alone", () => {
    expect(findRecommendations("The multiple already prices in FY27 growth.")).toEqual([]);
    expect(findRecommendations("Analysts moved to a buy rating after the print.")).toEqual([]);
  });

  it("returns the phrases in the order they appear", () => {
    expect(findRecommendations("Load up on it. You should buy now.")).toEqual([
      "Load up on",
      "You should buy",
      "buy now",
    ]);
  });
});
