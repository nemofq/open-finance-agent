import { describe, expect, it } from "vitest";
import { isShortcut } from "./use-shortcut";

const keys = { key: "b", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: null };

describe("isShortcut", () => {
  it("matches Ctrl and Cmd with the key", () => {
    expect(isShortcut({ ...keys, ctrlKey: true }, "b", true)).toBe(true);
    expect(isShortcut({ ...keys, metaKey: true, key: "B" }, "b", true)).toBe(true);
  });

  it("ignores the letter on its own and other modifier combinations", () => {
    expect(isShortcut(keys, "b", true)).toBe(false);
    expect(isShortcut({ ...keys, ctrlKey: true, shiftKey: true }, "b", true)).toBe(false);
    expect(isShortcut({ ...keys, metaKey: true, key: "k" }, "b", true)).toBe(false);
  });

  it("leaves the keystroke to whatever the user is typing in, when asked to", () => {
    const target = (element: object) => element as unknown as EventTarget;
    for (const element of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { isContentEditable: true }]) {
      expect(isShortcut({ ...keys, metaKey: true, target: target(element) }, "b", true)).toBe(false);
      expect(isShortcut({ ...keys, metaKey: true, target: target(element) }, "b", false)).toBe(true);
    }
    expect(isShortcut({ ...keys, metaKey: true, target: target({ tagName: "DIV" }) }, "b", true)).toBe(true);
  });
});
