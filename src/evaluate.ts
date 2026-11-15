// Scores the diagnosis against cases with known answers.
import { heldOut } from "../eval/held-out.js";
import { diagnoseAgentView } from "./diagnose.js";
import type { ScenarioResult } from "./run.js";
import { LAYERS, type Diagnosis, type LayerOrNone } from "./types.js";

export interface EvalItem {
  id: string;
  set: "generated" | "real" | "variant" | "variant-2" | "variant-3";
  mode: "agent-view" | "full";
  expected: LayerOrNone;
  predicted: LayerOrNone;
  rule: string;
}

export interface Score {
  n: number;
  correct: number;
  accuracy: number;
  falsePositives: number; // said something failed when nothing did
  falseNegatives: number; // said nothing failed when something did
  perLayer: { layer: LayerOrNone; n: number; precision: number | null; recall: number | null }[];
}

export interface Evaluation {
  items: EvalItem[];
  scores: { set: EvalItem["set"]; mode: EvalItem["mode"]; score: Score }[];
  unscored: { id: string; source: string; text: string; diagnosis: Diagnosis; why: string }[];
  reproducibility?: { runs: number; scenarios: number; stable: number; unstable: string[] };
}

export function evaluate(results: ScenarioResult[]): Evaluation {
  const items: EvalItem[] = [];
  for (const r of results) {
    if (!r.diagnosis || r.verdict === "error") continue;
    for (const mode of ["agent-view", "full"] as const) {
      const dx = mode === "agent-view" ? r.diagnosis.agentView : r.diagnosis.full;
      items.push({ id: r.id, set: "generated", mode, expected: r.layer, predicted: dx.layer, rule: dx.rule });
    }
  }

  const unscored: Evaluation["unscored"] = [];
  for (const c of heldOut) {
    const dx = diagnoseAgentView({
      tool: "unknown",
      args: {},
      agent: { outcome: c.outcome, isError: c.isError, text: c.text, durationMs: 0 },
      ...(c.clientTimeoutMs !== undefined && { clientTimeoutMs: c.clientTimeoutMs }),
    });
    if (c.expected === null) unscored.push({ id: c.id, source: c.source, text: c.text, diagnosis: dx, why: c.why });
    else items.push({ id: c.id, set: c.set, mode: "agent-view", expected: c.expected, predicted: dx.layer, rule: dx.rule });
  }

  const groups = [
    ["generated", "agent-view"],
    ["generated", "full"],
    ["real", "agent-view"],
    ["variant", "agent-view"],
    ["variant-2", "agent-view"],
    ["variant-3", "agent-view"],
  ] as const;
  const scores = groups.map(([set, mode]) => ({ set, mode, score: score(items.filter((i) => i.set === set && i.mode === mode)) }));
  return { items, scores, unscored };
}

export function score(items: EvalItem[]): Score {
  const correct = items.filter((i) => i.predicted === i.expected).length;
  const layers: LayerOrNone[] = [...LAYERS, "none"];
  const perLayer = layers
    .map((layer) => {
      const tp = items.filter((i) => i.expected === layer && i.predicted === layer).length;
      const predicted = items.filter((i) => i.predicted === layer).length;
      const actual = items.filter((i) => i.expected === layer).length;
      return { layer, n: actual, precision: predicted ? tp / predicted : null, recall: actual ? tp / actual : null };
    })
    .filter((l) => l.n > 0 || l.precision !== null);
  return {
    n: items.length,
    correct,
    accuracy: items.length ? correct / items.length : 0,
    falsePositives: items.filter((i) => i.expected === "none" && i.predicted !== "none").length,
    falseNegatives: items.filter((i) => i.expected !== "none" && i.predicted === "none").length,
    perLayer,
  };
}

/** Same scenario, several runs: did the verdict and both diagnoses come out the same every time? */
export function reproducibility(runs: ScenarioResult[][]): NonNullable<Evaluation["reproducibility"]> {
  const byId = new Map<string, string[]>();
  for (const run of runs) {
    for (const r of run) {
      const key = [r.verdict, r.diagnosis?.agentView.layer, r.diagnosis?.full.layer, ...r.checks.map((c) => c.pass)].join("|");
      byId.set(r.id, [...(byId.get(r.id) ?? []), key]);
    }
  }
  const unstable = [...byId].filter(([, keys]) => new Set(keys).size > 1).map(([id]) => id);
  return { runs: runs.length, scenarios: byId.size, stable: byId.size - unstable.length, unstable };
}
