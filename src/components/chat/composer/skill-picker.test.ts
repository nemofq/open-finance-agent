import { describe, expect, it } from "vitest";
import { pickerItems, skillFragment } from "./skill-picker";

const SKILLS = [
  { name: "earnings-review", description: "Read the print" },
  { name: "compare", description: "Two companies side by side" },
];

const COMMANDS = [{ name: "compact", description: "Summarise the chat so far" }];

describe("pickerItems", () => {
  it("lists skills alone, ungrouped, for the Skills button menu", () => {
    expect(pickerItems(SKILLS, COMMANDS, null)).toEqual([
      { id: "earnings-review", primary: "/earnings-review", secondary: "Read the print", group: undefined },
      { id: "compare", primary: "/compare", secondary: "Two companies side by side", group: undefined },
    ]);
  });

  it("groups commands above skills for a typed fragment", () => {
    const items = pickerItems(SKILLS, COMMANDS, "comp");
    expect(items.map((item) => [item.group, item.id])).toEqual([
      ["Commands", "compact"],
      ["Skills", "compare"],
    ]);
  });

  it("omits a group with no matches", () => {
    expect(pickerItems(SKILLS, COMMANDS, "ear").map((item) => item.group)).toEqual(["Skills"]);
    expect(pickerItems(SKILLS, COMMANDS, "compa").map((item) => item.id)).toEqual([
      "compact",
      "compare",
    ]);
    expect(pickerItems(SKILLS, COMMANDS, "zzz")).toEqual([]);
  });

  it("shows everything for a bare slash", () => {
    expect(pickerItems(SKILLS, COMMANDS, skillFragment("/") ?? "x")).toHaveLength(3);
  });
});
