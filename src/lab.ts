// One full lab run: scenarios, repeats, schema checks, drift and evaluation.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, reproducibility, type Evaluation } from "./evaluate.js";
import { startFakeExa } from "./fake-exa/server.js";
import { runScenario, type ScenarioResult } from "./run.js";
import type { Scenario } from "./scenario.js";
import { checkSchemas, compareTools, type Drift, type SchemaFinding } from "./schemas.js";
import { startLocal } from "./targets.js";

export const PINNED_COMMIT = "93c0d5e1fecfc1ec9bf70fa9f3633962a1f2fa8a";

export interface ManualResult {
  client: string;
  clientVersion: string;
  date: string;
  check: string;
  result: "pass" | "fail";
  evidence: string; // path to a screenshot or log
  notes?: string;
}

export interface LabRun {
  meta: {
    startedAt: string;
    finishedAt: string;
    node: string;
    platform: string;
    pinnedCommit: string;
    options: { live: boolean; slow: boolean; repeat: number; only?: string[] };
  };
  results: ScenarioResult[];
  evaluation: Evaluation;
  schemas: SchemaFinding[];
  drift?: Drift;
  manual: ManualResult[];
}

export interface LabOptions {
  live: boolean;
  slow: boolean;
  repeat: number;
  only?: string[];
  onResult?: (r: ScenarioResult) => void;
}

export function selectScenarios(all: Scenario[], o: Pick<LabOptions, "live" | "slow" | "only">): Scenario[] {
  if (o.only?.length) return all.filter((s) => o.only!.includes(s.id));
  return all.filter((s) => (s.target === "local" || o.live) && (!s.slow || o.slow));
}

export async function runLab(all: Scenario[], o: LabOptions, root: string): Promise<LabRun> {
  const startedAt = new Date().toISOString();
  const selected = selectScenarios(all, o);

  const results: ScenarioResult[] = [];
  for (const s of selected) {
    const r = await runScenario(s);
    results.push(r);
    o.onResult?.(r);
  }

  // Repeat the fast local scenarios to check that results do not drift between runs.
  const repeatable = selected.filter((s) => s.target === "local" && !s.slow);
  const runs: ScenarioResult[][] = [results.filter((r) => repeatable.some((s) => s.id === r.id))];
  for (let i = 1; i < o.repeat; i++) {
    const again: ScenarioResult[] = [];
    for (const s of repeatable) again.push(await runScenario(s));
    runs.push(again);
  }

  const evaluation = evaluate(results);
  if (o.repeat > 1) evaluation.reproducibility = reproducibility(runs);

  const localTools = results.find((r) => r.id === "server-identity")?.tools ?? [];
  const hosted = results.find((r) => r.id === "hosted-default-tools");
  const schemas = [...checkSchemas(localTools, "local"), ...checkSchemas(hosted?.tools ?? [], "hosted")];

  let drift: Drift | undefined;
  if (hosted?.tools) {
    // Compare like with like: the hosted server is keyless, so list the pinned server's keyless tools.
    const keyless = await listLocalKeyless();
    drift = compareTools(keyless, { version: hosted.server?.version, tools: hosted.tools });
  }

  return {
    meta: {
      startedAt,
      finishedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      pinnedCommit: PINNED_COMMIT,
      options: { live: o.live, slow: o.slow, repeat: o.repeat, ...(o.only && { only: o.only }) },
    },
    results,
    evaluation,
    schemas,
    ...(drift && { drift }),
    manual: readManual(root),
  };
}

async function listLocalKeyless() {
  const fake = await startFakeExa({});
  const target = await startLocal({ apiBaseUrl: fake.url, env: { EXA_API_KEY: "" } });
  try {
    const tools = (await target.client.listTools()).tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
    return { version: target.server.version, tools };
  } finally {
    await target.close();
    await fake.close();
  }
}

function readManual(root: string): ManualResult[] {
  const file = join(root, "manual", "results.json");
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as ManualResult[];
}
