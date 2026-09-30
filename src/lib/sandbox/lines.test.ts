import { describe, expect, it } from "vitest";
import { createLineReader } from "./lines";

function collect(chunks: string[], maxLineBytes = 1024) {
  const lines: string[] = [];
  const overflows: number[] = [];
  const reader = createLineReader({ onLine: (line) => lines.push(line), onOverflow: (bytes) => overflows.push(bytes) }, maxLineBytes);
  for (const chunk of chunks) reader.push(chunk);
  return { lines, overflows };
}

describe("createLineReader", () => {
  it("emits one line per newline", () => {
    expect(collect(['{"a":1}\n{"b":2}\n']).lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("joins a message split across chunks", () => {
    expect(collect(['{"a":', "1}", "\n"]).lines).toEqual(['{"a":1}']);
  });

  it("holds back a line that has no newline yet", () => {
    expect(collect(['{"a":1}']).lines).toEqual([]);
  });

  it("ignores blank lines and trims the rest", () => {
    expect(collect(["\n  x  \n\n"]).lines).toEqual(["x"]);
  });

  it("handles a newline arriving on its own after a full message", () => {
    expect(collect(["one\ntwo", "\nthree\n"]).lines).toEqual(["one", "two", "three"]);
  });

  it("drops a runaway line and reports its size", () => {
    const { lines, overflows } = collect(["x".repeat(200)], 100);
    expect(lines).toEqual([]);
    expect(overflows).toEqual([200]);
  });

  it("keeps reading after an overflow", () => {
    const lines: string[] = [];
    const reader = createLineReader({ onLine: (line) => lines.push(line), onOverflow: () => undefined }, 10);
    reader.push("x".repeat(50));
    reader.push("ok\n");
    expect(lines).toEqual(["ok"]);
  });
});
