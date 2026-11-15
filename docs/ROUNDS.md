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
