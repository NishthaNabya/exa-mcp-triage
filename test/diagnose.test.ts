import { describe, expect, it } from "vitest";
import { diagnoseAgentView, diagnoseFull } from "../src/diagnose.js";
import type { Evidence, Observation } from "../src/types.js";

const obs = (text: string, o: Partial<Observation> = {}): Observation => ({ outcome: "tool-error", isError: true, text, durationMs: 1, ...o });
const ev = (text: string, o: Partial<Observation> = {}, extra: Partial<Evidence> = {}): Evidence => ({ tool: "web_search_exa", args: {}, agent: obs(text, o), ...extra });

describe("agent-view diagnosis, one case per rule", () => {
  it.each([
    ["web_search_exa error (401): Invalid API key\nTimestamp: t", "auth"],
    ["web_search_exa error (402): You have run out of credits", "exa-api"],
    ["web_search_exa error (429): Rate limit exceeded", "exa-api"],
    ["web_search_exa error (500): Internal server error", "exa-api"],
    ["web_search_exa error (403): Request failed with status 403. Response body was not valid JSON: <!DOCTYPE html> Cloudflare", "edge"],
    ["web_search_exa error (502): Request failed with status 502. Response body was not valid JSON: Bad Gateway", "edge"],
    ["web_search_exa error: fetch failed", "network"],
    ["web_search_exa error: web_search_exa timed out after 60s", "network"],
    ["web_search_exa error: Cannot read properties of undefined", "mcp-server"],
    ["MCP error -32602: Tool no_such_tool not found", "protocol"],
    ["You've hit Exa's free MCP rate limit. Create a free Exa account", "exa-api"],
    ["Error fetching URL(s): https://a.example: CRAWL_TIMEOUT", "exa-api"],
    ["The connector's server is rate-limiting requests. You can try again.", "client"],
  ])("%s -> %s", (text, layer) => {
    expect(diagnoseAgentView(ev(text)).layer).toBe(layer);
  });

  it("finds a failed URL inside a successful result", () => {
    const dx = diagnoseAgentView(ev("# A\n\nError fetching https://b.example: CRAWL_NOT_FOUND", { outcome: "success", isError: false }));
    expect(dx.layer).toBe("exa-api");
    expect(dx.facts[0]).toContain("CRAWL_NOT_FOUND");
  });

  it("blames the client when its timeout is shorter than the server's own limit", () => {
    const dx = diagnoseAgentView(ev("MCP error -32001: Request timed out", { outcome: "timeout" }, { clientTimeoutMs: 3000 }));
    expect(dx.layer).toBe("client");
  });

  it("keeps observed facts and inference apart", () => {
    const dx = diagnoseAgentView(ev("web_search_exa error: fetch failed"));
    expect(dx.facts.join(" ")).toContain("fetch failed");
    expect(dx.facts.join(" ")).not.toContain(dx.inference ?? "@@");
  });
});

describe("full diagnosis", () => {
  it("catches null coerced to 0 even though the agent saw success (#470)", () => {
    const dx = diagnoseFull({
      tool: "web_search_advanced_exa",
      args: { query: "q", maxAgeHours: null },
      agent: obs("ok", { outcome: "success", isError: false }),
      upstream: [{ method: "POST", path: "/search", headers: {}, body: { contents: { maxAgeHours: 0 } }, reachedApp: true, status: 200 }],
    });
    expect(dx.layer).toBe("mcp-server");
    expect(dx.confidence).toBe("certain");
  });

  it("says edge when requests left the server but none reached Exa's app", () => {
    const dx = diagnoseFull({
      ...ev("web_search_exa error (403): something"),
      upstream: [{ method: "POST", path: "/search", headers: {}, body: {}, reachedApp: false, status: 403 }],
    });
    expect(dx.layer).toBe("edge");
  });

  it("uses Exa's log to tell a dropped connection from an unreachable API", () => {
    const dropped = diagnoseFull({ ...ev("web_search_exa error: fetch failed"), upstream: [{ method: "POST", path: "/search", headers: {}, body: {}, reachedApp: true }] });
    const unreachable = diagnoseFull({ ...ev("web_search_exa error: fetch failed"), upstream: [] });
    expect(dropped.layer).toBe("network");
    expect(unreachable.layer).toBe("network");
    expect(dropped.rule).not.toBe(unreachable.rule);
  });
});
