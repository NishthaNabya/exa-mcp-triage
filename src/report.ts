// Renders one lab run as a single self-contained HTML page.
import type { LabRun } from "./lab.js";
import type { ScenarioResult } from "./run.js";
import type { Diagnosis } from "./types.js";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const link = (url?: string) => (url?.startsWith("http") ? `<a href="${esc(url)}">${esc(url.replace("https://github.com/exa-labs/", ""))}</a>` : esc(url ?? ""));

const VERDICT_CLASS: Record<ScenarioResult["verdict"], string> = {
  pass: "good",
  "as-expected": "good",
  "not-reproduced": "info",
  reproduced: "bad",
  regressed: "bad",
  unexpected: "bad",
  error: "bad",
};

export function renderHtml(run: LabRun): string {
  const r = run.results;
  const defects = r.filter((x) => x.verdict === "reproduced");
  const surprises = r.filter((x) => ["regressed", "unexpected", "error"].includes(x.verdict));
  const calls = r.filter((x) => x.diagnosis);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exa MCP Fault Lab report</title>
<style>
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e6;--card:#f7f7f8;--good:#1f7a4d;--bad:#b42318;--info:#365fae;--code:#f1f1f3}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa1;--line:#2c2c31;--card:#1c1c20;--good:#5cc28d;--bad:#ff7b6b;--info:#8fb0f5;--code:#232328}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600}code,pre{font:12.5px/1.45 ui-monospace,Consolas,monospace;background:var(--code);border-radius:6px}
code{padding:1px 5px}pre{padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:6px 0}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid currentColor}
.good{color:var(--good)}.bad{color:var(--bad)}.info{color:var(--info)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.card{background:var(--card);border-radius:10px;padding:12px}
.card b{font-size:22px;display:block}details{border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:8px 12px}
summary{cursor:pointer}summary .tag{margin-left:6px}.wrap{overflow-x:auto}
</style></head><body><main>
<h1>Exa MCP Fault Lab</h1>
<p class="muted">Run ${esc(run.meta.startedAt)} &middot; Node ${esc(run.meta.node)} &middot; ${esc(run.meta.platform)} &middot; Exa MCP server pinned at <code>${esc(run.meta.pinnedCommit.slice(0, 7))}</code>${run.drift?.hostedVersion ? ` &middot; hosted server reports ${esc(run.drift.hostedVersion)}` : ""} &middot; live: ${run.meta.options.live ? "yes" : "no"} &middot; slow: ${run.meta.options.slow ? "yes" : "no"}</p>

<div class="cards">
${card(r.length, "scenarios run")}
${card(defects.length, "defects reproduced", defects.length ? "bad" : "")}
${card(r.filter((x) => x.verdict === "pass" || x.verdict === "as-expected").length, "pass or as expected", "good")}
${card(surprises.length, "regressed, unexpected or lab errors", surprises.length ? "bad" : "")}
</div>

<h2>Reproduced defects</h2>
${defects.length ? `<table><tr><th>Scenario</th><th>What it shows</th><th>Source</th></tr>${defects.map((d) => `<tr><td><a href="#${esc(d.id)}">${esc(d.title)}</a></td><td>${esc(d.why)}</td><td>${link(d.source)}</td></tr>`).join("")}</table>` : `<p class="muted">None in this run.</p>`}
${surprises.length ? `<h2 class="bad">Needs attention</h2><table>${surprises.map((s) => `<tr><td><a href="#${esc(s.id)}">${esc(s.id)}</a></td><td>${esc(s.verdict)}</td><td>${esc(s.labError ?? s.checks.filter((c) => !c.pass).map((c) => c.name).join("; "))}</td></tr>`).join("")}</table>` : ""}

<h2>What the agent saw</h2>
<p class="muted">Each row is one failure we caused on purpose. The diagnosis columns show what the lab concluded from the agent's text alone, and from the agent's text plus Exa's request log.</p>
<div class="wrap"><table><tr><th>Scenario</th><th>Caused at</th><th>Exa's log</th><th>Agent saw</th><th>Error?</th><th>Agent view</th><th>Full</th></tr>
${calls.map((c) => `<tr><td><a href="#${esc(c.id)}">${esc(c.id)}</a></td><td>${esc(c.layer)}</td><td>${esc(upstreamSummary(c))}</td><td><code>${esc(clip(c.observation?.text, 140))}</code></td><td>${c.observation?.isError ? "yes" : "no"}</td><td>${dxCell(c.diagnosis!.agentView, c.layer)}</td><td>${dxCell(c.diagnosis!.full, c.layer)}</td></tr>`).join("")}
</table></div>

<h2>How often the diagnosis is right</h2>
<p class="muted"><b>generated</b>: the failures above, where we know the answer because we caused it. <b>real</b>: error text from public reports and one first-hand case; these were read before the rules were written, so treat that score as optimistic. <b>variant</b>: written after the round-1 rules were frozen and scored blind in round 1 (12/14); the round-2 fixes were made after seeing them, so this score is no longer blind. <b>variant-2</b>: scored blind in round 2 (10/12), then used to fix two gaps, so no longer blind. <b>variant-3</b>: written after the round-3 fixes and scored once, blind. Only the latest batch is a blind score. See docs/ROUNDS.md.</p>
<table><tr><th>Set</th><th>Evidence</th><th>Correct</th><th>Accuracy</th><th>False positives</th><th>False negatives</th></tr>
${run.evaluation.scores.filter((s) => s.score.n).map((s) => `<tr><td>${esc(s.set)}</td><td>${esc(s.mode)}</td><td>${s.score.correct}/${s.score.n}</td><td>${pct(s.score.accuracy)}</td><td>${s.score.falsePositives}</td><td>${s.score.falseNegatives}</td></tr>`).join("")}
</table>
${missesTable(run)}
${run.evaluation.reproducibility ? `<p>Reproducibility: <b>${run.evaluation.reproducibility.stable}/${run.evaluation.reproducibility.scenarios}</b> fast local scenarios gave identical verdicts, checks and diagnoses across ${run.evaluation.reproducibility.runs} runs.${run.evaluation.reproducibility.unstable.length ? ` Unstable: ${esc(run.evaluation.reproducibility.unstable.join(", "))}.` : ""}</p>` : ""}
<h3>Real reports with no confirmed cause (not scored)</h3>
<table><tr><th>Case</th><th>Text</th><th>Diagnosis</th></tr>
${run.evaluation.unscored.map((u) => `<tr><td>${link(u.source)}</td><td><code>${esc(clip(u.text, 160))}</code></td><td>${esc(u.diagnosis.layer)} (${esc(u.diagnosis.confidence)})${u.diagnosis.inference ? `<br><span class="muted">${esc(u.diagnosis.inference)}</span>` : ""}</td></tr>`).join("")}
</table>

<h2>Tool schemas</h2>
<p class="muted">Ajv strict: does the schema compile under a strict JSON Schema validator? OpenAI strict mode: rules from OpenAI's Structured Outputs docs ("Supported schemas"). Optional fields are a normal design choice; failing these rules means a strict client must convert the schema first, not that the schema is wrong.</p>
<div class="wrap"><table><tr><th>Tool</th><th>Server</th><th>Ajv strict</th><th>OpenAI strict mode</th></tr>
${run.schemas.map((s) => `<tr><td>${esc(s.tool)}</td><td>${esc(s.source)}</td><td>${s.ajvStrict.length ? `<span class="bad">${esc(s.ajvStrict.join("; "))}</span>` : `<span class="good">compiles</span>`}</td><td>${s.openAiStrict.length ? esc(s.openAiStrict.join("; ")) : `<span class="good">meets the rules</span>`}</td></tr>`).join("")}
</table></div>
${run.drift ? driftHtml(run) : `<p class="muted">Hosted comparison not run. Use <code>--live</code>.</p>`}

<h2>Manual client checks</h2>
${run.manual.length ? `<table><tr><th>Client</th><th>Version</th><th>Date</th><th>Check</th><th>Result</th><th>Evidence</th></tr>${run.manual.map((m) => `<tr><td>${esc(m.client)}</td><td>${esc(m.clientVersion)}</td><td>${esc(m.date)}</td><td>${esc(m.check)}</td><td class="${m.result === "pass" ? "good" : "bad"}">${esc(m.result)}</td><td>${esc(m.evidence)}</td></tr>`).join("")}</table>` : `<p class="muted">No manual results recorded. Steps are in <code>manual/README.md</code>; results go in <code>manual/results.json</code>. No client is claimed as tested until it is.</p>`}

<h2>All scenarios</h2>
${r.map(scenarioHtml).join("")}
</main></body></html>`;
}

function card(n: number, label: string, cls = "") {
  return `<div class="card"><b class="${cls}">${n}</b><span class="muted">${esc(label)}</span></div>`;
}

function clip(s: string | undefined, n: number) {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

function upstreamSummary(c: ScenarioResult) {
  if (c.target === "hosted") return "n/a (hosted)";
  if (!c.upstream.length) return "no request";
  const reached = c.upstream.filter((x) => x.reachedApp);
  if (!reached.length) return `${c.upstream.length} request(s), none reached the app`;
  return `${reached.length} request(s): ${reached.map((x) => x.status ?? "no response").join(", ")}`;
}

function dxCell(dx: Diagnosis, expected: string) {
  const right = dx.layer === expected;
  return `<span class="${right ? "good" : "bad"}">${esc(dx.layer)}</span> <span class="muted">${esc(dx.confidence)}</span>`;
}

function missesTable(run: LabRun) {
  const misses = run.evaluation.items.filter((i) => i.predicted !== i.expected);
  if (!misses.length) return `<p class="good">No misses.</p>`;
  return `<details><summary>${misses.length} miss(es): where the diagnosis was wrong</summary><table><tr><th>Case</th><th>Set</th><th>Evidence</th><th>Expected</th><th>Said</th><th>Rule</th></tr>${misses
    .map((m) => `<tr><td>${esc(m.id)}</td><td>${esc(m.set)}</td><td>${esc(m.mode)}</td><td>${esc(m.expected)}</td><td class="bad">${esc(m.predicted)}</td><td><code>${esc(m.rule)}</code></td></tr>`)
    .join("")}</table></details>`;
}

function driftHtml(run: LabRun) {
  const d = run.drift!;
  const same = !d.onlyLocal.length && !d.onlyHosted.length && !d.changedSchemas.length;
  return `<h3>Pinned server vs hosted server (keyless tool sets)</h3>
<table><tr><th>Pinned version</th><td>${esc(d.localVersion)}</td></tr><tr><th>Hosted version</th><td>${esc(d.hostedVersion)}</td></tr>
<tr><th>Only in pinned</th><td>${esc(d.onlyLocal.join(", ") || "none")}</td></tr><tr><th>Only in hosted</th><td>${esc(d.onlyHosted.join(", ") || "none")}</td></tr>
<tr><th>Same tool, different schema</th><td>${d.changedSchemas.length ? d.changedSchemas.map((c) => `<b>${esc(c.tool)}</b>: ${esc(c.changes.join("; "))}`).join("<br>") : "none"}</td></tr></table>
<p class="muted">${same ? "No differences in tool names or schemas." : "Production differs from the pinned public code, so results above describe the public code; live scenarios describe production."}</p>`;
}

function scenarioHtml(s: ScenarioResult) {
  const dx = s.diagnosis;
  return `<details id="${esc(s.id)}"><summary><b>${esc(s.title)}</b> <span class="tag ${VERDICT_CLASS[s.verdict]}">${esc(s.verdict)}</span> <span class="tag">${esc(s.label)}</span> <span class="muted">${esc(s.id)} &middot; ${s.durationMs} ms</span></summary>
<p>${esc(s.why)}</p>
<p class="muted">Target: ${esc(s.target)} &middot; caused at: ${esc(s.layer)}${s.source ? ` &middot; source: ${link(s.source)}` : ""}</p>
${s.labError ? `<p class="bad">Lab error: ${esc(s.labError)}</p>` : ""}
<table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>${s.checks.map((c) => `<tr><td>${esc(c.name)}</td><td class="${c.pass ? "good" : "bad"}">${c.pass ? "pass" : "fail"}</td><td><code>${esc(c.detail)}</code></td></tr>`).join("")}</table>
<p><b>Action</b></p><pre>${esc(JSON.stringify(s.action, null, 2))}</pre>
${s.observation ? `<p><b>Agent saw</b> (${esc(s.observation.outcome)}, isError ${s.observation.isError})</p><pre>${esc(s.observation.text)}</pre>` : ""}
${s.http ? `<p><b>HTTP response</b></p><pre>${esc(JSON.stringify({ status: s.http.status, headers: s.http.headers }, null, 2))}</pre>` : ""}
${s.upstream.length ? `<p><b>Requests the server sent to Exa's API</b></p><pre>${esc(JSON.stringify(s.upstream.map((u) => ({ path: u.path, reachedApp: u.reachedApp, status: u.status, body: u.body })), null, 2))}</pre>` : ""}
${s.serverLog.length ? `<details><summary>Server log (${s.serverLog.length} lines)</summary><pre>${esc(s.serverLog.join("\n"))}</pre></details>` : ""}
${dx ? `<p><b>Diagnosis</b></p><table><tr><th></th><th>Agent view</th><th>Full</th></tr>
<tr><th>Layer</th><td>${esc(dx.agentView.layer)} (${esc(dx.agentView.confidence)})</td><td>${esc(dx.full.layer)} (${esc(dx.full.confidence)})</td></tr>
<tr><th>Facts</th><td>${dx.agentView.facts.map(esc).join("<br>")}</td><td>${dx.full.facts.map(esc).join("<br>")}</td></tr>
<tr><th>Inference</th><td>${esc(dx.agentView.inference ?? "")}</td><td>${esc(dx.full.inference ?? "")}</td></tr>
<tr><th>Next step</th><td>${esc(dx.agentView.nextStep)}</td><td>${esc(dx.full.nextStep)}</td></tr>
<tr><th>Rule</th><td><code>${esc(dx.agentView.rule)}</code></td><td><code>${esc(dx.full.rule)}</code></td></tr></table>` : ""}
${s.tools ? `<p><b>Tools</b>: ${esc(s.tools.map((t) => t.name).join(", "))}</p>` : ""}
<p><b>Reproduce</b>: <code>${esc(s.repro)}</code></p>
</details>`;
}
