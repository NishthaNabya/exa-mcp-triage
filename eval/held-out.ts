// Cases for scoring the diagnosis that do not come from the lab's own scenarios.
//
// real: error text quoted from public reports, plus one first-hand case. The answer
//   is what the report or its resolution shows. `expected: null` means the cause was
//   never confirmed, so the case is diagnosed in the report but not scored.
//   Caveat: these texts were read before the rules in src/diagnose.ts were written,
//   so this set is not blind. Each rule cites a source instead of a case.
// variant: written after the round-1 rules were frozen and scored blind once (12/14).
//   Round 2 fixed rule bugs after seeing those results, so later scores are not blind.
// variant-2: written after the round-2 fixes and scored blind once (10/12); round 3 then
//   fixed the two gaps it showed, so later scores are not blind.
// variant-3: written after the round-3 fixes and scored blind once (5/8); round 4 then
//   changed the fallback rule because of it, so later scores are not blind.
// variant-4: written after the round-4 changes, scored once; rules not changed after.
import type { LayerOrNone, Observation } from "../src/types.js";

export interface HeldOutCase {
  id: string;
  set: "real" | "variant" | "variant-2" | "variant-3" | "variant-4";
  source: string;
  text: string;
  outcome: Observation["outcome"];
  isError: boolean;
  clientTimeoutMs?: number;
  expected: LayerOrNone | null;
  why: string;
}

const gh = (n: number, repo = "exa-mcp-server") => `https://github.com/exa-labs/${repo}/issues/${n}`;

export const heldOut: HeldOutCase[] = [
  // ---- real, scored ----
  {
    id: "nov9-claude-connector",
    set: "real",
    source: "First-hand, 2026-11-09 20:55 UTC, web_fetch_exa through Claude's connector",
    text: "The connector's server is rate-limiting requests. You can try again.",
    outcome: "tool-error",
    isError: true,
    expected: "client",
    why: "The text is not in Exa's MCP server, and Exa's request log has no request at that time.",
  },
  {
    id: "gh-100-smithery-520",
    set: "real",
    source: gh(100),
    text: "Error invoking prompt 'web_search_help' from exa [object Object]: Streamable HTTP error: Error POSTing to endpoint: <!DOCTYPE html> <html class=\"no-js\" lang=\"en-US\"> <head> <title>smithery.ai | 520: Web server is returning an unknown error</title>",
    outcome: "transport-error",
    isError: true,
    expected: "edge",
    why: "A Cloudflare 520 page from the smithery.ai proxy in front of the server.",
  },
  {
    id: "gh-414-workers-403",
    set: "real",
    source: gh(414),
    text: "Version negotiation failed: the server denied access (HTTP 403)",
    outcome: "transport-error",
    isError: true,
    expected: "edge",
    why: "The report shows the 403 is an HTML block page from Exa's Cloudflare edge, before any MCP logic.",
  },
  {
    id: "gh-61-chatgpt-not-safe",
    set: "real",
    source: gh(61),
    text: "HTTP 400 {\"detail\":\"Connector is not safe\"}",
    outcome: "transport-error",
    isError: true,
    expected: "client",
    why: "ChatGPT's connector check rejected the server; Exa never answered.",
  },
  {
    id: "gh-150-402-legacy-format",
    set: "real",
    source: gh(150),
    text: "Request failed with status code 402. Please check your query and try again.",
    outcome: "tool-error",
    isError: true,
    expected: "exa-api",
    why: "402 is Exa's payment-required status (error-codes page), in an older message format.",
  },

  // ---- real, not scored: cause never confirmed ----
  {
    id: "gh-475-300s-timeout",
    set: "real",
    source: gh(475),
    text: "MCP call failed: TimeoutError: MCP call timed out after 300.0s (configured timeout: 300.0s)",
    outcome: "timeout",
    isError: true,
    clientTimeoutMs: 300_000,
    expected: null,
    why: "Single report; the reporter says the root cause is unknown.",
  },
  {
    id: "gh-122-codex-closed",
    set: "real",
    source: gh(122),
    text: "MCP client for `exa` failed to start: MCP startup failed: handshaking with MCP server failed: connection closed: initialize response",
    outcome: "transport-error",
    isError: true,
    expected: null,
    why: "Closed without a stated cause.",
  },
  {
    id: "exa-js-139-html",
    set: "real",
    source: gh(139, "exa-js"),
    text: "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
    outcome: "transport-error",
    isError: true,
    expected: null,
    why: "The reporter guesses Cloudflare; not confirmed.",
  },

  // ---- variants: written after the rules were frozen ----
  { id: "v-402-credits", set: "variant", source: "variant", text: "web_search_exa error (402): Insufficient balance. Add credits to continue.\nTimestamp: 2026-11-15T10:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa-format 402." },
  { id: "v-nginx-504", set: "variant", source: "variant", text: "web_fetch_exa error (504): Request failed with status 504. Response body was not valid JSON: <html><head><title>504 Gateway Time-out</title></head><body><center><h1>504 Gateway Time-out</h1></center><hr><center>nginx</center></body></html>", outcome: "tool-error", isError: true, expected: "edge", why: "An nginx HTML page, not Cloudflare." },
  { id: "v-503-overloaded", set: "variant", source: "variant", text: "web_search_exa error (503): Service overloaded\nTimestamp: 2026-11-15T10:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa-format 503 with JSON body." },
  { id: "v-dns", set: "variant", source: "variant", text: "web_search_exa error: getaddrinfo ENOTFOUND api.exa.ai", outcome: "tool-error", isError: true, expected: "network", why: "DNS failure from the server's host." },
  { id: "v-server-timeout", set: "variant", source: "variant", text: "web_fetch_exa error: web_fetch_exa timed out after 60s", outcome: "tool-error", isError: true, expected: "network", why: "The server's own timeout." },
  { id: "v-stale-tool", set: "variant", source: "variant", text: "MCP error -32602: Tool crawling_exa not found", outcome: "tool-error", isError: true, expected: "protocol", why: "Client still calls a deprecated tool that is turned off." },
  { id: "v-server-bug", set: "variant", source: "variant", text: "web_search_advanced_exa error: Cannot read properties of undefined (reading 'map')", outcome: "tool-error", isError: true, expected: "mcp-server", why: "An exception inside the server." },
  { id: "v-npx-missing", set: "variant", source: "variant", text: "spawn npx ENOENT", outcome: "transport-error", isError: true, expected: "client", why: "The client cannot find npx." },
  { id: "v-401", set: "variant", source: "variant", text: "web_search_exa error (401): Invalid API key provided\nTimestamp: 2026-11-15T10:00:00.000Z", outcome: "tool-error", isError: true, expected: "auth", why: "Exa-format 401." },
  { id: "v-partial", set: "variant", source: "variant", text: "# Title\nURL: https://example.org/a\n\nSome text\n\nError fetching https://example.org/x: CRAWL_LIVECRAWL_TIMEOUT", outcome: "success", isError: false, expected: "exa-api", why: "One URL failed inside a successful result." },
  { id: "v-free-limit", set: "variant", source: "variant", text: "You've hit Exa's free MCP rate limit. Create a free Exa account to get your own usage allowance and rate limits. No payment method required.", outcome: "tool-error", isError: true, expected: "exa-api", why: "The keyless tier's own message." },
  { id: "v-envoy-reset", set: "variant", source: "variant", text: "upstream connect error or disconnect/reset before headers. reset reason: connection termination", outcome: "transport-error", isError: true, expected: "edge", why: "An Envoy proxy message from a gateway between client and server." },
  { id: "v-cf-challenge", set: "variant", source: "variant", text: "Streamable HTTP error: Error POSTing to endpoint (HTTP 403): <!DOCTYPE html><html><head><title>Just a moment...</title>", outcome: "transport-error", isError: true, expected: "edge", why: "A Cloudflare browser challenge page." },
  { id: "v-ok", set: "variant", source: "variant", text: "Title: Result\nURL: https://example.com\nPublished: N/A\nAuthor: N/A", outcome: "success", isError: false, expected: "none", why: "A normal result." },

  // ---- variant-2: written after the round-2 fixes, before scoring; rules not changed after ----
  { id: "v2-429-wording", set: "variant-2", source: "variant", text: "web_search_exa error (429): Too many requests, slow down\nTimestamp: 2026-11-15T12:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa-format 429 with other wording." },
  { id: "v2-econnreset", set: "variant-2", source: "variant", text: "web_fetch_exa error: read ECONNRESET", outcome: "tool-error", isError: true, expected: "network", why: "Connection reset mid-request." },
  { id: "v2-nginx-403", set: "variant-2", source: "variant", text: "web_search_exa error (403): Request failed with status 403. Response body was not valid JSON: <html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center></body></html>", outcome: "tool-error", isError: true, expected: "edge", why: "A proxy's own 403 page." },
  { id: "v2-method-not-found", set: "variant-2", source: "variant", text: "MCP error -32601: Method not found", outcome: "mcp-error", isError: true, expected: "protocol", why: "Client calls a method the server does not support." },
  { id: "v2-wrong-path", set: "variant-2", source: "variant", text: "Error: Cannot find module '/usr/lib/node_modules/exa-mcp-server/dist/stdio.cjs'", outcome: "transport-error", isError: true, expected: "client", why: "Client config points at a path that does not exist." },
  { id: "v2-400", set: "variant-2", source: "variant", text: "web_search_exa error (400): Invalid request body: numResults must be at most 100\nTimestamp: 2026-11-15T12:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa rejected the request body." },
  { id: "v2-hosted-auth-required", set: "variant-2", source: "Hosted server's own 401 body, probed 2026-11-15", text: "Error POSTing to endpoint (HTTP 401): {\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"Authentication required. Use OAuth or provide an API key.\"},\"id\":null}", outcome: "transport-error", isError: true, expected: "auth", why: "The hosted server asking for login." },
  { id: "v2-401-plain", set: "variant-2", source: "variant", text: "web_search_exa error (401): Unauthorized\nTimestamp: 2026-11-15T12:00:00.000Z", outcome: "tool-error", isError: true, expected: "auth", why: "Exa-format 401." },
  { id: "v2-notice-ok", set: "variant-2", source: "variant", text: "Note: Relaxed the site: restriction to return results.\n\nTitle: A\nURL: https://a.example", outcome: "success", isError: false, expected: "none", why: "A normal result with a notice." },
  { id: "v2-cf-522", set: "variant-2", source: "variant", text: "web_fetch_exa error (522): Request failed with status 522. Response body was not valid JSON: <!DOCTYPE html><title>api.exa.ai | 522: Connection timed out</title> Cloudflare", outcome: "tool-error", isError: true, expected: "edge", why: "Cloudflare could not reach the origin." },
  { id: "v2-connector-unreachable", set: "variant-2", source: "variant", text: "Tool 'exa__web_search_exa' failed: The connector's server could not be reached.", outcome: "tool-error", isError: true, expected: "client", why: "A client connector's own wording." },
  { id: "v2-lite-unsupported", set: "variant-2", source: "exa-mcp-server@93c0d5e src/tools/webSearchAdvanced.ts", text: "web_search_advanced_exa error: search type 'lite' does not support maxAgeHours. Remove it, or set type to 'auto'.", outcome: "tool-error", isError: true, expected: "protocol", why: "The server rejected an argument combination, which is invalid input." },

  // ---- variant-3: written after the round-3 fixes, before scoring; rules not changed after ----
  { id: "v3-404", set: "variant-3", source: "variant", text: "web_search_exa error (404): Not found\nTimestamp: 2026-11-15T13:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa-format 404." },
  { id: "v3-nginx-413", set: "variant-3", source: "variant", text: "web_fetch_exa error (413): Request failed with status 413. Response body was not valid JSON: <html><head><title>413 Request Entity Too Large</title></head><body><center>nginx</center></body></html>", outcome: "tool-error", isError: true, expected: "edge", why: "A proxy refused a large request body." },
  { id: "v3-input-validation", set: "variant-3", source: "variant", text: "MCP error -32602: Input validation error: Invalid arguments for tool web_search_exa: expected string, received undefined at query", outcome: "tool-error", isError: true, expected: "protocol", why: "Schema validation before the tool ran." },
  { id: "v3-etimedout", set: "variant-3", source: "variant", text: "web_search_exa error: connect ETIMEDOUT 104.18.0.1:443", outcome: "tool-error", isError: true, expected: "network", why: "TCP connect timed out." },
  { id: "v3-hosted-429", set: "variant-3", source: "variant", text: "Streamable HTTP error: Error POSTing to endpoint (HTTP 429): {\"error\":\"Too many requests\"}", outcome: "transport-error", isError: true, expected: "exa-api", why: "The hosted server rate-limited the connection itself." },
  { id: "v3-server-exited", set: "variant-3", source: "variant", text: "MCP server exa exited with code 1", outcome: "transport-error", isError: true, expected: "mcp-server", why: "The server process crashed." },
  { id: "v3-no-results", set: "variant-3", source: "variant", text: "No search results found. Please try a different query.", outcome: "success", isError: false, expected: "none", why: "Exa answered with nothing." },
  { id: "v3-401", set: "variant-3", source: "variant", text: "web_fetch_exa error (401): Invalid API key provided\nTimestamp: 2026-11-15T13:00:00.000Z", outcome: "tool-error", isError: true, expected: "auth", why: "Exa-format 401." },

  // ---- variant-4: written after the round-4 changes, before scoring; rules not changed after ----
  { id: "v4-402", set: "variant-4", source: "variant", text: "web_search_exa error (402): Credit balance exhausted\nTimestamp: 2026-11-15T18:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa-format 402." },
  { id: "v4-ehostunreach", set: "variant-4", source: "variant", text: "web_fetch_exa error: connect EHOSTUNREACH 10.0.0.1:443", outcome: "tool-error", isError: true, expected: "network", why: "No route to the API host." },
  { id: "v4-invalid-params", set: "variant-4", source: "variant", text: "MCP error -32602: Invalid params: urls must be an array", outcome: "mcp-error", isError: true, expected: "protocol", why: "Invalid arguments." },
  { id: "v4-eacces", set: "variant-4", source: "variant", text: "Error: MCP server exa failed to start: spawn node EACCES", outcome: "transport-error", isError: true, expected: "client", why: "The client cannot run the configured command." },
  { id: "v4-cf-502-transport", set: "variant-4", source: "variant", text: "Request to https://mcp.exa.ai/mcp failed: 502 Bad Gateway <html><head><title>502 Bad Gateway</title></head><body>cloudflare</body></html>", outcome: "transport-error", isError: true, expected: "edge", why: "A Cloudflare page at connect time." },
  { id: "v4-403-json", set: "variant-4", source: "variant", text: "web_search_exa error (403): Forbidden\nTimestamp: 2026-11-15T18:00:00.000Z", outcome: "tool-error", isError: true, expected: "auth", why: "Exa-format 403 with a JSON body." },
  { id: "v4-claude-connector", set: "variant-4", source: "variant", text: "Claude couldn't reach the Exa connector. Try again later.", outcome: "tool-error", isError: true, expected: "client", why: "A client's own wording." },
  { id: "v4-abort-timeout", set: "variant-4", source: "variant", text: "web_search_exa error: The operation was aborted due to timeout", outcome: "tool-error", isError: true, expected: "network", why: "Node's fetch gave up waiting for a response." },
  { id: "v4-partial", set: "variant-4", source: "variant", text: "# Page\nURL: https://x.example\n\nBody\n\nError fetching https://y.example: CRAWL_FORBIDDEN", outcome: "success", isError: false, expected: "exa-api", why: "One URL failed inside a successful result." },
  { id: "v4-oom-kill", set: "variant-4", source: "variant", text: "MCP server exa disconnected unexpectedly (process exited with code 137)", outcome: "transport-error", isError: true, expected: "mcp-server", why: "The server process was killed." },
  { id: "v4-504-json", set: "variant-4", source: "variant", text: "web_search_exa error (504): Gateway timeout\nTimestamp: 2026-11-15T18:00:00.000Z", outcome: "tool-error", isError: true, expected: "exa-api", why: "Exa-format 504 with a JSON body." },
];
