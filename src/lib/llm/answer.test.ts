import { expect, it } from "vitest";
import { hasToolProtocol } from "./answer";

it.each([
  '<｜DSML｜function_calls><｜DSML｜invoke name="create_report"><｜DSML｜parameter name="draftId">R2</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>',
  'One more section.\n<tool_call>{"name":"create_report","arguments":{}}</tool_call>',
  '<function_calls>\n<invoke name="lookup"></invoke></function_calls>',
  'The report flagged four figures I need to substantiate properly. Let me compute them.\n\n<｜DSML｜ calls>\n<｜DSML｜ invoke name="financial_calculator">\n<｜DSML｜ parameter name="code" string="true">emit("x", fin.yoy(1, 2), unit="%")</｜DSML｜ parameter>\n<｜DSML｜ parameter name="evidence" string="false">["E14"]</｜DSML｜ parameter>\n</｜DSML｜ invoke>\n</｜DSML｜ calls>',
  'Checking.\n<｜DSML｜ invoke name="x">',
  '<｜DSML｜ parameter name="code">1</｜DSML｜ parameter>',
  '<｜DSML｜ calls>\n<｜DSML｜ invoke name="x"></｜DSML｜ invoke></｜DSML｜ calls>',
  'Fixing the figures.\n<tool_call>\n<function=create_report>\n<parameter=title>\nQ2</parameter>\n</function>\n</tool_call>',
  '<tool_call>\n<function=create_report>\n<parameter=sections>\n[{"heading": "Summ',
  '<tool_call> {"name": "lookup", "arguments": {}}',
  'Let me recompute.\n<function=financial_calculator>\n<parameter=code>emit(1)</parameter>\n</function>',
])("rejects tool protocol presented as the answer", (text) => {
  expect(hasToolProtocol(text)).toBe(true);
});

it.each([
  'The report is complete. Its assumptions remain uncertain.',
  'The `<tool_call>` tag denotes a call.',
  'Example:\n```xml\n<function_calls><invoke name="lookup"/></function_calls>\n```',
  '> <tool_call>{"name":"lookup"}</tool_call>\nThat is a quoted example.',
  'The invoke name is financial_calculator; its parameter name is code, and DSML calls use a delimiter.',
  'Spaced markup like `<｜DSML｜ invoke name="x">` is only an example here.',
  'Example:\n```\n<｜DSML｜ calls>\n<｜DSML｜ invoke name="x">\n```',
  'The tool_call field records each request, and function=create_report names the tool it ran.',
  'A <tool_call> tag wraps each request; the function= attribute names the tool.',
  'Its markup looks like `<tool_call><function=create_report>` or `<function=lookup>`, shown as code.',
  'Example:\n```\n<tool_call>\n<function=create_report>\n</tool_call>\n```',
])("allows prose and quoted protocol examples", (text) => {
  expect(hasToolProtocol(text)).toBe(false);
});
