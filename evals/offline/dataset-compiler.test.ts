import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sourceMaterialManifests, taskScopeSeed } from "../../scripts/compile-offline-dataset";
import { normalizeSourceUrl } from "./coverage-contract";
import { loadDataset } from "./dataset";
import { cleanUrl, domainOf } from "./mock-mcp-view";
import { RETAIL_EVAL_TASKS } from "../tasks";

/**
 * The dataset compiler takes every per-task fact it needs from the task definitions. The compiler
 * itself needs a private capture backup to run, so these tests hold the definitions to what the
 * committed dataset was compiled with instead: a definition edited without recompiling fails here.
 */

const SOURCE_MATERIALS = fileURLToPath(new URL("../source-materials/", import.meta.url));

interface SourceMaterialManifest {
  taskId?: string;
  cutoff?: string;
  sources?: { id: string; taskId: string; url: string }[];
}

function readManifest(file: string): SourceMaterialManifest {
  return JSON.parse(readFileSync(file, "utf8")) as SourceMaterialManifest;
}

describe("the task definitions against the compiled dataset", () => {
  const db = loadDataset();

  it("name the compiled tasks, in the manifest's order", () => {
    const ids = RETAIL_EVAL_TASKS.map((task) => task.id);
    const manifest = JSON.parse(readFileSync(new URL("../dataset/manifest.json", import.meta.url), "utf8")) as { taskIds: string[] };
    expect(manifest.taskIds).toEqual(ids);
    expect(Object.keys(db.scopes).sort()).toEqual([...ids].sort());
  });

  it("seed each scope with the cutoff, time, peers and topics it was compiled with", () => {
    for (const task of RETAIL_EVAL_TASKS) {
      const seed = taskScopeSeed(task);
      const scope = db.scopes[task.id];
      expect({
        taskId: scope.taskId,
        cutoff: scope.cutoff,
        asOfTime: scope.asOfTime,
        contractHash: scope.contractHash,
        peerTickers: scope.peerTickers,
        topics: scope.topics,
        aliases: scope.aliases,
      }, task.id).toEqual({
        taskId: seed.taskId,
        cutoff: seed.cutoff,
        asOfTime: seed.asOfTime,
        contractHash: seed.contractHash,
        peerTickers: seed.peerTickers,
        topics: seed.topics,
        aliases: seed.aliases,
      });
    }
  });

  it("declare every per-task source-material folder, on the task it belongs to", () => {
    const declared = sourceMaterialManifests(RETAIL_EVAL_TASKS, SOURCE_MATERIALS);
    const perTask = readdirSync(SOURCE_MATERIALS)
      .map((folder) => path.join(SOURCE_MATERIALS, folder, "manifest.json"))
      .filter((file) => existsSync(file) && readManifest(file).taskId !== undefined);
    expect(declared.map((item) => item.file).sort()).toEqual(perTask.sort());

    for (const { taskId, file } of declared) {
      const manifest = readManifest(file);
      const task = RETAIL_EVAL_TASKS.find((item) => item.id === taskId);
      expect(manifest.taskId, file).toBe(taskId);
      expect(manifest.cutoff, file).toBe(task?.asOfDate);
      for (const source of manifest.sources ?? []) {
        expect(source.taskId, source.id).toBe(taskId);
        const url = normalizeSourceUrl(source.url);
        const document = db.documents.find((item) => item.canonicalUrl === url || item.urlAliases.includes(url));
        expect(document?.taskIds, source.id).toContain(taskId);
        expect(db.scopes[taskId].documentIds, source.id).toContain(document?.id);
      }
    }
  });

  it("store every URL in the one normalized form the compiler, the mock and the checks share", () => {
    const urls = [
      ...db.documents.flatMap((document) => [document.canonicalUrl, ...document.urlAliases]),
      ...db.filings.flatMap((filing) => [filing.url, ...(filing.indexUrl ? [filing.indexUrl] : [])]),
    ];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      // Every stored URL parses, so no normalizer's text fallback ever decided one.
      expect(normalizeSourceUrl(url), url).toBe(url);
      expect(cleanUrl(url), url).toBe(url);
    }
    for (const document of db.documents) expect(domainOf(document.canonicalUrl), document.id).toBe(document.domain);
  });
});
