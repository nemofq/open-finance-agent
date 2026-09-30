import { describe, expect, it } from "vitest";
import { isCommand, parseCommand } from "./commands";

describe("parseCommand", () => {
  it("recognises /compact on its own", () => {
    expect(parseCommand("/compact")).toEqual({ name: "compact" });
    expect(parseCommand("  /compact  ")).toEqual({ name: "compact" });
  });

  it("takes the rest of the line as the focus", () => {
    expect(parseCommand("/compact the guidance debate")).toEqual({
      name: "compact",
      focus: "the guidance debate",
    });
    expect(parseCommand("/compact\nkeep the margin bridge")).toEqual({
      name: "compact",
      focus: "keep the margin bridge",
    });
  });

  it("leaves ordinary messages and other slash words alone", () => {
    expect(parseCommand("what does /compact do?")).toBeNull();
    expect(parseCommand("/compacting")).toBeNull();
    expect(parseCommand("/earnings-review $AAPL")).toBeNull();
    expect(parseCommand("")).toBeNull();
  });
});

describe("isCommand", () => {
  it("tells a built-in command from a skill name", () => {
    expect(isCommand("compact")).toBe(true);
    expect(isCommand("earnings-review")).toBe(false);
  });
});
