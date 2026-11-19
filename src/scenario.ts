// What a scenario is. Adding a test means adding one Scenario object to src/scenarios.ts.
import type { Check } from "./checks.js";
import type { Routes } from "./fake-exa/server.js";
import type { Spawn } from "./targets.js";
import type { Label, LayerOrNone } from "./types.js";

export type Action =
  | { type: "call"; tool: string; args: Record<string, unknown> }
  | { type: "list-tools" }
  | { type: "http-initialize"; url: string }; // a raw MCP initialize POST, to see HTTP status and headers

export interface Scenario {
  id: string;
  title: string;
  why: string; // one line: what this scenario shows
  label: Label;
  layer: LayerOrNone; // the layer we made fail, or "none". This is the answer key for evaluation.
  source?: string; // the issue, doc or probe it comes from
  target: "local" | "hosted";
  fakeApi?: Routes; // local only: how the fake Exa API behaves
  serverEnv?: Record<string, string>;
  apiBaseUrl?: string; // local only: overrides the fake API's address
  spawn?: Spawn; // local only: overrides how the server is started
  action: Action;
  checks: Check[];
  timeoutMs?: number; // client timeout for the call; default 15s
  slow?: boolean; // takes a minute or more; runs only with --slow
}
