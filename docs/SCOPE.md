# Exa MCP Triage: scope

## The idea in one paragraph

When an AI agent calls Exa through MCP and something goes wrong, the error passes through several layers before anyone sees it: the Exa API, Cloudflare in front of it, Exa's MCP server, and the agent's own client. Each layer can rewrite or drop the error. By the time a developer files a ticket, all a support engineer has is the text the agent saw. This project breaks things on purpose, one layer at a time, against Exa's real MCP server code, and records exactly what the agent ends up seeing. From that it learns to answer the first question of every MCP ticket: which layer failed, and what should the developer do next?

## Why this problem

These come from public evidence and from my own Exa usage. Each one was checked.

1. MCP is the largest public pain area for Exa: about 27 non-spam GitHub issues, including the most-commented issue in the org (#66).
2. Errors get rewritten on the way to the agent. On Nov 9, 2026, my agent got "The connector's server is rate-limiting requests" from an Exa fetch. That sentence is not in Exa's MCP server, and Exa's request log shows no request at that time. The client's connector produced it, not Exa.
3. The request ID never reaches the agent. Exa's API returns `requestId` and `tag` on every error, but the MCP server's lockfile pins exa-js 2.16.0, whose `ExaError` has no `requestId` field, so the SDK throws both away. exa-js added `requestId` in 2.18.0 (Aug 13, 2026). Even with that version, `formatToolError` in `src/utils/errorHandler.ts` prints only the status, message and timestamp. A bot PR (#217) tried to add the ID in March 2026 and was closed unmerged.
4. Some failures look like success. A 200 can carry per-URL crawl failures. A null `maxAgeHours` becomes 0 and forces a live crawl (#470, open).
5. Some failures never reach Exa's application at all: Cloudflare 403 and 520 pages with no Exa tag or request ID (#100, #367, #414, #446).

A support engineer handles these by hand today. A tool that reproduces them and names the failing layer saves that time on every ticket.

## Goal

Given a failing Exa MCP call, tell a support engineer which layer failed, what the agent saw, what Exa expected, and the next step, with evidence and a repro command. Measure how often that diagnosis is right.

## In scope, and why each piece

| Piece | What it is | Why it is in |
|---|---|---|
| Fake Exa API | A small local server that answers like Exa's API, or fails on cue | Lets us run every failure for free and on demand. Exa's server reads `EXA_API_BASE_URL`, so no patching is needed. |
| Real Exa MCP server, pinned | Exa's own code at commit `93c0d5e` (v3.4.3), built and run over stdio | We test what users actually run, not a copy. Pinning makes results reproducible. |
| Scenario engine | Each scenario sets an upstream condition, makes a tool call and checks what came back | New cases are a few lines. The engine does not change. |
| What the agent saw | For each scenario, record whether the result is marked as an error, and whether it keeps the request ID, the tag and retry guidance | This is the core finding. A 200 or an MCP success is not proof the agent got what it needed. |
| Layer diagnosis | Rules that read the evidence and name the layer: client, edge, MCP server, Exa API, network | This is the support skill, written down so it can be checked. |
| Evaluation | A labeled set of cases with known answers, scored for accuracy, false positives and false negatives | A diagnosis tool is only useful if we know how often it is right. |
| Live checks | A few calls to Exa's hosted MCP server on its free keyless tier | Confirms the pinned code still matches what Exa runs today. Costs no credits. |
| Schema checks | Run Exa's tool schemas through strict validators (Ajv strict, OpenAI strict mode rules) | A real failure came from this: strict validators rejected every request carrying `agent_run` until #451 fixed its schema (#447). This is client compatibility we can test without the clients. |
| Issue regressions | Turn #470, #378, #461, #475 and the missing request ID into labeled scenarios | Ties the tool to real reports. |
| Reports | Terminal summary, JSON per run, one local HTML report | The HTML report is what a support engineer or an Exa engineer reads. |

## Out of scope, and why

| Left out | Why |
|---|---|
| React dashboard | The report is read-only. A static HTML file does the job with no build step. |
| SQLite or any database | One JSON file per run is enough to compare runs. A database adds a native dependency on Windows for no gain. |
| Docker | Node is the only runtime. Docker adds setup without making results more reproducible than a pinned commit and a lockfile. |
| LLM-graded explanations | Every check here can be decided by code. An LLM grader adds cost and noise. If added later, it stays separate from the pass/fail checks. |
| Claude Desktop and Cursor automation | Neither can be driven by a script. They get a written manual test procedure, and their results are recorded as manual. |
| Search quality evaluation | Exa's search team owns relevance and runs its own evals. This project stays on errors and integration behavior. |
| MCP client logging | Exa already logs the MCP client on each request (its dashboard shows it). |

## How every result is labeled

Each scenario carries one label, and the report shows it. Nothing is called verified that was not run.

- Reproduced defect: we ran it against the pinned code and saw the bug.
- Regression test: it passes today and should keep passing.
- Simulated condition: we created the condition with the fake API. It shows how the server reacts, not that the condition happens in production.
- External report, not reproduced: a public report we could not reproduce. We say so.
- Manual: a person ran it in a client we cannot automate. Evidence is attached.

## Success criteria

1. One command runs the full offline suite from a fresh clone in under two minutes and needs no API key.
2. At least 25 scenarios across the layers, each with a label and a repro command.
3. The diagnosis is scored on a labeled set that includes held-out cases not used while writing the rules. Both scores are reported separately.
4. The Nov 9 case and the missing request ID are shown end to end in the report.
5. No secret appears in any report or log. A test checks this.
6. The repo has its own unit tests, and they pass in CI.

## Risks

- The diagnosis rules could be tuned to the test set, which makes accuracy look better than it is. Rules come from Exa's source code and docs, and held-out cases are scored separately.
- The hosted server can change at any time. Live checks record the date and the server version they saw.
- The free keyless tier is limited to 3 requests per second. Live checks run slowly and are opt-in.
- Exa may already have internal tests for some of this. Their repo has unit tests and fixtures, so this project matches their fixture format to make findings easy to adopt.

## Plan

Round 1 builds the whole thing end to end. Round 2 reviews it for correctness and honest labels and fixes what it finds. Round 3 reviews it for simplicity and a clean fresh-clone run, then writes the README.
