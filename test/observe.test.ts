// Real calls through observe.ts, not hand-built observations.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diagnoseAgentView } from "../src/diagnose.js";
import { callTool } from "../src/observe.js";
import { startLocal } from "../src/targets.js";

describe("a server that dies during a tool call", () => {
  it("is observed as a transport error and diagnosed as the MCP server", async () => {
    const target = await startLocal({
      apiBaseUrl: "http://127.0.0.1:9",
      spawn: { command: process.execPath, args: [join(import.meta.dirname, "fixtures", "dies-on-call.mjs")] },
    });
    try {
      const obs = await callTool(target.client, "web_search_exa", {}, 10_000);
      expect(obs.outcome).toBe("transport-error");
      expect(obs.errorCode).toBe(-32000);
      expect(obs.text).toMatch(/connection closed/i);
      expect(diagnoseAgentView({ tool: "web_search_exa", args: {}, agent: obs }).layer).toBe("mcp-server");
    } finally {
      await target.close().catch(() => {});
    }
  });
});
