# Development history

How the lab was built, what went wrong along the way, and how the scores moved. Problems found in the lab's own code are listed with their fix, so every number can be traced.

## Where it stands now

- 36 scenarios (32 local, 4 against production). On every full run: 4 defects reproduced, 1 public report not reproduced, 0 regressions, 0 lab errors, and 31 of 31 fast scenarios give the same result on every repeat.
- 61 tests of the lab itself, passing on Windows and in GitHub Actions on Ubuntu with Node 20 and 22.
- Latest blind score: 20 of 22 from the agent's text alone.
- Published at github.com/NishthaNabya/exa-mcp-triage since 2026-11-19 (first named exa-mcp-fault-lab).

## Scores over time

Two amounts of evidence: agent view (only the text the agent saw) and instrumented (also the stand-in API's request log and the server log; called "full" before round 5). "Blind" means scored once, before any rule was changed because of it. A blind batch stops being blind once it is used to fix rules, so its later numbers are shown for completeness only.

| Cases | Evidence | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|---|
| generated | agent view | 26/32 | 28/32 | 28/32 | 28/32 | 28/32 |
| generated | instrumented | 29/32 | 32/32 | 32/32 | 32/32 | 32/32 |
| real | agent view | 2/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| variant | agent view | **12/14** | 13/14 | 13/14 | 13/14 | 13/14 |
| variant-2 | agent view | | **10/12** | 12/12 | 12/12 | 12/12 |
| variant-3 | agent view | | | **5/8** | 7/8 | 7/8 |
| variant-4 | agent view | | | | **10/11** | 10/11 |
| variant-5 | agent view | | | | | **20/22** |

Bold marks each batch's blind score. The real cases were read before the rules were written, so their score was never blind.

## Round 1: build it end to end (2026-11-15)

What was built: the stand-in Exa API, Exa's MCP server pinned at commit `93c0d5e` and run locally, 36 scenarios, the two-mode diagnosis, scoring, schema and drift checks, the JSON and HTML reports, and tests for the lab itself.

Problems found in the lab's own code:
1. Every connection-level error was called network before the edge and client rules could run. This caused all three real misses (#100, #414, #61) and both blind misses.
2. `MCP error -32000: Connection closed` was treated as a protocol error. In the MCP SDK, -32000 is a closed connection. Worse, a missing server command and a crashing server gave the same text, because the lab did not keep the start error a real client logs.
3. The changed-argument check matched names literally. `web_search_advanced_exa` renames `highlightsMaxCharacters` to `highlights.maxCharacters`, so one #470 case was missed.
4. The test runner also picked up Exa's own test suite under `vendor/` (309 tests instead of 40).
5. An early doc said the pinned server's error class carries the request ID. Reading the locked exa-js 2.16.0 showed it does not; exa-js added it in 2.18.0. Corrected before any code depended on it.

Findings from the first live run:
- Production reports version 3.5.1; the latest public commit and npm release are 3.4.3.
- Production's `web_search_exa` adds a required `objective` argument. A call without it still succeeded.
- `?login` answers 401 with a login challenge pointing to the OAuth metadata; plain `/mcp` answers 200 on the free tier. The fix for #378 holds.
- #475 not reproduced: when Exa's API hangs, the server reports its own timeout at 60 seconds (measured 62), well before a 300-second client limit.

## Round 2: correctness and honesty

Problems found:
1. A setup failure could pass as a finding: if the server was not built, a scenario recorded "server failed to start" and diagnosed it.
2. Some checks could pass without testing anything, such as "warning not shown" on an empty error.
3. Drift said a schema changed but not how.

What changed: fixes for round 1's problems 1 to 3 and the three above. A failed start is now a finding only in scenarios that break the start on purpose. Checks also confirm the expected content is there. Drift lists argument-level changes. A new blind batch, variant-2, was written after the fixes.

Result: real cases 5/5; blind variant-2 10/12. Its two misses were gaps: the production server's own 401 body was called client, and a tool rejecting an argument combination was called a server exception.

## Round 3: simplicity and a clean clone

What changed: the two variant-2 gaps were closed with rules traced to a source (the production 401, probed live; the tools' own input checks in `webSearchAdvanced.ts`). When an Exa error reaches the agent without a request ID, the diagnosis now points support at the timestamp instead. An identity wrapper and an unused label were removed. LICENSE added. A clone in a new folder, following only the README, gave the same results.

Result: blind variant-3 5/8. All three misses hit one weak rule: text in no known format was blamed on the client. Right for the Nov 9 case, wrong for `connect ETIMEDOUT`, a production HTTP 429 and a crashed server process.

## Round 4: say unknown instead of guessing

What changed:
- Text in no known format now gets "unknown", and the scores count unknown apart from a wrong layer.
- Text mentioning a "connector" is client: Claude and ChatGPT call remote MCP servers connectors, and Exa's server never sends the word.
- More of Node's no-response error codes count as network; "Cannot find module" means the server never started; "exited with code" and kill signals mean it died.
- An explicit compatibility matrix and a CI workflow were added.
- Checked against the account's request log: no request from the lab, so it spends no credits.

Result: blind variant-4 10/11. The miss: Node's "The operation was aborted due to timeout" was read as a server exception instead of network.

## Round 5: an outside code review (2026-11-19)

An outside review read the published code. Every finding was checked against the code before fixing:
1. A server dying mid-call was misclassified. The SDK reports it as McpError -32000, which `observe.ts` labeled a protocol error, so the diagnosis said unknown. The old test built the observation by hand and missed it. A new integration test runs a stand-in server that dies on the call; it failed before the fix and passes after.
2. `--only` skipped the opt-in flags, so `--only hosted-keyless-search` reached production without `--live`. Now it stops and names the missing flag.
3. "Full" mode never read the server log, although the docs said it did. It now does: logged errors and warnings become facts, and if the server logged a successful finish but the agent got an error, the error came from the client side.
4. "fetch failed" alone was rated certain. It is now "likely" unless the request log backs it up.
5. Redaction only knew secret header names. Fields named like secrets (`apiKey`, `*Token`, `*Secret`, `password`) are now redacted at any depth.
6. Full-mode accuracy was assisted by the lab's own knowledge of where each request went. The mode was renamed instrumented, with that limit stated next to its score.

Also: links in the report were unreadable in dark mode; fixed.

Result: a new blind batch, variant-5 (22 cases), added errors that look alike across layers and cases where the right answer is unknown. Score 20/22. Misses: a 120-second client timeout was read as network when the honest answer is unknown, and a TLS certificate error was blamed on the MCP server.

## Round 6: readability (2026-11-19)

A second outside review read the docs and code for clarity. Nothing about behavior changed.

What changed:
- One name per idea: "full" became "instrumented" everywhere; `UpstreamExchange` became `ApiRequestRecord`; `reachedApp` became `reachedExaApp`; the log of requests is `apiRequests` and a scenario's planned failure is `fakeApi` (both used to be called `upstream`); `coercedArgs` became `findChangedArguments`; the diagnosis helper `d()` became `createDiagnosis()`.
- `diagnose.ts` is in four sections: error patterns, next steps, agent-view diagnosis, instrumented diagnosis.
- The report is built one section per function, and its evaluation note is a short list with the latest blind score shown first.
- The README explains the problem and the idea before any term, defines terms in plain words, and moves detail below a simpler findings table.
- This history was rewritten from round notes into one timeline.

Proof that behavior did not change: a full run before and after was reduced to 381 lines (every scenario's verdict, checks, both diagnoses, request log and every scored case), and the two were identical. While restructuring, one path changed by accident (an Exa error with an unknown status); it was caught by comparing the old and new order rule by rule, restored, and covered by a test.

## Current limitations

- Agent view cannot see failures that return a normal result, such as #470. Instrumented mode can.
- When a client gives up before the server's 60-second limit, the agent's text hides the real cause.
- Unrecognized "`<tool> error: ...`" text is blamed on the MCP server; that was wrong for TLS and abort-timeout errors. A long client timeout is read as network when the honest answer is unknown. These are the next rules to change, followed by a new blind batch.
- Instrumented scores assume perfect internal logs; real support would get them from Exa's own edge and app logs.
- Claude Desktop, Cursor and ChatGPT are not tested yet. They need a person; steps are in `manual/README.md`.
- Local results describe the pinned public code; production runs a newer version, covered only by the live checks.
