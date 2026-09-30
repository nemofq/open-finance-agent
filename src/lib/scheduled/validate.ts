import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { isRecord } from "@/lib/utils";
import { taskInputSchema, taskPatchSchema } from "./schema";

/**
 * Checking a request body against the scheduled-task contract, with a refusal a person can read:
 * `field: problem` per problem, joined by "; ", like the other routes' messages.
 */

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

interface Issue {
  keyword: string;
  schemaPath: string;
  instancePath: string;
  params: Record<string, unknown>;
  message: string;
}

function field(instancePath: string, child?: string): string {
  const parts = instancePath.split("/").filter(Boolean);
  if (child) parts.push(child);
  return parts.join(".") || "body";
}

/** Follow a JSON pointer (`#/properties/destination/anyOf/1`) into a schema or a value. */
function at(root: unknown, pointer: string): unknown {
  let node = root;
  for (const segment of pointer.replace(/^#/, "").split("/").filter(Boolean)) {
    if (!isRecord(node) && !Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function constOf(variant: unknown, key: string): unknown {
  const property = isRecord(variant) && isRecord(variant.properties) ? variant.properties[key] : undefined;
  return isRecord(property) ? property.const : undefined;
}

const choices = (values: unknown[]): string => values.map((value) => JSON.stringify(value)).join(", ");

/**
 * A union reports every variant's failures besides its own. A union of constants is read as its
 * list of choices; a tagged union (`kind`, `type`) by the variant the value's tag names.
 */
function unionProblems(union: Issue, issues: Issue[], schema: TSchema, value: unknown): string[] {
  const variants = at(schema, union.schemaPath);
  const options = isRecord(variants) && Array.isArray(variants.anyOf) ? variants.anyOf : [];
  const where = field(union.instancePath);
  const constants = options.map((option) => (isRecord(option) ? option.const : undefined));
  if (options.length > 0 && constants.every((constant) => constant !== undefined)) return [`${where}: must be one of ${choices(constants)}`];

  const actual = at(value, union.instancePath);
  const first = options[0];
  const tag = isRecord(first) && isRecord(first.properties)
    ? Object.keys(first.properties).find((key) => options.every((option) => constOf(option, key) !== undefined))
    : undefined;
  if (!tag) return [`${where}: does not match any accepted form`];
  if (!isRecord(actual)) return [`${where}: must be an object`];

  const chosen = options.findIndex((option) => constOf(option, tag) === actual[tag]);
  if (chosen < 0) return [`${field(union.instancePath, tag)}: must be one of ${choices(options.map((option) => constOf(option, tag)))}`];
  const prefix = `${union.schemaPath}/anyOf/${chosen}`;
  return readable(issues.filter((issue) => issue.schemaPath === prefix || issue.schemaPath.startsWith(`${prefix}/`)), schema, value);
}

function readable(issues: Issue[], schema: TSchema, value: unknown): string[] {
  const own = issues.filter(
    (issue) => !issues.some((union) => union.keyword === "anyOf" && issue.schemaPath.startsWith(`${union.schemaPath}/anyOf/`)),
  );
  return own.flatMap((issue) => {
    if (issue.keyword === "required" && Array.isArray(issue.params.requiredProperties)) {
      return issue.params.requiredProperties.map((key) => `${field(issue.instancePath, String(key))}: Required`);
    }
    if (issue.keyword === "anyOf") return unionProblems(issue, issues, schema, value);
    return [`${field(issue.instancePath)}: ${issue.message}`];
  });
}

function check<T extends TSchema>(schema: T, value: unknown): Checked<Static<T>> {
  if (Value.Check(schema, value)) return { ok: true, value };
  const problems = [...new Set(readable(Value.Errors(schema, value), schema, value))];
  return { ok: false, message: problems.join("; ") };
}

export const checkTaskInput = (value: unknown): Checked<Static<typeof taskInputSchema>> => check(taskInputSchema, value);
export const checkTaskPatch = (value: unknown): Checked<Static<typeof taskPatchSchema>> => check(taskPatchSchema, value);
