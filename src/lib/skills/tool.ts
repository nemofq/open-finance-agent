import { Type } from "typebox";
import type { FinanceTool, Module } from "@/lib/tools/contracts";
import { loadSkills, modelInvocableSkills } from "./loader";

const parameters = Type.Object({
  name: Type.String({
    description: "Exact skill name as listed in <available_skills>, e.g. `earnings-preview`.",
  }),
});

const description = `Read a preset analyst workflow (a SKILL.md file) and return its full instructions.

The skills listed in <available_skills> in your system prompt show only a name and a summary. Call this tool to get the actual procedure — the tool order, fallbacks, analysis rules and output template — and follow it for the rest of the request. Read the skill before you start work, not after, and never guess at a workflow you have not read.`;

interface ReadSkillResult {
  found: boolean;
  name: string;
}

const readSkill: FinanceTool<typeof parameters, ReadSkillResult> = {
  name: "read_skill",
  // Reads a local SKILL.md: no network, no writes.
  meta: { class: "general", effect: "read" },
  label: "Read skill",
  description,
  parameters,
  async execute(_toolCallId, params) {
    const skills = modelInvocableSkills(await loadSkills());
    const skill = skills.find((candidate) => candidate.name === params.name);
    if (!skill) {
      const available = skills.map((candidate) => candidate.name).join(", ") || "none";
      return {
        content: [
          { type: "text", text: `No skill named \`${params.name}\`. Available: ${available}.` },
        ],
        details: { found: false, name: params.name },
      };
    }
    return {
      content: [{ type: "text", text: skill.body }],
      details: { found: true, name: skill.name },
    };
  },
};

export const skillsModule: Module = {
  id: "skills",
  name: "Skills",
  kind: "tool",
  description:
    "Preset analyst workflows (SKILL.md files) the agent can load on demand; add your own in the user skills folder.",
  settings: [],
  defaultConfig: { enabled: true },
  async createTools() {
    return [readSkill];
  },
};
