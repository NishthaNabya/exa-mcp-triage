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

### Findings from the live run

- Production reports version 3.5.1. The latest public commit and npm release are 3.4.3.
- Production's `web_search_exa` lists a new required `objective` argument that 3.4.3 does not have. A keyless call without `objective` still succeeded.
- `?login` answers 401 with a `WWW-Authenticate` header pointing to the OAuth metadata; plain `/mcp` answers 200 on the anonymous tier. This is the fix for #378, and it holds.
- #475 not reproduced: when Exa's API hangs, the server returns its own timeout error at 60s (measured 62s), well before a 300s client limit.
