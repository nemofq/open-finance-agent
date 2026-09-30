import { describe, expect, it } from "vitest";
import { serverClass } from "./server-class";

describe("serverClass", () => {
  it("reads a data connection as data", () => {
    expect(serverClass({ class: "data" })).toBe("data");
  });

  it("reads a server with no class, or any other value, as a general tool", () => {
    expect(serverClass({})).toBe("general");
    expect(serverClass({ class: "general" })).toBe("general");
    expect(serverClass({ class: "Data" })).toBe("general");
  });
});
