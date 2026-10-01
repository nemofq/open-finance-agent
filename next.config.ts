import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosts other than localhost that may load dev assets, e.g. a Tailscale name; see .env.example.
  // The API's cross-site guard (`src/app/api/origin.ts`) accepts writes from the same hosts.
  allowedDevOrigins: process.env.OFA_DEV_ORIGINS?.split(",").map((host) => host.trim()).filter(Boolean),
  serverExternalPackages: [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@modelcontextprotocol/sdk",
    "exceljs",
  ],
  // Include runtime dependencies and sandbox sources required for standalone builds.
  outputFileTracingIncludes: {
    "/api/**": [
      "./sandbox/fin/**",
      "./sandbox/{host.ts,runner.py,precheck.py,selftest.py}",
      // Copied into the runtime beside host.ts, which imports its types.
      "./src/lib/sandbox/protocol.ts",
      "./.sandbox/**",
      "./node_modules/pyodide/**",
    ],
    // The document parse worker is started by path and run from source (`attachments/parse/index.ts`),
    // so nothing imports it for the tracer to follow: name the worker, its registry, the parsers and
    // the modules they import. They are listed by name because the tracer's globs cannot leave out
    // a test file. `parse/worker.test.ts` checks this list still covers every file the worker loads.
    "/api/attachments": [
      "./src/lib/attachments/{digest,limits,signatures,tables,wording,zip}.ts",
      "./src/lib/attachments/parse/{worker,registry,text,html,docx,legacy-doc,tabular,pptx,pdf}.ts",
    ],
  },
  // Paths the route's modules build at run time make the tracer take in whole source folders
  // (src/lib/portfolio, sessions, skills and their routes), tests included; no test is ever loaded.
  outputFileTracingExcludes: {
    "/api/attachments": ["./src/**/*.test.ts", "./src/**/*.test.tsx"],
  },
};

export default nextConfig;
