import { defineConfig } from "vitest/config";

// Only the lab's own tests. vendor/ holds Exa's repo, which has its own test suite.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
