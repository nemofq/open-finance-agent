import type { Api, AssistantMessage, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@/lib/config/schema";
import { resolveModel } from "@/lib/llm";
import { streamModel } from "@/lib/llm/stream";
import { evaluateWithJudge, type JudgeInput } from "./judge";
import { RETAIL_EVAL_TASKS } from "../tasks";
import { BENCHMARK_VERSION } from "../types";

vi.mock("@/lib/llm", () => ({ resolveModel: vi.fn() }));
vi.mock("@/lib/llm/stream", () => ({ streamModel: vi.fn() }));

const VALID = {
  intentScore: 14,
  intentFeedback: "x",
  financialScore: 17,
  financialFeedback: "x",
  groundingScore: 12,
  groundingFeedback: "x",
  retailClarityScore: 9,
  retailClarityFeedback: "x",
  overallVerdict: "x",
};

const input: JudgeInput = {
  task: RETAIL_EVAL_TASKS[0],
  toolCalls: [],
  evidence: [],
  checks: [],
  finalAssistantText: "An answer.",
  deterministicCheck: { version: BENCHMARK_VERSION, score: 40, maxScore: 40, details: [] } as unknown as JudgeInput["deterministicCheck"],
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
    replies("not json", JSON.stringify(VALID));
    const result = await evaluateWithJudge(input, defaultConfig(), JUDGE, "xhigh");
    expect(result.repairAttempted).toBe(true);
    expect(sentOptions().map((options) => options?.reasoning)).toEqual(["xhigh", "xhigh"]);
  });

  it("sends no reasoning without --judge-thinking, or at off, as runs always have", async () => {
    replies(JSON.stringify(VALID), JSON.stringify(VALID));
    await evaluateWithJudge(input, defaultConfig(), JUDGE);
    await evaluateWithJudge(input, defaultConfig(), JUDGE, "off");
    expect(sentOptions()).toHaveLength(2);
    for (const options of sentOptions()) expect(options).not.toHaveProperty("reasoning");
  });
});
