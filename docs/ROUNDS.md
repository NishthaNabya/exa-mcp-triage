# Build rounds

Each round ends with a full run. Faults found in the lab's own code are listed here with the fix, so the numbers can be traced.

## Round 1: build end to end

Full run: `npm run lab -- --live --slow --repeat 3`, 2026-11-15.

| Result | Count |
|---|---|
| Scenarios | 36 (32 local, 4 hosted) |
| Pass or as expected | 31 |
| Reproduced defects | 4 (#470 x3, dropped requestId) |
| Not reproduced | 1 (#475) |
| Regressed, unexpected, lab errors | 0 |
| Reproducibility | 31/31 fast local scenarios identical across 3 runs |

Diagnosis accuracy with round-1 rules:

| Set | Evidence | Correct |
|---|---|---|
| generated | agent view | 26/32 (81%) |
| generated | full | 29/32 (91%) |
| real | agent view | 2/5 (40%) |
| variant (blind) | agent view | 12/14 (86%) |

The variant score is the only blind one: the rules were written before the variants and were not changed before this score.

### Faults found in the lab's own code

1. The transport-error branch in `diagnose.ts` caught every connection-level error and called it network, before the edge and client rules could run. This caused 3 of the 3 real misses (#100, #414, #61) and both variant misses.
2. The rule for MCP SDK errors treated `-32000 Connection closed` as a protocol error. In the SDK, -32000 is a closed connection, which is transport. Worse, a missing server command and a crashing server give the same text, because the lab did not capture the spawn error that a real client logs.
3. Full-mode coercion detection matched argument names literally. `web_search_advanced_exa` renames `highlightsMaxCharacters` to `highlights.maxCharacters`, so the highlight case of #470 was missed.
4. Vitest picked up Exa's own test suite under `vendor/` (309 tests instead of 40). Fixed with `vitest.config.ts`.
5. Earlier docs said the `ExaError` in the pinned server carries `requestId`. Reading the locked exa-js 2.16.0 showed it does not; `requestId` was added in exa-js 2.18.0. SCOPE.md was corrected before the code was written.

### Known limits, not faults

- Agent view cannot see #470: the agent gets a normal result. Only Exa's log shows the 0.
- When the client's timeout is shorter than the server's 60s limit, agent view can only blame the client; the real cause is hidden. This is the right answer for what an agent sees, and it counts as a miss against the injected cause.

### Findings from the live run (round 1)

- Production reports version 3.5.1. The latest public commit and npm release are 3.4.3.
- Production's `web_search_exa` lists a new required `objective` argument that 3.4.3 does not have. A keyless call without `objective` still succeeded.
- `?login` answers 401 with a `WWW-Authenticate` header pointing to the OAuth metadata; plain `/mcp` answers 200 on the anonymous tier. This is the fix for #378, and it holds.
- #475 not reproduced: when Exa's API hangs, the server returns its own timeout error at 60s (measured 62s), well before a 300s client limit.

## Round 2: correctness and honesty review

Review questions from the PRD, and what they found beyond the five round-1 faults:

6. A setup failure could pass as a finding. If the server was not built, a call scenario recorded "server failed to start" as an observation and diagnosed it. Now a failed start is an observation only in scenarios that break the start on purpose (`spawn` set); anywhere else it is a lab error.
7. Some checks could pass without testing anything. The #470 highlight check passed if highlights were missing entirely, and "warning not shown" passed on an empty error. Both now also check that the expected content is there.
8. Drift said a schema changed but not how. It now lists argument-level changes.

Fixes for faults 1 to 3: connection-level errors now fall through to the edge and client rules unless they show no response; only JSON-RPC -326xx codes count as protocol; the lab keeps the client's underlying start error (for example `spawn ... ENOENT`), as a real client log would; coercion detection follows the server's prefix renaming (`highlightsMaxCharacters` to `highlights.maxCharacters`).

A new blind batch, variant-2 (12 cases), was written after these fixes and scored once.

Full run, 2026-11-15: 36 scenarios, 0 regressed, 0 unexpected, 0 lab errors, 31/31 reproducible across 3 runs.

| Set | Evidence | Round 1 | Round 2 |
|---|---|---|---|
| generated | agent view | 26/32 | 28/32 |
| generated | full | 29/32 | 32/32 |
| real | agent view | 2/5 | 5/5 (not blind) |
| variant | agent view | 12/14 (blind) | 13/14 (not blind) |
| variant-2 | agent view | n/a | 10/12 (blind) |

Remaining generated misses are the two known limits from round 1. The blind variant-2 misses are real gaps:
- The hosted server's own 401 body ("Authentication required. Use OAuth or provide an API key.") outside a tool result was called client, not auth.
- A tool rejecting an argument combination ("search type 'lite' does not support maxAgeHours") was called a server exception, not invalid input.

Live drift now reads: `web_search_exa` added `objective (required)` in production 3.5.1.

## Round 3: simplicity, a clean clone, and docs

Changes:
- Closed the two variant-2 gaps with rules traced to a source: a 401 outside a tool result is auth (the hosted server's own login challenge, probed live), and messages ending in "does not support ... Remove it" are the tools' own input checks (`src/tools/webSearchAdvanced.ts`), so protocol.
- When an Exa error reaches the agent without a requestId, the diagnosis says so and points support at the Timestamp line instead. This changes wording, not the layer, so no score moved.
- Removed an identity wrapper (`defineScenarios`) and a label no scenario used (`manual`; manual checks have their own file).
- Added LICENSE and `.gitattributes`.
- A new blind batch, variant-3 (8 cases), was written after these changes and scored once.

Fresh clone: `git clone`, `npm ci`, `npm run setup`, `npm test`, `npm run lab` in a new folder, following only the README, run on the final commit. All tests pass and the scores match the run above.

| Set | Evidence | Round 2 | Round 3 |
|---|---|---|---|
| generated | agent view | 28/32 | 28/32 |
| generated | full | 32/32 | 32/32 |
| real | agent view | 5/5 | 5/5 (not blind) |
| variant | agent view | 13/14 | 13/14 (not blind) |
| variant-2 | agent view | 10/12 (blind) | 12/12 (not blind) |
| variant-3 | agent view | n/a | 5/8 (blind) |

The blind variant-3 misses all hit the same weak rule: text in no known format falls back to client. It was right for the Nov 9 case, but it also caught `connect ETIMEDOUT` (network), a hosted HTTP 429 outside a tool result (exa-api) and "exited with code 1" (mcp-server). Rules were not changed after this score, so 5/8 stands as the current blind number.

Next, if this continues: add those three patterns with sources, send unrecognized text to "unknown" instead of client, and score a new blind batch.

## Round 4: say unknown instead of guessing

Changes, each traced to a source:
- Text in no known format now gets "unknown", not client. Round 3's blind batch showed the client guess was wrong 3 times out of 3.
- Text that mentions a "connector" is client. Claude and ChatGPT call remote MCP servers connectors, and Exa's server never sends the word (it appears only in source comments). This keeps the Nov 9 case and #61 right without the old fallback.
- Node's system error codes for no response (ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, EPIPE) count as network; "Cannot find module" counts as a server that never started; "exited with code" and kill signals count as a server process that died.
- The scores now report wrong layers and unknowns separately.
- An explicit compatibility matrix: every client and configuration, with automated, static, manual or not-run coverage.
- A CI workflow (Node 20 and 22). It has not run yet because the repo is not pushed.

A new blind batch, variant-4 (11 cases), was written after these changes and scored once.

| Set | Evidence | Round 3 | Round 4 |
|---|---|---|---|
| generated | agent view | 28/32 | 28/32 |
| generated | full | 32/32 | 32/32 |
| real | agent view | 5/5 | 5/5 (not blind) |
| variant | agent view | 13/14 | 13/14, 1 unknown (not blind) |
| variant-2 | agent view | 12/12 | 12/12 (not blind) |
| variant-3 | agent view | 5/8 (blind) | 7/8, 1 unknown (not blind) |
| variant-4 | agent view | n/a | 10/11 (blind) |

The two remaining unknowns used to be wrong answers (an Envoy proxy reset and a hosted HTTP 429 outside a tool result). The one blind variant-4 miss: "The operation was aborted due to timeout", Node's message when fetch gives up, was read as a server exception instead of network. Rules were not changed after this score.

Credits check, 2026-11-15: the account's request log for the last 24 hours had no request from the lab or from Claude Code.

Full run: 36 scenarios, 0 regressed, 0 unexpected, 0 lab errors, 31/31 reproducible across 3 runs. Tests: 51 passing.

## Published

2026-11-19: pushed to GitHub and renamed to exa-mcp-triage. The first CI run passed on Ubuntu with Node 20 and 22: setup, typecheck, tests and the offline lab run.

## Round 5: an outside code review

An outside review of the published repo read the code, not the README. Every finding below was checked against the code before fixing.

1. Server death mid-call was misclassified. When the connection drops during a call, the MCP SDK rejects the pending request with McpError -32000 (ConnectionClosed). `observe.ts` labeled that an MCP protocol error, so the transport rule never ran and the diagnosis said unknown. The old test built the observation by hand and missed it. Fixed in `observe.ts`; a new integration test starts a stand-in server that dies on the call and checks the real `callTool` path end to end. It failed before the fix and passes after.
2. `--only` skipped the opt-in flags, so `--only hosted-keyless-search` reached production without `--live`. Selection now always applies `--live` and `--slow`, and naming a scenario without its flag stops with a message.
3. Full mode never read the server log, although the docs said it did. It now reads it: logged errors and API warnings become facts, and one rule uses it (the server logged a successful finish but the agent got an error, so the error came from the client side).
4. "fetch failed" alone was rated certain. From the agent's text it is now "likely"; it becomes certain only when the request log backs it up.
5. Redaction only knew secret header names. Object fields named like secrets (`apiKey`, `api_key`, `*Token`, `*Secret`, `password`) are now redacted at any depth.
6. Full-mode accuracy was instrument-assisted: the fake API knows whether a request reached Exa's app because the lab decided it. The mode is now called instrumented everywhere, with that caveat stated next to its score.

A new blind batch, variant-5 (22 cases), was written after these fixes and scored once. It adds overlapping cases (two layers producing similar text) and cases whose right answer is unknown, to test whether the diagnosis overclaims.

| Set | Evidence | Round 4 | Round 5 |
|---|---|---|---|
| generated | agent view | 28/32 | 28/32 |
| generated | instrumented | 32/32 | 32/32 |
| real | agent view | 5/5 | 5/5 (not blind) |
| variant-4 | agent view | 10/11 (blind) | 10/11 |
| variant-5 | agent view | n/a | 20/22 (blind) |

Blind variant-5 misses:
- A client timeout of 120s was read as network; with only that text, the honest answer is unknown.
- "unable to verify the first certificate" (TLS) was read as an MCP server exception. Together with round 4's "operation was aborted due to timeout", this shows the fallback for unrecognized "<tool> error: ..." text is now the weakest rule.

Rules were not changed after this score. Tests: 60 passing. Full run on Windows: 36 scenarios, 0 regressed, 0 unexpected, 0 lab errors, 31/31 reproducible across 3 runs.
