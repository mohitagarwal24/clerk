import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  test: {
    env: {
      MOCK_BASE_URL: "http://localhost:4999",
      CLERK_RUNS_DIR: join(tmpdir(), `clerk-test-runs-${process.pid}`),
      PORTAL_USER: "ap.clerk", PORTAL_PASS: "portal-demo-pass",
      ERP_USER: "ap.clerk", ERP_PASS: "erp-demo-pass",
      GEMINI_MODEL: "scripted",
    },
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
