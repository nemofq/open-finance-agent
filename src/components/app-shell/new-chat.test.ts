import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const confirmLeave = vi.fn(() => true);

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/shared/use-unsaved-changes", () => ({ confirmLeave }));
// Run the hook outside React: its callback is used as is.
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));

const { useNewChat } = await import("./new-chat");

beforeEach(() => confirmLeave.mockReturnValue(true));
afterEach(() => vi.clearAllMocks());

describe("useNewChat", () => {
  it("opens a new chat when nothing unsaved is in the way", () => {
    const onNavigate = vi.fn();
    useNewChat(onNavigate)();
    expect(onNavigate).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/chat/new");
  });

  it("stays put when the user keeps their unsaved settings", () => {
    confirmLeave.mockReturnValue(false);
    const onNavigate = vi.fn();
    useNewChat(onNavigate)();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
