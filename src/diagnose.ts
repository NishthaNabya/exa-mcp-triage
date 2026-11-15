// Names the layer a failure came from, the way a support engineer would.
//
// Two modes:
// - agent view: only what the agent saw. This is all a ticket usually contains.
// - full: also Exa's request log (here, the fake API's log) and the server's stderr.
//
// Rules come from Exa's MCP server source at 93c0d5e and from live probes, not from
// test cases. The source of each rule is noted next to it.
import type { Diagnosis, Evidence, Layer, UpstreamExchange } from "./types.js";

// The only error texts Exa's MCP server produces (src/utils/errorHandler.ts, src/tools/webFetch.ts).
const EXA_STATUS_ERROR = /^(\S+) error \((\d{3}|unknown)\): /; // ExaError: "<tool> error (429): ..."
const EXA_PLAIN_ERROR = /^(\S+) error: /; // any other exception: "<tool> error: fetch failed"
const EXA_FREE_LIMIT = "You've hit Exa's free MCP rate limit"; // FREE_MCP_RATE_LIMIT_MESSAGE
const EXA_ALL_URLS_FAILED = /^Error fetching URL\(s\): /; // web_fetch_exa when every URL failed
const EXA_URL_FAILED = /^Error fetching (\S+): ([A-Z_]+)$/gm; // web_fetch_exa, one line per failed URL
const SDK_ERROR = /^MCP error (-?\d+): /; // the MCP SDK's own errors, e.g. -32602 invalid params
const LEGACY_STATUS = /Request failed with status code (\d{3})/; // older Exa MCP and axios wording

const HTML_PAGE = /<!DOCTYPE html|<html[\s>]|cloudflare|Ray ID|cf-ray/i;
const NO_RESPONSE = /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|getaddrinfo|socket hang up/i;
const SERVER_TIMEOUT = /timed out after (\d+)s/; // withTimeout() in errorHandler.ts
const SERVER_TOOL_LIMIT_MS = 60_000; // API_CONFIG.TOOL_TIMEOUTS.SEARCH_MS and FETCH_MS in src/tools/config.ts

const NEXT: Record<Layer, string> = {
  client: "Check the MCP client: its config, its timeout and any connector or proxy it uses. Exa did not produce this text.",
  network: "Check connectivity from where the MCP server runs to api.exa.ai, then retry. Check status.exa.ai if it persists.",
  edge: "A proxy answered instead of Exa. Note the time and any Cloudflare Ray ID, try another network, and send both to Exa support.",
  auth: "Check the API key or login. Keys are at dashboard.exa.ai/api-keys; remote MCP can sign in with ?login.",
  protocol: "Compare the call with the server's tools/list: tool name, argument names and types.",
  "mcp-server": "Reproduce with the same arguments against the pinned server and compare what it sent to Exa with what the agent asked for.",
  "exa-api": "Look up the status and tag on Exa's error-codes page. For billing or rate limits, check the dashboard.",
};

const d = (layer: Diagnosis["layer"], confidence: Diagnosis["confidence"], rule: string, facts: string[], inference?: string): Diagnosis => ({
  layer,
  confidence,
  rule,
  facts,
  ...(inference && { inference }),
  nextStep: layer === "none" ? "Nothing failed from the agent's point of view." : NEXT[layer],
});

/** Status codes, read the way Exa documents them (exa.ai/docs/admin/error-codes). */
function layerForStatus(status: number): Layer {
  if (status === 401 || status === 403) return "auth";
  return "exa-api";
}

export function diagnoseAgentView(e: Evidence): Diagnosis {
  const { agent } = e;
  const text = agent.text.trim();
  const quote = (s: string) => `Agent saw: "${s.length > 160 ? `${s.slice(0, 160)}...` : s}"`;

  if (!agent.isError) {
    const failed = [...text.matchAll(EXA_URL_FAILED)];
    if (failed.length > 0) {
      return d("exa-api", "certain", "partial-contents", failed.map((m) => `URL ${m[1]} failed with ${m[2]}`),
        "The call succeeded but some URLs did not. The result is not marked as an error, so an agent can miss it.");
    }
    return d("none", "likely", "success", ["The call returned a normal result."]);
  }

  if (agent.outcome === "timeout") {
    const t = e.clientTimeoutMs;
    if (t !== undefined && t < SERVER_TOOL_LIMIT_MS) {
      return d("client", "likely", "client-timeout-below-server-limit", [quote(text), `Client timeout ${t / 1000}s; Exa's server gives up on its own after ${SERVER_TOOL_LIMIT_MS / 1000}s.`],
        "The client stopped waiting before Exa's server could report what went wrong. The real cause is hidden.");
    }
    return d("network", "likely", "client-timeout-above-server-limit", [quote(text)],
      `Exa's server returns its own timeout error at ${SERVER_TOOL_LIMIT_MS / 1000}s, so a longer silence suggests the hang is between the client and the server.`);
  }

  if (text.startsWith(EXA_FREE_LIMIT)) {
    return d("exa-api", "certain", "free-tier-rate-limit", [quote(text)], "Keyless MCP use hit the free tier's rate limit.");
  }

  const sdk = text.match(SDK_ERROR);
  if (sdk) return d("protocol", sdk[1] === "-32602" ? "certain" : "likely", "mcp-sdk-error", [quote(text)]);

  if (agent.outcome === "transport-error") {
    if (/ENOENT|EACCES|spawn/i.test(text)) return d("client", "likely", "server-not-started", [quote(text)], "The client could not start the server process.");
    if (/connection closed/i.test(text)) return d("mcp-server", "likely", "server-closed", [quote(text)], "The server process exited or closed the connection.");
    return d("network", "likely", "transport-error", [quote(text)]);
  }

  if (EXA_ALL_URLS_FAILED.test(text)) return d("exa-api", "certain", "all-urls-failed", [quote(text)]);

  const statusMatch = text.match(EXA_STATUS_ERROR) ?? text.match(LEGACY_STATUS);
  const inExaFormat = statusMatch !== null || EXA_PLAIN_ERROR.test(text);

  if (inExaFormat && HTML_PAGE.test(text)) {
    return d("edge", "certain", "html-page", [quote(text)], "A web page came back where Exa's API returns JSON, so a proxy answered.");
  }
  if (inExaFormat && /not valid JSON|non-JSON body/.test(text)) {
    return d("edge", "likely", "non-json-body", [quote(text)], "Exa's API always answers in JSON, so something in front of it answered.");
  }

  if (statusMatch && statusMatch[2] !== "unknown") {
    const status = Number(statusMatch[2] ?? statusMatch[1]);
    return d(layerForStatus(status), status === 403 ? "likely" : "certain", "exa-status", [quote(text), `HTTP ${status}`]);
  }

  if (EXA_PLAIN_ERROR.test(text)) {
    if (NO_RESPONSE.test(text)) return d("network", "certain", "no-response", [quote(text)], "No HTTP response came back from Exa's API.");
    if (SERVER_TIMEOUT.test(text)) return d("network", "likely", "server-timeout", [quote(text)], "Exa's server stopped waiting for Exa's API.");
    return d("mcp-server", "likely", "server-exception", [quote(text)], "An exception inside Exa's MCP server, not an API error.");
  }

  // Not a format Exa's server produces. A 403 here is the edge: Exa's hosted server asks
  // for login with 401, not 403 (probed live, 2026-11-15).
  if (/\b403\b/.test(text)) {
    return d("edge", "likely", "connect-403", [quote(text)], "Exa asks for auth with 401, so a 403 before any MCP response points to the edge.");
  }
  if (HTML_PAGE.test(text)) return d("edge", "likely", "html-page-outside-tool", [quote(text)]);
  return d("client", "likely", "not-exa-text", [quote(text)], "This text is not in any format Exa's MCP server produces, so the client or a layer in front of it wrote it.");
}

export function diagnoseFull(e: Evidence): Diagnosis {
  const agentView = diagnoseAgentView(e);
  const log = e.upstream ?? [];
  const reached = log.filter((x) => x.reachedApp);
  const facts = [...agentView.facts, ...logFacts(log)];

  const coerced = coercedArgs(e.args, log);
  if (coerced.length > 0) {
    return d("mcp-server", "certain", "arg-coerced", [...facts, ...coerced],
      "The server changed an argument before sending it to Exa, so Exa did something the agent did not ask for.");
  }

  if (!e.agent.isError) return { ...agentView, facts };

  if (log.length > 0 && reached.length === 0) {
    return d("edge", "certain", "never-reached-app", facts, "Requests left the server but none reached Exa's app.");
  }
  if (log.length === 0) {
    if (agentView.layer === "network" || agentView.layer === "client" || agentView.layer === "protocol") {
      return { ...agentView, confidence: "certain", facts: [...facts, "Exa's log has no request for this call."] };
    }
  }
  const last = reached.at(-1);
  if (last && last.status === undefined) {
    return d("network", "certain", "no-response-from-app", facts, "Exa's app received the request but no response came back.");
  }
  if (last?.status && last.status >= 400) {
    return d(layerForStatus(last.status), "certain", "logged-status", facts);
  }
  return { ...agentView, facts };
}

function logFacts(log: UpstreamExchange[]): string[] {
  if (log.length === 0) return ["Exa's log: no request."];
  const reached = log.filter((x) => x.reachedApp);
  return [
    `Exa's log: ${reached.length} of ${log.length} request(s) reached the app` +
      (reached.length ? ` (status ${reached.map((x) => x.status ?? "none").join(", ")})` : ""),
  ];
}

/** Arguments the agent sent as null or "" that reached Exa as 0. (The #470 pattern.) */
function coercedArgs(args: unknown, log: UpstreamExchange[]): string[] {
  if (!args || typeof args !== "object") return [];
  const blanks = Object.entries(args).filter(([, v]) => v === null || v === "").map(([k]) => k);
  const out: string[] = [];
  for (const key of blanks) {
    for (const x of log) {
      if (findKey(x.body, key) === 0) out.push(`Agent sent ${key}: ${JSON.stringify((args as Record<string, unknown>)[key])}; Exa received ${key}: 0`);
    }
  }
  return [...new Set(out)];
}

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (key in value) return (value as Record<string, unknown>)[key];
  for (const v of Object.values(value)) {
    const found = findKey(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}
