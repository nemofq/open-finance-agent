import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SourceSnapshot, withSourceSnapshot } from "@/lib/data/source-snapshot";
import { offlineContext } from "@/lib/tools/testing";
import { tavilyModule } from "./module";

const search = vi.fn();
const extract = vi.fn();
vi.mock("@tavily/core", () => ({ tavily: () => ({ search, extract }) }));

/** The benchmark's seam as a recording run uses it: it loads, then keeps what came back. */
const recorded: SourceSnapshot = {
  async resolve<T>(_request: unknown, load: () => Promise<T>): Promise<T> {
    return load();
  },
};

const page = {
  url: "https://example.test/release",
  title: "Results",
  rawContent: [`Intro. ${"filler ".repeat(300)}`, `The outlook calls for revenue of $32.5 billion. ${"filler ".repeat(300)}`].join("\n"),
};

async function tools() {
  const built = await tavilyModule.createTools({ apiKey: "tvly-test" }, offlineContext());
  return new Map(built.map((tool) => [tool.name, tool]));
}

beforeEach(() => {
  search.mockReset().mockResolvedValue({ results: [] });
  extract.mockReset().mockResolvedValue({ results: [page], failedResults: [] });
});

describe("Tavily requests", () => {
  it("are the same inside the benchmark's source seam as outside it", async () => {
    const web = await tools();
    const call = async () => {
      await web.get("web_search")?.execute("s", { query: "Nvidia results" });
      return web.get("web_fetch")?.execute("f", { urls: [page.url], query: "outlook revenue" });
    };
    const live = await call();
    const seamed = await withSourceSnapshot(recorded, call);

    expect(search.mock.calls[0]).toEqual(search.mock.calls[1]);
    expect(extract.mock.calls[0]).toEqual(extract.mock.calls[1]);
    expect(seamed?.content).toEqual(live?.content);
  });

  it("fetch whole pages and rank their passages here", async () => {
    const result = await (await tools()).get("web_fetch")?.execute("f", { urls: [page.url], query: "outlook revenue" });
    expect(extract).toHaveBeenCalledWith([page.url], { extractDepth: "basic", format: "markdown" });
    const text = String((result?.content[0] as { text?: string }).text);
    expect(text).toContain("The outlook calls for revenue of $32.5 billion.");
    expect(text).not.toContain("Intro.");
  });
});

describe("a Tavily module without a key", () => {
  it("contributes no tools, and Validate says what is missing", async () => {
    expect(await tavilyModule.createTools({ apiKey: "" }, offlineContext())).toEqual([]);
    expect(await tavilyModule.validate?.({ apiKey: "" })).toEqual({ ok: false, message: expect.stringMatching(/key is not set/) });
    expect(search).not.toHaveBeenCalled();
  });
});
