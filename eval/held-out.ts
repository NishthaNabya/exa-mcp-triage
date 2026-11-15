// Cases for scoring the diagnosis that do not come from the lab's own scenarios.
//
// real: error text quoted from public reports, plus one first-hand case. The answer
//   is what the report or its resolution shows. `expected: null` means the cause was
//   never confirmed, so the case is diagnosed in the report but not scored.
//   Caveat: these texts were read before the rules in src/diagnose.ts were written,
//   so this set is not blind. Each rule cites a source instead of a case.
// variant: written after the rules were frozen, to test cases the rules never saw.
//   The rules were not changed after scoring these.
import type { LayerOrNone, Observation } from "../src/types.js";

export interface HeldOutCase {
  id: string;
  set: "real" | "variant";
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
];
