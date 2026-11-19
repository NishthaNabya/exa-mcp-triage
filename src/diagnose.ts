// Names the layer a failure came from, the way a support engineer would.
//
// Two modes:
// - agent view: only what the agent saw. This is all a ticket usually contains.
// - instrumented: also the fake API's request log (standing in for Exa's own logs)
//   and Exa's MCP server log.
//
// Rules come from Exa's MCP server source at 93c0d5e and from live probes, not from
// test cases. The source of each rule is noted next to it.
//
// Sections: 1. error patterns, 2. next steps, 3. agent-view diagnosis,
// 4. instrumented diagnosis.
import type { ApiRequestRecord, Diagnosis, Evidence, Layer, Observation } from "./types.js";

// ---- 1. Error patterns ----

// The only error texts Exa's MCP server produces (src/utils/errorHandler.ts, src/tools/webFetch.ts).
const EXA_STATUS_ERROR = /^(\S+) error \((\d{3}|unknown)\): /; // "<tool> error (429): ..."
const EXA_PLAIN_ERROR = /^(\S+) error: /; // "<tool> error: fetch failed"
const EXA_FREE_LIMIT = "You've hit Exa's free MCP rate limit"; // FREE_MCP_RATE_LIMIT_MESSAGE
const EXA_ALL_URLS_FAILED = /^Error fetching URL\(s\): /; // web_fetch_exa when every URL failed
const EXA_URL_FAILED = /^Error fetching (\S+): ([A-Z_]+)$/gm; // web_fetch_exa, one line per failed URL
const LEGACY_STATUS = /Request failed with status code (\d{3})/; // older Exa MCP and axios wording
const SERVER_TIMEOUT = /timed out after (\d+)s/; // withTimeout() in errorHandler.ts
const SERVER_REJECTED_INPUT = /does not support|is not supported|Remove (it|them)\b/; // input checks in webSearchAdvanced.ts
const SERVER_TOOL_LIMIT_MS = 60_000; // TOOL_TIMEOUTS.SEARCH_MS and FETCH_MS in src/tools/config.ts

// The MCP SDK's own errors, e.g. -32602 invalid params.
const SDK_ERROR = /^MCP error (-?\d+): /;

const HTML_PAGE = /<!DOCTYPE html|<html[\s>]|cloudflare|Ray ID|cf-ray/i;
// Node's system errors for a request that got no response (nodejs.org/api/errors.html#common-system-errors).
const NO_RESPONSE_ERROR = /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|EAI_AGAIN|getaddrinfo|socket hang up/i;
// The server process never ran: bad command, missing file, or no permission.
const NOT_STARTED = /ENOENT|EACCES|spawn|Cannot find module/i;
// The server process ran and then died.
const PROCESS_DIED = /connection closed|exited with code|process exited|SIGKILL|SIGTERM/i;
// Claude and ChatGPT call remote MCP servers "connectors". Exa's server never uses the word
// in anything it sends (only in source comments), so text that does came from the client.
const CLIENT_VOCABULARY = /\bconnector\b/i;

// ---- 2. Next steps ----

const NEXT_STEP: Record<Layer, string> = {
  client: "Check the MCP client: its config, its timeout and any connector or proxy it uses. Exa did not produce this text.",
  network: "Check connectivity from where the MCP server runs to api.exa.ai, then retry. Check status.exa.ai if it persists.",
  edge: "A proxy answered instead of Exa. Note the time and any Cloudflare Ray ID, try another network, and send both to Exa support.",
  auth: "Check the API key or login. Keys are at dashboard.exa.ai/api-keys; remote MCP can sign in with ?login.",
  protocol: "Compare the call with the server's tools/list: tool name, argument names and types.",
  "mcp-server": "Reproduce with the same arguments against the pinned server and compare what it sent to Exa with what the agent asked for.",
  "exa-api": "Look up the status and tag on Exa's error-codes page. For billing or rate limits, check the dashboard.",
};
const NEXT_STEP_NONE = "Nothing failed from the agent's point of view.";
const NEXT_STEP_UNKNOWN =
  "This text matches no known format. Ask for the client's own log and the time of the call, then check Exa's request log for that time: no request there means the failure happened before Exa.";

function createDiagnosis(layer: Diagnosis["layer"], confidence: Diagnosis["confidence"], rule: string, facts: string[], inference?: string): Diagnosis {
  const nextStep = layer === "none" ? NEXT_STEP_NONE : layer === "unknown" ? NEXT_STEP_UNKNOWN : NEXT_STEP[layer];
  return { layer, confidence, rule, facts, ...(inference && { inference }), nextStep };
}

/** Status codes, read the way Exa documents them (exa.ai/docs/admin/error-codes). */
function layerForStatus(status: number): Layer {
  return status === 401 || status === 403 ? "auth" : "exa-api";
}

const quote = (s: string) => `Agent saw: "${s.length > 160 ? `${s.slice(0, 160)}...` : s}"`;

// ---- 3. Agent-view diagnosis ----

export function diagnoseAgentView(e: Evidence): Diagnosis {
  const text = e.agent.text.trim();
  if (!e.agent.isError) return fromSuccess(text);
  // Order matters: each step only sees text the earlier steps did not claim.
  return fromTimeout(e, text) ?? fromMcpOrProcess(e.agent, text) ?? fromExaFormat(text) ?? fromOtherText(text);
}

/** A normal result can still hide failed URLs (web_fetch_exa). */
function fromSuccess(text: string): Diagnosis {
  const failed = [...text.matchAll(EXA_URL_FAILED)];
  if (failed.length === 0) return createDiagnosis("none", "likely", "success", ["The call returned a normal result."]);
  return createDiagnosis("exa-api", "certain", "partial-contents", failed.map((m) => `URL ${m[1]} failed with ${m[2]}`),
    "The call succeeded but some URLs did not. The result is not marked as an error, so an agent can miss it.");
}

/** The client gave up waiting. Who to blame depends on how its limit compares with the server's. */
function fromTimeout(e: Evidence, text: string): Diagnosis | undefined {
  if (e.agent.outcome !== "timeout") return undefined;
  const t = e.clientTimeoutMs;
  if (t !== undefined && t < SERVER_TOOL_LIMIT_MS) {
    return createDiagnosis("client", "likely", "client-timeout-below-server-limit",
      [quote(text), `Client timeout ${t / 1000}s; Exa's server gives up on its own after ${SERVER_TOOL_LIMIT_MS / 1000}s.`],
      "The client stopped waiting before Exa's server could report what went wrong. The real cause is hidden.");
  }
  return createDiagnosis("network", "likely", "client-timeout-above-server-limit", [quote(text)],
    `Exa's server returns its own timeout error at ${SERVER_TOOL_LIMIT_MS / 1000}s, so a longer silence suggests the hang is between the client and the server.`);
}

/** MCP protocol errors, and the server process failing to start or dying. */
function fromMcpOrProcess(agent: Observation, text: string): Diagnosis | undefined {
  // JSON-RPC -326xx codes are protocol errors (-32602 invalid params, -32601 method not found).
  // -32000 is the SDK's "connection closed", which observe.ts reports as a transport error.
  const sdk = text.match(SDK_ERROR);
  if (sdk?.[1]?.startsWith("-326")) return createDiagnosis("protocol", sdk[1] === "-32602" ? "certain" : "likely", "mcp-sdk-error", [quote(text)]);

  if (agent.outcome !== "transport-error") return undefined;
  if (NOT_STARTED.test(text)) return createDiagnosis("client", "likely", "server-not-started", [quote(text)], "The client could not start the server process.");
  if (PROCESS_DIED.test(text)) return createDiagnosis("mcp-server", "likely", "server-closed", [quote(text)], "The server process exited or closed the connection.");
  if (NO_RESPONSE_ERROR.test(text)) return createDiagnosis("network", "likely", "transport-no-response", [quote(text)]);
  return undefined; // other connection-level text is judged by the edge and client rules
}

/** Text in one of the formats Exa's MCP server produces. */
function fromExaFormat(text: string): Diagnosis | undefined {
  if (text.startsWith(EXA_FREE_LIMIT)) {
    return createDiagnosis("exa-api", "certain", "free-tier-rate-limit", [quote(text)], "Keyless MCP use hit the free tier's rate limit.");
  }
  if (EXA_ALL_URLS_FAILED.test(text)) return createDiagnosis("exa-api", "certain", "all-urls-failed", [quote(text)]);

  const statusMatch = text.match(EXA_STATUS_ERROR) ?? text.match(LEGACY_STATUS);
  const plain = EXA_PLAIN_ERROR.test(text);
  if (!statusMatch && !plain) return undefined;

  // Exa's API always answers in JSON, so a web page or other non-JSON body means a proxy answered.
  if (HTML_PAGE.test(text)) {
    return createDiagnosis("edge", "certain", "html-page", [quote(text)], "A web page came back where Exa's API returns JSON, so a proxy answered.");
  }
  if (/not valid JSON|non-JSON body/.test(text)) {
    return createDiagnosis("edge", "likely", "non-json-body", [quote(text)], "Exa's API always answers in JSON, so something in front of it answered.");
  }

  if (statusMatch && statusMatch[2] !== "unknown") {
    const status = Number(statusMatch[2] ?? statusMatch[1]);
    const dx = createDiagnosis(layerForStatus(status), status === 403 ? "likely" : "certain", "exa-status", [quote(text), `HTTP ${status}`]);
    // Exa's support asks for the requestId, but this server version never passes it on,
    // so point support at the evidence that is there: the timestamp.
    const stamp = text.match(/Timestamp: (\S+)/)?.[1];
    if (!/req(uest)?[_ ]?id/i.test(text)) {
      dx.facts.push("No Exa requestId or error tag in the agent's text.");
      if (stamp) dx.nextStep += ` The requestId is missing, so search Exa's request log near ${stamp}.`;
    }
    return dx;
  }

  // "<tool> error (unknown): ..." has no status to read; let the other rules judge it.
  if (!plain) return undefined;

  // "<tool> error: ..." without a status. "fetch failed" alone could be DNS, a refused
  // connection, TLS or a proxy, so it is only "likely".
  if (NO_RESPONSE_ERROR.test(text)) return createDiagnosis("network", "likely", "no-response", [quote(text)], "No HTTP response came back from Exa's API.");
  if (SERVER_TIMEOUT.test(text)) return createDiagnosis("network", "likely", "server-timeout", [quote(text)], "Exa's server stopped waiting for Exa's API.");
  if (SERVER_REJECTED_INPUT.test(text)) {
    return createDiagnosis("protocol", "certain", "server-rejected-input", [quote(text)], "The server refused an argument combination before calling Exa.");
  }
  return createDiagnosis("mcp-server", "likely", "server-exception", [quote(text)], "An exception inside Exa's MCP server, not an API error.");
}

/** Text in no format Exa's server produces. */
function fromOtherText(text: string): Diagnosis {
  // Exa's hosted server asks for login with 401 and never answers 403 itself (probed live,
  // 2026-11-15), so a 401 is auth and a 403 is the edge.
  if (/\b401\b|Authentication required/.test(text)) {
    return createDiagnosis("auth", "likely", "connect-401", [quote(text)], "The server asked for a key or login before any tool ran.");
  }
  if (/\b403\b/.test(text)) {
    return createDiagnosis("edge", "likely", "connect-403", [quote(text)], "Exa asks for auth with 401, so a 403 before any MCP response points to the edge.");
  }
  if (HTML_PAGE.test(text)) return createDiagnosis("edge", "likely", "html-page-outside-tool", [quote(text)]);
  if (CLIENT_VOCABULARY.test(text)) {
    return createDiagnosis("client", "likely", "client-vocabulary", [quote(text)], "The text talks about a connector, which is the client's word; Exa's server never produces it.");
  }
  // Round 3's blind batch showed that guessing "client" here was wrong 3 times out of 3.
  return createDiagnosis("unknown", "unknown", "no-known-format", [quote(text)], "This text is not in any format Exa's MCP server produces, and it names no layer.");
}

// ---- 4. Instrumented diagnosis ----

export function diagnoseInstrumented(e: Evidence): Diagnosis {
  const agentView = diagnoseAgentView(e);
  const requests = e.apiRequests ?? [];
  const reached = requests.filter((x) => x.reachedExaApp);
  const server = readServerLog(e.serverLog ?? []);
  const facts = [...agentView.facts, ...requestLogFacts(requests), ...server.facts];

  const changed = findChangedArguments(e.args, requests);
  if (changed.length > 0) {
    return createDiagnosis("mcp-server", "certain", "arg-coerced", [...facts, ...changed],
      "The server changed an argument before sending it to Exa, so Exa did something the agent did not ask for.");
  }

  if (!e.agent.isError) return { ...agentView, facts };

  // The server logged a successful finish, yet the agent got an error: the error was added
  // after the result left Exa's server.
  if (server.completed && !server.errored) {
    return createDiagnosis("client", "certain", "server-completed", facts, "Exa's server finished the call successfully, so the error came from the client side.");
  }
  if (requests.length > 0 && reached.length === 0) {
    return createDiagnosis("edge", "certain", "never-reached-app", facts, "Requests left the server but none reached Exa's app.");
  }
  if (requests.length === 0 && (agentView.layer === "network" || agentView.layer === "client" || agentView.layer === "protocol")) {
    return { ...agentView, confidence: "certain", facts: [...facts, "Exa's log has no request for this call."] };
  }
  const last = reached.at(-1);
  if (last && last.status === undefined) {
    return createDiagnosis("network", "certain", "no-response-from-app", facts, "Exa's app received the request but no response came back.");
  }
  if (last?.status && last.status >= 400) {
    return createDiagnosis(layerForStatus(last.status), "certain", "logged-status", facts);
  }
  return { ...agentView, facts };
}

/** What Exa's MCP server wrote to stderr (src/utils/logger.ts, src/tools/searchNotes.ts). */
function readServerLog(lines: string[]) {
  const errors = lines.flatMap((l) => l.match(/\] Error: (.*)$/)?.[1] ?? []);
  const warnings = lines.flatMap((l) => l.match(/Exa API warning (\S+) at (\S+)/)?.slice(1, 3).join(" at ") ?? []);
  const completed = lines.some((l) => l.includes("Successfully completed request"));
  const facts = [
    ...errors.map((m) => `Server log: error "${m}"`),
    ...warnings.map((w) => `Server log: API warning ${w}, which the agent does not see`),
    ...(completed ? ["Server log: the call completed successfully"] : []),
  ];
  return { facts, completed, errored: errors.length > 0 };
}

function requestLogFacts(requests: ApiRequestRecord[]): string[] {
  if (requests.length === 0) return ["Exa's log: no request."];
  const reached = requests.filter((x) => x.reachedExaApp);
  const statuses = reached.length ? ` (status ${reached.map((x) => x.status ?? "none").join(", ")})` : "";
  return [`Exa's log: ${reached.length} of ${requests.length} request(s) reached the app${statuses}`];
}

// web_search_advanced_exa flattens nested options into prefixed arguments, e.g.
// highlightsMaxCharacters -> contents.highlights.maxCharacters (src/tools/webSearchAdvanced.ts).
const NESTED_PREFIXES = ["highlights", "text", "context", "summary"];

/** Where an argument ends up in the request Exa receives: under its own name, or its nested name. */
function sentValue(body: unknown, arg: string): unknown {
  const direct = findKey(body, arg);
  if (direct !== undefined) return direct;
  const prefix = NESTED_PREFIXES.find((p) => arg.startsWith(p) && arg.length > p.length);
  if (!prefix) return undefined;
  const rest = arg.slice(prefix.length);
  return findKey(findKey(body, prefix), rest[0]!.toLowerCase() + rest.slice(1));
}

/** Arguments the agent sent as null or "" that reached Exa as 0 (the #470 pattern). */
function findChangedArguments(args: unknown, requests: ApiRequestRecord[]): string[] {
  if (!args || typeof args !== "object") return [];
  const blanks = Object.entries(args).filter(([, v]) => v === null || v === "").map(([k]) => k);
  const out = new Set<string>();
  for (const key of blanks) {
    for (const r of requests) {
      if (sentValue(r.body, key) === 0) out.add(`Agent sent ${key}: ${JSON.stringify((args as Record<string, unknown>)[key])}; Exa received 0`);
    }
  }
  return [...out];
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
