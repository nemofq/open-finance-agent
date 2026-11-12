import type { Api, AssistantMessage, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/lib/config/schema";
import { resolveModel } from "@/lib/llm";
import { streamModel } from "@/lib/llm/stream";
import { evaluateWithJudge, type JudgeInput } from "./judge";
import { RETAIL_EVAL_TASKS } from "../tasks";
import type { EvalTask, RubricVerdict } from "../types";

vi.mock("@/lib/llm", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/llm/stream", () => ({ streamModel: vi.fn() }));

function valid(task: EvalTask, verdict: RubricVerdict = "met") {
  return {
    items: task.rubricItems.map((item) => ({ id: item.id, verdict, rationale: "x", answerEvidence: "x", evidenceIds: [] })),
    overallVerdict: "x",
  };
}

const input: JudgeInput = {
  task: RETAIL_EVAL_TASKS[0],
  toolCalls: [],
  evidence: [],
  checks: [],
  finalAssistantText: "An answer.",
};

const JUDGE = { provider: "p", model: "judge" };

/** Replies in turn: the first to the grading request, the second to the format repair. */
function replies(...texts: string[]): void {
  for (const text of texts) {
    const message = { content: [{ type: "text", text }], stopReason: "stop" } as unknown as AssistantMessage;
    vi.mocked(streamModel).mockReturnValueOnce({ result: async () => message } as ReturnType<typeof streamModel>);
  }
}

const sentOptions = (): (SimpleStreamOptions | undefined)[] => vi.mocked(streamModel).mock.calls.map((call) => call[3]);

beforeEach(() => {
  vi.mocked(streamModel).mockReset();
  vi.mocked(resolveModel).mockResolvedValue({
    ok: true,
    provider: { id: "p", type: "openai-compatible", name: "p", apiKey: "", baseUrl: "http://127.0.0.1:9999/v1", models: [] },
    info: { id: "judge", name: "judge", contextLength: 0, pricing: { input: 0, output: 0 }, supportsReasoning: true, supportsImages: false },
    model: { id: "judge", provider: "p", reasoning: true } as Model<Api>,
  });
});

describe("the judge's thinking level", () => {
  it("is sent with the grading request and the format repair alike", async () => {
    replies("not json", JSON.stringify(valid(input.task)));
    const result = await evaluateWithJudge(input, defaultConfig(), JUDGE, "xhigh");
    expect(result.repairAttempted).toBe(true);
    expect(sentOptions().map((options) => options?.reasoning)).toEqual(["xhigh", "xhigh"]);
  });

  it("sends no reasoning without --judge-thinking, or at off, as runs always have", async () => {
    replies(JSON.stringify(valid(input.task)), JSON.stringify(valid(input.task)));
    await evaluateWithJudge(input, defaultConfig(), JUDGE);
    await evaluateWithJudge(input, defaultConfig(), JUDGE, "off");
    expect(sentOptions()).toHaveLength(2);
    for (const options of sentOptions()) expect(options).not.toHaveProperty("reasoning");
  });
});

describe("repeated grades and the judge's account", () => {
  const refusal = (): void => {
    const message = { content: [], stopReason: "error", errorMessage: "Codex error: The usage limit has been reached" } as unknown as AssistantMessage;
    vi.mocked(streamModel).mockReturnValueOnce({ result: async () => message } as ReturnType<typeof streamModel>);
  };

  it("fails the whole answer when the account refuses one of its votes, instead of scoring it from the rest", async () => {
    replies(JSON.stringify(valid(input.task)), JSON.stringify(valid(input.task)));
    refusal();
    const result = await evaluateWithJudge(input, defaultConfig(), JUDGE, undefined, 3);
    expect(result.error).toContain("usage limit has been reached");
    expect(result.totalJudgeScore).toBe(0);
  });

  it("asks for no further votes once the account has refused", async () => {
    refusal();
    const result = await evaluateWithJudge(input, defaultConfig(), JUDGE, undefined, 3);
    expect(result.error).toContain("usage limit");
    expect(streamModel).toHaveBeenCalledTimes(1);
  });

  it("still scores an answer from a majority when a vote fails for a reason of its own", async () => {
    replies(JSON.stringify(valid(input.task)), "not json", "still not json", JSON.stringify(valid(input.task)));
    const result = await evaluateWithJudge(input, defaultConfig(), JUDGE, undefined, 3);
    expect(result.error).toBeUndefined();
    expect(result.totalJudgeScore).toBe(60);
  });
});

