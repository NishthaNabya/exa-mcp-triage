// Entry point: npm run lab -- [--live] [--slow] [--repeat N] [--only id,id] [--out dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { startFakeExa } from "./fake-exa/server.js";
import { runLab } from "./lab.js";
import { FAKE_KEY, SERVER_BUNDLE } from "./targets.js";
import { redactDeep } from "./redact.js";
import { renderHtml } from "./report.js";
import type { ScenarioResult } from "./run.js";
import { scenarios } from "./scenarios.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false }, // also run against mcp.exa.ai (keyless, no credits)
    slow: { type: "boolean", default: false }, // include scenarios that take a minute or more
    repeat: { type: "string", default: "3" }, // runs of each fast local scenario, for reproducibility
    only: { type: "string" }, // comma-separated scenario ids
    out: { type: "string", default: root },
    list: { type: "boolean", default: false },
    serve: { type: "string" }, // start one scenario's fake API for a manual test in a real client
  },
});

if (values.list) {
  for (const s of scenarios) console.log(`${s.id.padEnd(40)} ${s.target.padEnd(7)} ${s.label.padEnd(24)} ${s.title}`);
  process.exit(0);
}

if (values.serve) {
  const s = scenarios.find((x) => x.id === values.serve && x.target === "local" && x.upstream);
  if (!s) {
    console.error(`--serve needs a local scenario with a fake API, e.g. request-id-dropped. Run with --list.`);
    process.exit(2);
  }
  const fake = await startFakeExa(s.upstream!);
  const config = {
    mcpServers: {
      "exa-fault-lab": {
        command: "node",
        args: [SERVER_BUNDLE],
        env: { EXA_API_KEY: FAKE_KEY, EXA_API_BASE_URL: fake.url, ...s.serverEnv },
      },
    },
  };
  console.log(`Fake Exa API for "${s.id}" is running at ${fake.url}\n${s.title}\n`);
  console.log(`Add this server to your MCP client config, then ask the agent to use ${s.action.type === "call" ? s.action.tool : "the tool"}:\n`);
  console.log(JSON.stringify(config, null, 2));
  console.log(`\nPress Ctrl+C to stop. Steps and how to record results: manual/README.md`);
  await new Promise(() => {});
}

const only = values.only?.split(",").map((s) => s.trim()).filter(Boolean);
const unknown = only?.filter((id) => !scenarios.some((s) => s.id === id)) ?? [];
if (unknown.length) {
  console.error(`Unknown scenario id(s): ${unknown.join(", ")}. Run with --list to see them.`);
  process.exit(2);
}

const MARK: Record<ScenarioResult["verdict"], string> = {
  pass: "pass        ",
  "as-expected": "as expected ",
  reproduced: "REPRODUCED  ",
  "not-reproduced": "not reprod. ",
  regressed: "REGRESSED   ",
  unexpected: "UNEXPECTED  ",
  error: "LAB ERROR   ",
};

const run = await runLab(
  scenarios,
  {
    live: values.live,
    slow: values.slow,
    repeat: Math.max(1, Number(values.repeat) || 1),
    ...(only && { only }),
    onResult: (r) => {
      const dx = r.diagnosis ? `  -> ${r.diagnosis.agentView.layer} / ${r.diagnosis.full.layer}` : "";
      console.log(`${MARK[r.verdict]} ${r.id} (${r.durationMs} ms)${dx}${r.labError ? `  ${r.labError}` : ""}`);
    },
  },
  root,
);

const stamp = run.meta.startedAt.replace(/[:.]/g, "-");
const runsDir = join(values.out, "runs");
const reportDir = join(values.out, "report");
mkdirSync(runsDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });
const safe = redactDeep(run);
writeFileSync(join(runsDir, `${stamp}.json`), JSON.stringify(safe, null, 2));
writeFileSync(join(reportDir, "index.html"), renderHtml(safe));

const count = (v: ScenarioResult["verdict"]) => run.results.filter((r) => r.verdict === v).length;
console.log(`\n${run.results.length} scenarios: ${count("pass")} pass, ${count("as-expected")} as expected, ${count("reproduced")} reproduced defects, ${count("not-reproduced")} not reproduced, ${count("regressed")} regressed, ${count("unexpected")} unexpected, ${count("error")} lab errors`);
for (const s of run.evaluation.scores) {
  if (s.score.n) console.log(`diagnosis ${s.set}/${s.mode}: ${s.score.correct}/${s.score.n} correct (${Math.round(s.score.accuracy * 100)}%), ${s.score.wrong} wrong, ${s.score.abstained} unknown`);
}
if (run.evaluation.reproducibility) {
  const r = run.evaluation.reproducibility;
  console.log(`reproducibility: ${r.stable}/${r.scenarios} scenarios identical across ${r.runs} runs`);
}
console.log(`\nJSON:   ${join(runsDir, `${stamp}.json`)}\nReport: ${join(reportDir, "index.html")}`);

// Fail the process only on surprises. Reproduced defects are expected findings.
process.exit(count("regressed") + count("unexpected") + count("error") > 0 ? 1 : 0);
