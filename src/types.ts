// Shared types. Kept in one place so the data model is easy to read.

/** Where a failure came from. Every diagnosis names one of these, or "none". */
export const LAYERS = [
  "client", // the agent's MCP client or its config
  "network", // no usable HTTP response: refused, reset, hung
  "edge", // a proxy such as Cloudflare answered, not Exa's app
  "auth", // key or login missing, wrong, or blocked
  "protocol", // MCP itself: unknown tool, invalid params
  "mcp-server", // Exa's MCP server changed the request or result
  "exa-api", // Exa's API returned an error or a partial result
] as const;
export type Layer = (typeof LAYERS)[number];
export type LayerOrNone = Layer | "none";

/** What a scenario claims. The report shows this next to every result. */
export type Label =
  | "reproduced-defect" // ran against the pinned code and saw the bug
  | "regression" // passes today and should keep passing
  | "simulated" // condition created with the fake API, shows how the server reacts
  | "external-not-reproduced"; // public report we could not reproduce
// Manual client checks are recorded separately, in manual/results.json.

/** What the agent ended up with after one MCP call. */
export interface Observation {
  outcome: "success" | "tool-error" | "mcp-error" | "transport-error" | "timeout";
  isError: boolean;
  text: string;
  meta?: Record<string, unknown>;
  structured?: unknown;
  errorCode?: number; // JSON-RPC code, when the call failed at the MCP layer
  durationMs: number;
}

/**
 * One request the fake Exa API received. This plays the part of Exa's own request
 * log, so a request that an edge proxy answered (`reachedApp: false`) is the kind
 * of request Exa's log would not contain.
 */
export interface UpstreamExchange {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  reachedApp: boolean;
  status?: number; // missing when no response was sent (hang, dropped connection)
}

/** Everything known about one call. Agent-view diagnosis only reads `tool`, `args` and `agent`. */
export interface Evidence {
  tool: string;
  args: unknown;
  agent: Observation;
  clientTimeoutMs?: number;
  serverLog?: string[];
  upstream?: UpstreamExchange[];
}

export interface Diagnosis {
  layer: LayerOrNone | "unknown"; // "unknown" means the evidence does not support a layer; better than a wrong guess
  confidence: "certain" | "likely" | "unknown";
  facts: string[]; // observed, quoted from evidence
  inference?: string; // our reading of the facts, kept separate
  nextStep: string;
  rule: string; // which rule fired, so every diagnosis can be traced
}
