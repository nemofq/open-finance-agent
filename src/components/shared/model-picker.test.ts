import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LlmModelInfo } from "@/lib/llm/types";
import { ModelOption, popupSide } from "./model-picker";

const model = (overrides: Partial<LlmModelInfo>): LlmModelInfo => ({
  id: "deepseek/deepseek-v4.1-flash-lite-preview",
  name: "DeepSeek: DeepSeek V4.1 Flash Lite (Preview)",
  contextLength: 1_000_000,
  pricing: { input: 0.11, output: 0.34 },
  supportsReasoning: true,
  supportsImages: false,
  ...overrides,
});

const render = (props: Parameters<typeof ModelOption>[0]) => renderToStaticMarkup(React.createElement(ModelOption, props));

describe("ModelOption", () => {
  it("shows a long name and the id that tells its variant apart in full", () => {
    const html = render({ model: model({}) });
    expect(html).toContain("DeepSeek: DeepSeek V4.1 Flash Lite (Preview)");
    expect(html).toContain("deepseek/deepseek-v4.1-flash-lite-preview");
    expect(html).not.toContain("truncate");
    expect(html).toContain("1M context · $0.11 / $0.34 per M");
  });

  it("leaves out an id that only repeats the name, and marks the default", () => {
    const html = render({ model: model({ id: "gpt-6-sol", name: "gpt-6-sol" }), isDefault: true });
    expect(html.match(/gpt-6-sol/g)).toHaveLength(1);
    expect(html).toContain("Default");
  });
});

describe("popupSide", () => {
  it("opens below when the whole list fits there", () => {
    expect(popupSide({ top: 500, bottom: 532 }, 900)).toBe("bottom");
  });

  it("opens on the roomier side when it does not", () => {
    expect(popupSide({ top: 520, bottom: 552 }, 760)).toBe("top");
    expect(popupSide({ top: 100, bottom: 132 }, 400)).toBe("bottom");
  });
});
