// Runs real scenarios against the pinned server. Skipped until `npm run setup` has built it.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runScenario } from "../src/run.js";
import { scenarios } from "../src/scenarios.js";
import { FAKE_KEY, SERVER_BUNDLE } from "../src/targets.js";

const byId = (id: string) => {
  const s = scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
};

describe.skipIf(!existsSync(SERVER_BUNDLE))("against the pinned Exa MCP server", () => {
  it("reproduces #470: null maxAgeHours reaches Exa as 0", async () => {
    const r = await runScenario(byId("max-age-null-forces-livecrawl"));
    expect(r.verdict).toBe("reproduced");
    expect(r.diagnosis?.instrumented.layer).toBe("mcp-server");
  });

  it("reproduces the dropped requestId", async () => {
    const r = await runScenario(byId("request-id-dropped"));
    expect(r.verdict).toBe("reproduced");
    expect(r.observation?.text).toContain("(429)");
  });

  it("never stores the key the server sends to Exa's API", async () => {
    const r = await runScenario(byId("default-search-request"));
    expect(r.verdict).toBe("pass");
    expect(JSON.stringify(r)).not.toContain(FAKE_KEY);
  });

  it("every scenario has a unique id and at least one check", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of scenarios) expect(s.checks.length, s.id).toBeGreaterThan(0);
  });
});
