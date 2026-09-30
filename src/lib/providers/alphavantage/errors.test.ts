import { describe, expect, it } from "vitest";
import { alphaVantageProblem, assertNoProblem, restProblem } from "./errors";

/** What the MCP server returned when the free tier's per-minute limit was reached. */
const rateLimited = JSON.stringify({
  error: {
    type: "rate_limit",
    message:
      "Thank you for using Alpha Vantage! Please consider spreading out your free API calls over a longer period.",
  },
});

describe("alphaVantageProblem", () => {
  it("reads the MCP server's error envelope, type first", () => {
    expect(alphaVantageProblem(rateLimited)).toBe(
      "rate_limit: Thank you for using Alpha Vantage! Please consider spreading out your free API calls over a longer period.",
    );
  });

  it("accepts an envelope carrying only a message or only a type", () => {
    expect(alphaVantageProblem(JSON.stringify({ error: { message: "premium endpoint" } }))).toBe("premium endpoint");
    expect(alphaVantageProblem(JSON.stringify({ error: { type: "invalid_api_key" } }))).toBe("invalid_api_key");
    expect(alphaVantageProblem(JSON.stringify({ error: "bad symbol" }))).toBe("bad symbol");
  });

  it("reads the REST-style keys Alpha Vantage answers HTTP 200 with", () => {
    expect(alphaVantageProblem(JSON.stringify({ "Error Message": "Invalid API call." }))).toBe("Invalid API call.");
    expect(alphaVantageProblem(JSON.stringify({ Information: "Our standard API rate limit is 25 requests/day." }))).toContain(
      "25 requests/day",
    );
    expect(alphaVantageProblem(JSON.stringify({ Note: "Thank you for using Alpha Vantage!" }))).toContain(
      "Thank you for using",
    );
  });

  it("says nothing about a body that carries data", () => {
    expect(alphaVantageProblem(JSON.stringify({ "Time Series (Daily)": { "2025-06-30": { "4. close": "1" } } }))).toBeNull();
    expect(alphaVantageProblem("timestamp,open,high,low,close,volume\n2025-06-30,1,2,0.5,1.5,10")).toBeNull();
    expect(alphaVantageProblem("")).toBeNull();
  });

  it("ignores an `error` key that is not an envelope", () => {
    expect(alphaVantageProblem(JSON.stringify({ error: null }))).toBeNull();
    expect(alphaVantageProblem(JSON.stringify({ error: { code: 429 } }))).toBeNull();
  });
});

describe("assertNoProblem", () => {
  it("turns an in-band failure into a thrown error naming the function", () => {
    expect(() => assertNoProblem("TIME_SERIES_DAILY", rateLimited)).toThrow(
      /Alpha Vantage TIME_SERIES_DAILY failed — rate_limit: Thank you/,
    );
  });

  it("lets a real result through", () => {
    expect(() => assertNoProblem("GLOBAL_QUOTE", JSON.stringify({ "Global Quote": { "05. price": "1" } }))).not.toThrow();
  });
});

describe("restProblem", () => {
  it("reports an invalid request", () => {
    const body = JSON.stringify({ "Error Message": "Invalid API call. Please retry." });
    expect(restProblem(body)).toBe("Invalid API call. Please retry.");
  });

  it("reports a rate limit or invalid key", () => {
    const body = JSON.stringify({ Information: "Thank you for using Alpha Vantage! ... 25 requests per day" });
    expect(restProblem(body)).toContain("25 requests per day");
  });

  it("reports the legacy Note key", () => {
    expect(restProblem(JSON.stringify({ Note: "call frequency" }))).toBe("call frequency");
  });

  it("passes a normal payload through", () => {
    expect(restProblem(JSON.stringify({ "Global Quote": { "01. symbol": "IBM", "05. price": "243.2700" } }))).toBeNull();
    expect(restProblem("symbol,reportDate\nIBM,2026-10-22")).toBeNull();
  });

  it("detects the character-spread error a CSV endpoint returns", () => {
    const body = "symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\r\nI,n,f,o,r,m,a\r\n";
    expect(restProblem(body)).toContain("daily rate limit");
  });
});
