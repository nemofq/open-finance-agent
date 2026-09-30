import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // CONTRIBUTING: no non-null assertions to silence the checker. Tests may assert what they set up.
  {
    files: ["src/**/*.{ts,tsx}", "evals/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: { "@typescript-eslint/no-non-null-assertion": "error" },
  },
  // CONTRIBUTING: routes answer with the Web `Response`; no route needs what NextResponse adds.
  {
    files: ["src/app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "next/server", importNames: ["NextResponse"], message: "Answer with Response.json or jsonError from src/app/api/http.ts." }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // pdfjs ships this minified worker as a browser asset; it is not project source.
    "public/pdf.worker.min.mjs",
    // Claude Code worktrees and local state; each worktree is a full checkout.
    ".claude/**",
  ]),
]);

export default eslintConfig;
