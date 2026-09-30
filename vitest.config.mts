import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // One file boots the real calculator sandbox; under a full parallel run the others must not
    // time out while it holds the CPU.
    testTimeout: 20_000,
    hookTimeout: 120_000,
    /**
     * `evals/**` contributes only the benchmark harness's own unit tests. The benchmark itself is a
     * developer tool with its own CLI (`pnpm eval`), costs model calls and must never run here.
     */
    include: ["src/**/*.test.ts", "evals/**/*.test.ts"],
  },
});
