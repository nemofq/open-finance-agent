import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmLeave, holdUnsavedChanges } from "./use-unsaved-changes";

const confirm = vi.fn(() => false);
const windowListeners = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
const documentListeners = { addEventListener: vi.fn(), removeEventListener: vi.fn() };

beforeEach(() => {
  vi.stubGlobal("window", { ...windowListeners, confirm });
  vi.stubGlobal("document", documentListeners);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("confirmLeave", () => {
  it("lets navigation through without asking when nothing is unsaved", () => {
    expect(confirmLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks while edits are held and follows the answer", () => {
    const release = holdUnsavedChanges();
    expect(confirmLeave()).toBe(false);
    confirm.mockReturnValueOnce(true);
    expect(confirmLeave()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    release();
    expect(confirmLeave()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

describe("holdUnsavedChanges", () => {
  it("installs the listeners once and removes them after the last release", () => {
    const releasePage = holdUnsavedChanges();
    const releaseDialog = holdUnsavedChanges();
    expect(windowListeners.addEventListener).toHaveBeenCalledTimes(1);
    expect(documentListeners.addEventListener).toHaveBeenCalledTimes(1);

    releaseDialog();
    expect(windowListeners.removeEventListener).not.toHaveBeenCalled();
    expect(confirmLeave()).toBe(false);

    releasePage();
    expect(windowListeners.removeEventListener).toHaveBeenCalledTimes(1);
    expect(documentListeners.removeEventListener).toHaveBeenCalledTimes(1);
    expect(confirmLeave()).toBe(true);
  });
});
