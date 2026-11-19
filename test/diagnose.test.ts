import { describe, expect, it } from "vitest";
import { diagnoseAgentView, diagnoseInstrumented } from "../src/diagnose.js";
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

  it("does not call a closed connection a protocol error", () => {
    const closed = diagnoseAgentView(ev("MCP error -32000: Connection closed", { outcome: "transport-error" }));
    const notStarted = diagnoseAgentView(ev("MCP error -32000: Connection closed | spawn npx ENOENT", { outcome: "transport-error" }));
    expect(closed.layer).toBe("mcp-server");
    expect(notStarted.layer).toBe("client");
  });

  it("lets connection-level errors reach the edge and client rules", () => {
    expect(diagnoseAgentView(ev("Version negotiation failed: the server denied access (HTTP 403)", { outcome: "transport-error" })).layer).toBe("edge");
    expect(diagnoseAgentView(ev("HTTP 400 {\"detail\":\"Connector is not safe\"}", { outcome: "transport-error" })).layer).toBe("client");
  });

  it("says unknown instead of guessing when text matches no known format", () => {
    const dx = diagnoseAgentView(ev("upstream connect error or disconnect/reset before headers", { outcome: "transport-error" }));
    expect(dx.layer).toBe("unknown");
    expect(dx.nextStep).toContain("client's own log");
  });

  it.each([
    ["web_search_exa error: connect ETIMEDOUT 104.18.0.1:443", "tool-error", "network"],
    ["MCP server exa exited with code 1", "transport-error", "mcp-server"],
    ["Error: Cannot find module '/x/dist/stdio.cjs'", "transport-error", "client"],
  ] as const)("%s -> %s", (text, outcome, layer) => {
    expect(diagnoseAgentView(ev(text, { outcome })).layer).toBe(layer);
  });

  it("points support at the timestamp when the requestId is missing", () => {
    const dx = diagnoseAgentView(ev("web_search_exa error (429): Rate limit exceeded\nTimestamp: 2026-11-15T21:31:21.094Z"));
    expect(dx.facts).toContain("No Exa requestId or error tag in the agent's text.");
    expect(dx.nextStep).toContain("2026-11-15T21:31:21.094Z");
  });

  it("keeps observed facts and inference apart", () => {
    const dx = diagnoseAgentView(ev("web_search_exa error: fetch failed"));
    expect(dx.facts.join(" ")).toContain("fetch failed");
    expect(dx.facts.join(" ")).not.toContain(dx.inference ?? "@@");
  });
});

describe("instrumented diagnosis", () => {
  it("catches null coerced to 0 even though the agent saw success (#470)", () => {
    const dx = diagnoseInstrumented({
      tool: "web_search_advanced_exa",
      args: { query: "q", maxAgeHours: null },
      agent: obs("ok", { outcome: "success", isError: false }),
      apiRequests: [{ method: "POST", path: "/search", headers: {}, body: { contents: { maxAgeHours: 0 } }, reachedExaApp: true, status: 200 }],
    });
    expect(dx.layer).toBe("mcp-server");
    expect(dx.confidence).toBe("certain");
  });

  it("follows renamed arguments into nested fields (#470, highlights)", () => {
    const dx = diagnoseInstrumented({
      tool: "web_search_advanced_exa",
      args: { query: "q", enableHighlights: true, highlightsMaxCharacters: null },
      agent: obs("ok", { outcome: "success", isError: false }),
      apiRequests: [{ method: "POST", path: "/search", headers: {}, body: { contents: { highlights: { maxCharacters: 0 } } }, reachedExaApp: true, status: 200 }],
    });
    expect(dx.layer).toBe("mcp-server");
  });

  it("blames the client when Exa's server logged a successful finish but the agent got an error", () => {
    const dx = diagnoseInstrumented({
      ...ev("Tool call failed: connection reset by gateway", { outcome: "tool-error" }),
      serverLog: ["[EXA-MCP-DEBUG] [web_search_exa-1] [web_search_exa] Successfully completed request"],
      apiRequests: [{ method: "POST", path: "/search", headers: {}, body: {}, reachedExaApp: true, status: 200 }],
    });
    expect(dx.layer).toBe("client");
    expect(dx.facts).toContain("Server log: the call completed successfully");
  });

  it("reports logged API warnings as facts", () => {
    const dx = diagnoseInstrumented({
      ...ev("Title: A", { outcome: "success", isError: false }),
      serverLog: ["[x] [web_search_exa] Exa API warning IGNORED_FIELD at /startCrawlDate: ignored"],
      apiRequests: [{ method: "POST", path: "/search", headers: {}, body: {}, reachedExaApp: true, status: 200 }],
    });
    expect(dx.layer).toBe("none");
    expect(dx.facts.join(" ")).toContain("IGNORED_FIELD at /startCrawlDate");
  });

  it("leaves an Exa error with an unknown status to the other rules", () => {
    expect(diagnoseAgentView(ev("web_search_exa error (unknown): something odd")).rule).toBe("no-known-format");
  });

  it("is only 'likely' about a bare fetch failure from the agent's text", () => {
    expect(diagnoseAgentView(ev("web_search_exa error: fetch failed")).confidence).toBe("likely");
  });

  it("says edge when requests left the server but none reached Exa's app", () => {
    const dx = diagnoseInstrumented({
      ...ev("web_search_exa error (403): something"),
      apiRequests: [{ method: "POST", path: "/search", headers: {}, body: {}, reachedExaApp: false, status: 403 }],
    });
    expect(dx.layer).toBe("edge");
  });

  it("uses Exa's log to tell a dropped connection from an unreachable API", () => {
    const dropped = diagnoseInstrumented({ ...ev("web_search_exa error: fetch failed"), apiRequests: [{ method: "POST", path: "/search", headers: {}, body: {}, reachedExaApp: true }] });
    const unreachable = diagnoseInstrumented({ ...ev("web_search_exa error: fetch failed"), apiRequests: [] });
    expect(dropped.layer).toBe("network");
    expect(unreachable.layer).toBe("network");
    expect(dropped.rule).not.toBe(unreachable.rule);
  });
});
