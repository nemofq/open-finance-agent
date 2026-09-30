/** Tool protocol outside a quoted example is an attempted action, not a final answer. */
export function hasToolProtocol(text: string): boolean {
  const prose = text
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/(`+)[^\n]*?\1/g, " ");
  // DSML may space the delimiter (`<｜DSML｜ invoke`) and shorten the opener to `calls>`; the XML-style
  // dialect opens `<tool_call>` with a JSON object or `<function=name>`, and may drop the wrapper.
  return /<(?:[｜|]\s*DSML\s*[｜|]\s*(?:calls>\s*<|parameter\s+name\s*=)|(?:[｜|]\s*DSML\s*[｜|]\s*)?(?:function_calls>\s*<|invoke\s+name\s*=|tool_call>\s*(?:\{|<function\s*=))|function\s*=\s*[\w.-]+\s*>)/i.test(prose);
}

export const INVALID_ANSWER = "The assistant returned tool protocol instead of a readable answer";
