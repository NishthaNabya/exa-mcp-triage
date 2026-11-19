// Renders one lab run as a single self-contained HTML page, one section per function.
import type { LabRun } from "./lab.js";
import type { ScenarioResult } from "./run.js";
import type { Diagnosis } from "./types.js";

export function renderHtml(run: LabRun): string {
  const body = [header(run), defects(run), matrix(run), agentSaw(run), evaluation(run), schemas(run), manual(run), allScenarios(run)].join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exa MCP Triage report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body>
<nav class="top"><div class="inner"><span class="brand">MCP Triage</span>${NAV.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}<a href="https://github.com/NishthaNabya/exa-mcp-triage">GitHub</a></div></nav>
<main>
${body}
<footer>An independent project by Nishtha Nabya. Not affiliated with or endorsed by Exa. It tests Exa's open-source MCP server, pinned at a public commit.</footer>
</main></body></html>`;
}

const NAV = [
  ["defects", "Findings"],
  ["matrix", "Compatibility"],
  ["agent-saw", "What the agent saw"],
  ["evaluation", "Accuracy"],
  ["schemas", "Schemas"],
  ["scenarios", "All scenarios"],
];

// ---- sections ----

function header(run: LabRun) {
  const r = run.results;
  const m = run.meta;
  const surprises = r.filter(isSurprise).length;
  const reproduced = r.filter((x) => x.verdict === "reproduced").length;
  return `<header class="hero">
<p class="eyebrow">Exa MCP · failure triage report</p>
<h1>Which layer failed, and what did the agent see?</h1>
<p class="lede">Each scenario makes an Exa MCP call fail in one controlled way, records what the agent received, and names the layer that caused it.</p>
<p class="meta">Run ${esc(m.startedAt)} &middot; Node ${esc(m.node)} &middot; ${esc(m.platform)} &middot; Exa MCP server pinned at <code>${esc(m.pinnedCommit.slice(0, 7))}</code>${run.drift?.hostedVersion ? ` &middot; production reports ${esc(run.drift.hostedVersion)}` : ""} &middot; production checks: ${m.options.live ? "run" : "not run"} &middot; slow scenarios: ${m.options.slow ? "run" : "not run"}</p>
</header>
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
  return `<h2 id="defects">Reproduced defects</h2>${list}${attention}`;
}

function matrix(run: LabRun) {
  const rows = run.matrix.map((m) => [esc(m.client), esc(m.version), esc(m.transport), esc(m.auth), esc(m.server), `<span class="${m.coverage === "not run" ? "muted" : ""}">${esc(m.coverage)}</span>`, esc(m.result)]);
  return `<h2 id="matrix">Compatibility matrix</h2>
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
  return `<h2 id="agent-saw">What the agent saw</h2>
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
  return `<h2 id="evaluation">How often the diagnosis is right</h2>
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
  return `<h2 id="schemas">Tool schemas</h2>
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
  return `<h2 id="scenarios">All scenarios</h2>${run.results.map(scenario).join("")}`;
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

// Palette taken from exa.ai (warm off-white, near-black ink, warm grey lines, blue accent).
// Fonts: Geist and Geist Mono, open source. No Exa logo or wordmark.
const STYLE = `
:root{--bg:#F2F1F0;--surface:#FAF9F8;--fg:#1D1C1A;--muted:#5F5A54;--line:#E2DFDA;--accent:#1F40ED;--good:#2E7D4F;--bad:#C2410C;--info:#1F40ED;--code:#EAE7E3;--nav:rgba(242,241,240,.85)}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--surface:#1B1A18;--fg:#F2F1F0;--muted:#A39E97;--line:#2E2C29;--accent:#7B8FFF;--good:#5CC28D;--bad:#FF8A5C;--info:#7B8FFF;--code:#24231F;--nav:rgba(18,18,17,.85)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 Geist,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
nav.top{position:sticky;top:0;z-index:10;background:var(--nav);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
nav.top .inner{max-width:1120px;margin:0 auto;padding:12px 16px;display:flex;gap:20px;align-items:center;overflow-x:auto;white-space:nowrap;font-size:13.5px}
nav.top a{color:var(--muted)}nav.top a:hover{color:var(--fg);text-decoration:none}
nav.top .brand{font-weight:600;color:var(--fg);margin-right:8px}
main{max-width:1120px;margin:0 auto;padding:0 16px 80px}
.hero{padding:56px 0 24px}
.eyebrow{font:500 12px/1 'Geist Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin:0 0 14px}
h1{font-size:clamp(28px,4vw,42px);line-height:1.12;font-weight:500;letter-spacing:-.02em;margin:0 0 14px;max-width:820px}
.lede{font-size:17px;color:var(--muted);max-width:720px;margin:0 0 14px}
.meta{font-size:13px;color:var(--muted);margin:0}
h2{font-size:22px;font-weight:500;letter-spacing:-.01em;margin:56px 0 14px;scroll-margin-top:64px}
h3{font-size:16px;font-weight:500;margin:28px 0 10px}
.muted{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13.5px;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
th{font:500 11.5px/1.3 'Geist Mono',ui-monospace,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:var(--bg)}
code,pre{font:12.5px/1.5 'Geist Mono',ui-monospace,Consolas,monospace;background:var(--code);border-radius:6px}
code{padding:1px 5px}pre{padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:8px 0}
ul{padding-left:20px}li{margin:4px 0}
.tag{display:inline-block;padding:2px 9px;border-radius:999px;font:500 11.5px/1.5 'Geist Mono',ui-monospace,monospace;border:1px solid currentColor}
.good{color:var(--good)}.bad{color:var(--bad)}.info{color:var(--info)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.card b{font-size:30px;font-weight:500;letter-spacing:-.02em;display:block;line-height:1.2}
.card span{font-size:13px}
details{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:12px 16px}
details details{background:var(--bg)}
summary{cursor:pointer}summary .tag{margin-left:6px}
.wrap{overflow-x:auto}
footer{margin-top:72px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}`;
