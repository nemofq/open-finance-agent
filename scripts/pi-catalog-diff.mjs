/**
 * For a pi-ai upgrade: the chat models an older pi-ai listed that the installed one no longer does,
 * per provider the app offers, with each one's name and price and the provider's new ids beside
 * them. Each removed id is then either aliased to its successor in `src/lib/llm/model-aliases.ts`
 * or left out as retired.
 *
 *   node scripts/pi-catalog-diff.mjs 0.85.1
 *
 * The older version is fetched with `npm pack`; only its catalog data is read, never run.
 * Dependency-free ESM, Node >= 24.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/pi-catalog-diff.mjs <older pi-ai version>");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The package root, from its main entry, because pi-ai's exports do not include package.json. */
const installed = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"))), "..");

/** The providers the app offers are the pi provider modules `pi-backed.ts` imports; OpenRouter's catalog is live. */
const source = readFileSync(path.join(repoRoot, "src/lib/llm/providers/pi-backed.ts"), "utf8");
const providers = [...source.matchAll(/from "@earendil-works\/pi-ai\/providers\/([\w-]+)"/g)].map((match) => match[1]);

/**
 * A provider's chat models by id, from the catalog data a pi-ai package ships, grouped there by
 * wire API; none for a provider that version did not have.
 */
function chatModels(packageRoot, provider) {
  const file = path.join(packageRoot, "dist/providers/data", `${provider}.json`);
  if (!existsSync(file)) return new Map();
  const models = Object.values(JSON.parse(readFileSync(file, "utf8"))).flatMap((group) => Object.values(group));
  return new Map(models.filter((model) => (model.type ?? "chat") === "chat").map((model) => [model.id, model]));
}

const price = ({ cost }) => `$${cost.input} / $${cost.output} per M`;

const temp = mkdtempSync(path.join(tmpdir(), "pi-catalog-diff-"));
try {
  const npm = { cwd: temp, stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" };
  const tarball = execFileSync("npm", ["pack", `@earendil-works/pi-ai@${version}`, "--silent"], npm).toString().trim();
  execFileSync("tar", ["-xzf", tarball], npm);
  const older = path.join(temp, "package");
  const current = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8")).version;

  if (!existsSync(path.join(older, "dist/providers/data"))) throw new Error(`pi-ai ${version} ships no catalog data where this script reads it.`);

  console.log(`Chat models in pi-ai ${version} that ${current} no longer lists:`);
  let total = 0;
  for (const provider of providers) {
    const before = chatModels(older, provider);
    const after = chatModels(installed, provider);
    // A package laid out differently would otherwise read as a catalog with nothing removed.
    if (after.size === 0) throw new Error(`No catalog data for ${provider} in the installed pi-ai; read how it ships its catalog.`);
    const removed = [...before.values()].filter((model) => !after.has(model.id));
    if (removed.length === 0) continue;
    total += removed.length;
    console.log(`\n${provider}`);
    for (const model of removed) console.log(`  - ${model.id}  (${model.name}, ${price(model)})`);
    const added = [...after.values()].filter((model) => !before.has(model.id));
    if (added.length > 0) console.log(`  new: ${added.map((model) => `${model.id} (${model.name}, ${price(model)})`).join(", ")}`);
  }
  console.log(`\n${total} removed ids. Alias each true successor in src/lib/llm/model-aliases.ts; the rest are retired.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
