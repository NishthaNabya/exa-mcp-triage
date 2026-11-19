// Renders one lab run as a single self-contained HTML page, one section per function.
import type { LabRun } from "./lab.js";
import type { ScenarioResult } from "./run.js";
import type { Diagnosis } from "./types.js";

export function renderHtml(run: LabRun): string {
  const body = [header(run), defects(run), matrix(run), agentSaw(run), evaluation(run), schemas(run), manual(run), allScenarios(run)].join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exa MCP Triage report</title>
<style>${STYLE}</style></head><body><main>
${body}
</main></body></html>`;
}

// ---- sections ----

function header(run: LabRun) {
  const r = run.results;
  const m = run.meta;
  const surprises = r.filter(isSurprise).length;
  const reproduced = r.filter((x) => x.verdict === "reproduced").length;
  return `<h1>Exa MCP Triage</h1>
<p class="muted">Run ${esc(m.startedAt)} &middot; Node ${esc(m.node)} &middot; ${esc(m.platform)} &middot; Exa MCP server pinned at <code>${esc(m.pinnedCommit.slice(0, 7))}</code>${run.drift?.hostedVersion ? ` &middot; hosted server reports ${esc(run.drift.hostedVersion)}` : ""} &middot; live: ${m.options.live ? "yes" : "no"} &middot; slow: ${m.options.slow ? "yes" : "no"}</p>
<div class="cards">
${card(r.length, "scenarios run")}
${card(reproduced, "defects reproduced", reproduced ? "bad" : "")}
${card(r.filter((x) => x.verdict === "pass" || x.verdict === "as-expected").length, "pass or as expected", "good")}
${card(surprises, "regressed, unexpected or lab errors", surprises ? "bad" : "")}
</div>`;
}

function defects(run: LabRun) {
  const found = run.results.filter((x) => x.verdict === "reproduced");
  const surprises = run.results.filter(isSurprise);
  const list = found.length
    ? table(["Scenario", "What it shows", "Source"], found.map((d) => [`<a href="#${esc(d.id)}">${esc(d.title)}</a>`, esc(d.why), link(d.source)]))
    : `<p class="muted">None in this run.</p>`;
  const attention = surprises.length
    ? `<h2 class="bad">Needs attention</h2>${table(["Scenario", "Verdict", "Why"], surprises.map((s) => [`<a href="#${esc(s.id)}">${esc(s.id)}</a>`, esc(s.verdict), esc(s.labError ?? s.checks.filter((c) => !c.pass).map((c) => c.name).join("; "))]))}`
    : "";
  return `<h2>Reproduced defects</h2>${list}${attention}`;
}

function matrix(run: LabRun) {
  const rows = run.matrix.map((m) => [esc(m.client), esc(m.version), esc(m.transport), esc(m.auth), esc(m.server), `<span class="${m.coverage === "not run" ? "muted" : ""}">${esc(m.coverage)}</span>`, esc(m.result)]);
  return `<h2>Compatibility matrix</h2>
<p class="muted">Every client and setup the lab knows about, and how it was covered. Automated rows ran in this report. Static rows check the tool schemas against a client's documented rules. Nothing is marked tested unless it ran.</p>
${wrap(table(["Client", "Version", "Transport", "Auth", "Server", "Coverage", "Result"], rows))}`;
}

function agentSaw(run: LabRun) {
  const calls = run.results.filter((x) => x.diagnosis);
  const rows = calls.map((c) => [
    `<a href="#${esc(c.id)}">${esc(c.id)}</a>`,
    esc(c.layer),
    esc(apiLogSummary(c)),
    `<code>${esc(clip(c.observation?.text, 140))}</code>`,
    c.observation?.isError ? "yes" : "no",
    diagnosisCell(c.diagnosis!.agentView, c.layer),
    diagnosisCell(c.diagnosis!.instrumented, c.layer),
  ]);
  return `<h2>What the agent saw</h2>
<p class="muted">Each row is one failure the lab caused on purpose.</p>
<ul class="muted">
<li><b>Agent view</b>: what the lab concludes from the agent's text alone, which is what a ticket usually contains.</li>
<li><b>Instrumented</b>: also reads the fake API's request log and the server's log. The fake API knows where each request ended up because the lab decided it, so this column shows the rules with perfect internal logs, standing in for Exa's own.</li>
</ul>
${wrap(table(["Scenario", "Caused at", "Exa's log", "Agent saw", "Error?", "Agent view", "Instrumented"], rows))}`;
}

function evaluation(run: LabRun) {
  const ev = run.evaluation;
  const latestBlind = ev.scores.filter((s) => s.set.startsWith("variant") && s.score.n).at(-1);
  const rows = ev.scores
    .filter((s) => s.score.n)
    .map((s) => [esc(s.set), esc(s.mode), `${s.score.correct}/${s.score.n}`, pct(s.score.accuracy), String(s.score.wrong), String(s.score.abstained), String(s.score.falsePositives), String(s.score.falseNegatives)]);
  const repro = ev.reproducibility;
  return `<h2>How often the diagnosis is right</h2>
${latestBlind ? `<div class="cards">${card(`${latestBlind.score.correct}/${latestBlind.score.n}`, `latest blind score (${latestBlind.set})`)}</div>` : ""}
<ul class="muted">
<li><b>Generated</b>: the failures above. The right answer is known because the lab caused them.</li>
<li><b>Real</b>: error text from public reports and one first-hand case. These were read before the rules were written, so the score is optimistic.</li>
<li><b>Blind batches (variant)</b>: new cases written after the latest rule change and scored once. Once a batch is used to fix rules it is no longer blind, so only the latest one counts. The history is in docs/ROUNDS.md.</li>
<li>Some cases have "unknown" as the right answer, because the text cannot decide the layer. A wrong layer sends support the wrong way; unknown sends them to collect more evidence.</li>
</ul>
${table(["Set", "Evidence", "Correct", "Accuracy", "Wrong layer", "Said unknown", "False positives", "False negatives"], rows)}
${missesTable(run)}
${repro ? `<p>Reproducibility: <b>${repro.stable}/${repro.scenarios}</b> fast local scenarios gave the same verdicts, checks and diagnoses across ${repro.runs} runs.${repro.unstable.length ? ` Unstable: ${esc(repro.unstable.join(", "))}.` : ""}</p>` : ""}
<h3>Real reports with no confirmed cause (not scored)</h3>
${table(["Case", "Text", "Diagnosis"], ev.unscored.map((u) => [link(u.source), `<code>${esc(clip(u.text, 160))}</code>`, `${esc(u.diagnosis.layer)} (${esc(u.diagnosis.confidence)})${u.diagnosis.inference ? `<br><span class="muted">${esc(u.diagnosis.inference)}</span>` : ""}`]))}`;
}

function schemas(run: LabRun) {
  const rows = run.schemas.map((s) => [
    esc(s.tool),
    esc(s.source),
    s.ajvStrict.length ? `<span class="bad">${esc(s.ajvStrict.join("; "))}</span>` : `<span class="good">compiles</span>`,
    s.openAiStrict.length ? esc(s.openAiStrict.join("; ")) : `<span class="good">meets the rules</span>`,
  ]);
  return `<h2>Tool schemas</h2>
<p class="muted">Ajv strict: does the schema compile under a strict JSON Schema validator? OpenAI strict mode: the rules in OpenAI's Structured Outputs docs. Optional fields are a normal design choice; failing these rules means a strict client must convert the schema first, not that the schema is wrong.</p>
${wrap(table(["Tool", "Server", "Ajv strict", "OpenAI strict mode"], rows))}
${run.drift ? drift(run) : `<p class="muted">Production comparison not run. Use <code>--live</code>.</p>`}`;
}

function drift(run: LabRun) {
  const d = run.drift!;
  const same = !d.onlyLocal.length && !d.onlyHosted.length && !d.changedSchemas.length;
  const changed = d.changedSchemas.length ? d.changedSchemas.map((c) => `<b>${esc(c.tool)}</b>: ${esc(c.changes.join("; "))}`).join("<br>") : "none";
  return `<h3>Pinned public server vs production (tools available without a key)</h3>
<table><tr><th>Pinned version</th><td>${esc(d.localVersion)}</td></tr><tr><th>Production version</th><td>${esc(d.hostedVersion)}</td></tr>
<tr><th>Only in pinned</th><td>${esc(d.onlyLocal.join(", ") || "none")}</td></tr><tr><th>Only in production</th><td>${esc(d.onlyHosted.join(", ") || "none")}</td></tr>
<tr><th>Same tool, different schema</th><td>${changed}</td></tr></table>
<p class="muted">${same ? "No differences in tool names or schemas." : "Production differs from the pinned public code, so local results describe the public code and live scenarios describe production."}</p>`;
}

function manual(run: LabRun) {
  if (!run.manual.length) {
    return `<h2>Manual client checks</h2><p class="muted">No manual results recorded. Steps are in <code>manual/README.md</code>; results go in <code>manual/results.json</code>. No client is claimed as tested until it is.</p>`;
  }
  const rows = run.manual.map((m) => [esc(m.client), esc(m.clientVersion), esc(m.date), esc(m.check), `<span class="${m.result === "pass" ? "good" : "bad"}">${esc(m.result)}</span>`, esc(m.evidence)]);
  return `<h2>Manual client checks</h2>${table(["Client", "Version", "Date", "Check", "Result", "Evidence"], rows)}`;
}

function allScenarios(run: LabRun) {
  return `<h2>All scenarios</h2>${run.results.map(scenario).join("")}`;
}

function scenario(s: ScenarioResult) {
  const dx = s.diagnosis;
  const checks = table(["Check", "Result", "Detail"], s.checks.map((c) => [esc(c.name), `<span class="${c.pass ? "good" : "bad"}">${c.pass ? "pass" : "fail"}</span>`, `<code>${esc(c.detail)}</code>`]));
  const requests = s.apiRequests.map((u) => ({ path: u.path, reachedExaApp: u.reachedExaApp, status: u.status, body: u.body }));
  return `<details id="${esc(s.id)}"><summary><b>${esc(s.title)}</b> <span class="tag ${VERDICT_CLASS[s.verdict]}">${esc(s.verdict)}</span> <span class="tag">${esc(s.label)}</span> <span class="muted">${esc(s.id)} &middot; ${s.durationMs} ms</span></summary>
<p>${esc(s.why)}</p>
<p class="muted">Target: ${esc(s.target)} &middot; caused at: ${esc(s.layer)}${s.source ? ` &middot; source: ${link(s.source)}` : ""}</p>
${s.labError ? `<p class="bad">Lab error: ${esc(s.labError)}</p>` : ""}
${checks}
<p><b>Action</b></p><pre>${esc(JSON.stringify(s.action, null, 2))}</pre>
${s.observation ? `<p><b>Agent saw</b> (${esc(s.observation.outcome)}, isError ${s.observation.isError})</p><pre>${esc(s.observation.text)}</pre>` : ""}
${s.http ? `<p><b>HTTP response</b></p><pre>${esc(JSON.stringify({ status: s.http.status, headers: s.http.headers }, null, 2))}</pre>` : ""}
${requests.length ? `<p><b>Requests the server sent to Exa's API</b></p><pre>${esc(JSON.stringify(requests, null, 2))}</pre>` : ""}
${s.serverLog.length ? `<details><summary>Server log (${s.serverLog.length} lines)</summary><pre>${esc(s.serverLog.join("\n"))}</pre></details>` : ""}
${dx ? diagnosisTable(dx.agentView, dx.instrumented) : ""}
${s.tools ? `<p><b>Tools</b>: ${esc(s.tools.map((t) => t.name).join(", "))}</p>` : ""}
<p><b>Reproduce</b>: <code>${esc(s.repro)}</code></p>
</details>`;
}

function diagnosisTable(a: Diagnosis, b: Diagnosis) {
  const row = (label: string, f: (d: Diagnosis) => string) => `<tr><th>${label}</th><td>${f(a)}</td><td>${f(b)}</td></tr>`;
  return `<p><b>Diagnosis</b></p><table><tr><th></th><th>Agent view</th><th>Instrumented</th></tr>
${row("Layer", (d) => `${esc(d.layer)} (${esc(d.confidence)})`)}
${row("Facts", (d) => d.facts.map(esc).join("<br>"))}
${row("Inference", (d) => esc(d.inference ?? ""))}
${row("Next step", (d) => esc(d.nextStep))}
${row("Rule", (d) => `<code>${esc(d.rule)}</code>`)}</table>`;
}

function missesTable(run: LabRun) {
  const misses = run.evaluation.items.filter((i) => i.predicted !== i.expected);
  if (!misses.length) return `<p class="good">No misses.</p>`;
  const rows = misses.map((m) => [esc(m.id), esc(m.set), esc(m.mode), esc(m.expected), `<span class="bad">${esc(m.predicted)}</span>`, `<code>${esc(m.rule)}</code>`]);
  return `<details><summary>${misses.length} miss(es): where the diagnosis was wrong</summary>${table(["Case", "Set", "Evidence", "Expected", "Said", "Rule"], rows)}</details>`;
}

// ---- small helpers ----

const isSurprise = (r: ScenarioResult) => r.verdict === "regressed" || r.verdict === "unexpected" || r.verdict === "error";

function apiLogSummary(c: ScenarioResult) {
  if (c.target === "hosted") return "n/a (production)";
  if (!c.apiRequests.length) return "no request";
  const reached = c.apiRequests.filter((x) => x.reachedExaApp);
  if (!reached.length) return `${c.apiRequests.length} request(s), none reached the app`;
  return `${reached.length} request(s): ${reached.map((x) => x.status ?? "no response").join(", ")}`;
}

/** Green when the diagnosis names the layer the lab caused, red otherwise. */
function diagnosisCell(d: Diagnosis, expected: string) {
  return `<span class="${d.layer === expected ? "good" : "bad"}">${esc(d.layer)}</span> <span class="muted">${esc(d.confidence)}</span>`;
}

function table(head: string[], rows: string[][]) {
  return `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
}

const wrap = (html: string) => `<div class="wrap">${html}</div>`;
const card = (value: number | string, label: string, cls = "") => `<div class="card"><b class="${cls}">${esc(value)}</b><span class="muted">${esc(label)}</span></div>`;
const clip = (s: string | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
};
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
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

const STYLE = `
:root{--bg:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e6;--card:#f7f7f8;--good:#1f7a4d;--bad:#b42318;--info:#365fae;--code:#f1f1f3}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececef;--muted:#9a9aa1;--line:#2c2c31;--card:#1c1c20;--good:#5cc28d;--bad:#ff7b6b;--info:#8fb0f5;--code:#232328}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600}code,pre{font:12.5px/1.45 ui-monospace,Consolas,monospace;background:var(--code);border-radius:6px}
code{padding:1px 5px}pre{padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:6px 0}
ul{padding-left:20px}li{margin:3px 0}
.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid currentColor}
.good{color:var(--good)}.bad{color:var(--bad)}.info{color:var(--info)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:8px 0}.card{background:var(--card);border-radius:10px;padding:12px}
.card b{font-size:22px;display:block}details{border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:8px 12px}
summary{cursor:pointer}summary .tag{margin-left:6px}.wrap{overflow-x:auto}a{color:var(--info)}`;
