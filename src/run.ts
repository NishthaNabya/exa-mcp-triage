// Runs scenarios: sets up the fake API and a server, does the action, records
// everything, runs the checks and diagnoses the result.
import { runChecks, type CheckContext, type CheckResult } from "./checks.js";
import { diagnoseAgentView, diagnoseFull } from "./diagnose.js";
import { startFakeExa, type FakeExa } from "./fake-exa/server.js";
import { callTool } from "./observe.js";
import { redactDeep, redactText } from "./redact.js";
import type { Scenario } from "./scenario.js";
import { startHosted, startLocal, type Target } from "./targets.js";
import type { Diagnosis, Evidence, Label, LayerOrNone, Observation, UpstreamExchange } from "./types.js";

export type Verdict = "reproduced" | "not-reproduced" | "pass" | "regressed" | "as-expected" | "unexpected" | "error";

export interface ScenarioResult {
  id: string;
  title: string;
  why: string;
  label: Label;
  layer: LayerOrNone;
  source?: string;
  target: Scenario["target"];
  verdict: Verdict;
  checks: CheckResult[];
  action: Scenario["action"];
  observation?: Observation;
  upstream: UpstreamExchange[];
  serverLog: string[];
  server?: { name?: string; version?: string };
  tools?: { name: string; inputSchema: unknown }[];
  http?: CheckContext["http"];
  diagnosis?: { agentView: Diagnosis; full: Diagnosis };
  repro: string;
  startedAt: string;
  durationMs: number;
  labError?: string; // the lab itself could not run the scenario
}

const DEFAULT_TIMEOUT_MS = 15_000;
const HOSTED_GAP_MS = 1_100; // the keyless tier allows 3 requests a second; stay well under
let lastHostedCall = 0;

export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const ctx: CheckContext = { upstream: [], serverLog: [] };
  let fake: FakeExa | undefined;
  let target: Target | undefined;
  let labError: string | undefined;

  try {
    if (s.target === "hosted") await throttleHosted();
    if (s.action.type === "http-initialize") {
      ctx.http = await httpInitialize(s.action.url);
    } else {
      if (s.target === "local") fake = await startFakeExa(s.upstream ?? {});
      try {
        target =
          s.target === "local"
            ? await startLocal({ apiBaseUrl: s.apiBaseUrl ?? fake!.url, env: s.serverEnv, spawn: s.spawn })
            : await startHosted();
        ctx.server = target.server;
      } catch (error) {
        // A failed start is the observation only in scenarios that break the start on purpose.
        // Anywhere else it is a problem with the lab's setup, not a finding.
        if (!s.spawn || s.action.type !== "call") throw error;
        ctx.obs = { outcome: "transport-error", isError: true, text: redactText(message(error)), durationMs: 0 };
      }
      if (target && s.action.type === "list-tools") {
        ctx.tools = (await target.client.listTools()).tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
      }
      if (target && s.action.type === "call") {
        ctx.obs = await callTool(target.client, s.action.tool, s.action.args, s.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      }
    }
  } catch (error) {
    labError = redactText(message(error));
  } finally {
    await target?.close().catch(() => {});
    ctx.serverLog = target?.serverLog ?? [];
    await fake?.close();
    ctx.upstream = fake?.exchanges ?? [];
  }

  const checks = labError ? [] : runChecks(s.checks, ctx);
  const diagnosis = s.action.type === "call" && ctx.obs ? diagnoseBoth(s, ctx) : undefined;

  return redactDeep({
    id: s.id,
    title: s.title,
    why: s.why,
    label: s.label,
    layer: s.layer,
    ...(s.source && { source: s.source }),
    target: s.target,
    verdict: labError ? "error" : verdictFor(s.label, checks),
    checks,
    action: s.action,
    ...(ctx.obs && { observation: ctx.obs }),
    upstream: ctx.upstream,
    serverLog: ctx.serverLog.filter((l) => !/DeprecationWarning|trace-deprecation/.test(l)),
    ...(ctx.server && { server: ctx.server }),
    ...(ctx.tools && { tools: ctx.tools }),
    ...(ctx.http && { http: ctx.http }),
    ...(diagnosis && { diagnosis }),
    repro: `npm run lab -- --only ${s.id}${s.target === "hosted" ? " --live" : ""}${s.slow ? " --slow" : ""}`,
    startedAt,
    durationMs: Math.round(performance.now() - t0),
    ...(labError && { labError }),
  });
}

/** What the result means, given what the scenario claims. Checks always state the correct behavior. */
export function verdictFor(label: Label, checks: CheckResult[]): Verdict {
  const allPass = checks.every((c) => c.pass);
  switch (label) {
    case "reproduced-defect":
      return allPass ? "not-reproduced" : "reproduced";
    case "regression":
      return allPass ? "pass" : "regressed";
    case "simulated":
      return allPass ? "as-expected" : "unexpected";
    case "external-not-reproduced":
      return allPass ? "not-reproduced" : "reproduced";
  }
}

function diagnoseBoth(s: Scenario, ctx: CheckContext): ScenarioResult["diagnosis"] {
  const action = s.action as Extract<Scenario["action"], { type: "call" }>;
  const evidence: Evidence = {
    tool: action.tool,
    args: action.args,
    agent: ctx.obs!,
    clientTimeoutMs: s.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    serverLog: ctx.serverLog,
    upstream: ctx.upstream,
  };
  return { agentView: diagnoseAgentView(evidence), full: diagnoseFull(evidence) };
}

async function httpInitialize(url: string): Promise<NonNullable<CheckContext["http"]>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "exa-mcp-fault-lab", version: "0.1.0" } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const keep = ["www-authenticate", "mcp-session-id", "content-type", "server", "cf-ray"];
  const headers = Object.fromEntries(keep.flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : [])));
  return { status: res.status, headers, body: (await res.text()).slice(0, 2000) };
}

async function throttleHosted(): Promise<void> {
  const wait = lastHostedCall + HOSTED_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHostedCall = Date.now();
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
