// Scores the diagnosis against cases with known answers.
import { heldOut, type HeldOutCase } from "../eval/held-out.js";
import { diagnoseAgentView } from "./diagnose.js";
import type { ScenarioResult } from "./run.js";
import { LAYERS, type Diagnosis, type LayerOrNone } from "./types.js";

export interface EvalItem {
  id: string;
  set: "generated" | HeldOutCase["set"];
  // agent-view: only what the agent saw. instrumented: also the fake API's request log,
  // which knows where each request ended up because the lab decided it.
  mode: "agent-view" | "instrumented";
  expected: Diagnosis["layer"]; // "unknown" when the evidence cannot decide, so abstaining is right
  predicted: Diagnosis["layer"];
  rule: string;
}

export interface Score {
  n: number;
  correct: number;
  accuracy: number; // over all cases; an "unknown" counts as not correct
  abstained: number; // said "unknown"
  wrong: number; // named a layer, and it was the wrong one
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
    for (const mode of ["agent-view", "instrumented"] as const) {
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

  const heldOutSets = [...new Set(heldOut.map((c) => c.set))];
  const groups: [EvalItem["set"], EvalItem["mode"]][] = [
    ["generated", "agent-view"],
    ["generated", "instrumented"],
    ...heldOutSets.map((set) => [set, "agent-view"] as [EvalItem["set"], EvalItem["mode"]]),
  ];
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
  // Abstained: said "unknown" where the answer was knowable. Saying "unknown" where it
  // was not knowable is correct. Naming a layer where it was not knowable is wrong.
  const abstained = items.filter((i) => i.predicted === "unknown" && i.expected !== "unknown").length;
  return {
    n: items.length,
    correct,
    accuracy: items.length ? correct / items.length : 0,
    abstained,
    wrong: items.length - correct - abstained,
    falsePositives: items.filter((i) => i.expected === "none" && i.predicted !== "none" && i.predicted !== "unknown").length,
    falseNegatives: items.filter((i) => i.expected !== "none" && i.expected !== "unknown" && i.predicted === "none").length,
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
