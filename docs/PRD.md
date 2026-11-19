# Exa MCP Triage: product requirements

## Who it is for

- A support engineer with a ticket that says "Exa MCP is broken" and a pasted error. They need the failing layer and the next step in minutes.
- A forward deployed engineer setting up a customer. They need to check a configuration before go-live.
- A developer experience engineer. They need to see where errors, schemas or docs confuse agents.

## How it works

```
scenario ──> fake Exa API (set to fail in one specific way)
                 ^
                 | HTTP, via EXA_API_BASE_URL
                 |
            Exa MCP server, real code pinned at 93c0d5e, run over stdio
                 ^
                 | MCP
                 |
            lab client (official MCP SDK) ──> observation ──> checks + diagnosis ──> report
```

Live mode swaps the left side: the lab client talks to `https://mcp.exa.ai/mcp` on the free keyless tier, with no fake API.

Simple example: a scenario tells the fake API to answer `/search` with a 429 and `tag: RATE_LIMIT_EXCEEDED, requestId: req_123`. The lab calls `web_search_exa`. The observation shows what the agent got: an error result whose text has the status and message but not `req_123`. The check on the request ID fails, the diagnosis names the MCP server layer, and the report shows the exact text the agent saw next to what Exa sent.

## Layers

Every diagnosis names one of these.

| Layer | Meaning | Example |
|---|---|---|
| client | The agent's MCP client or connector made or changed the error | Nov 9: "The connector's server is rate-limiting requests" |
| network | No HTTP response at all: DNS, TLS, connection reset, timeout | A request that hangs until the client gives up (#475, simulated) |
| edge | Cloudflare or another proxy answered, not Exa's app | HTML 403 or 520 page, `cf-ray` header, no Exa request ID |
| auth | The key or login was missing, wrong or not challenged | `INVALID_API_KEY`; no 401 challenge for OAuth clients (#378) |
| protocol | MCP itself failed: initialize, session, tool list, invalid params | Tool call rejected by schema validation |
| mcp-server | Exa's MCP server changed the request or the result | `null` becomes 0 (#470); request ID dropped from errors |
| exa-api | Exa's API returned an error or a partial result | 402 `NO_MORE_CREDITS`; a 200 with failed URL statuses |

## Requirements

R1. Fake Exa API. Serves `/search` and `/contents` with bodies in the shape of Exa's own test fixtures. Can fail in these ways: tagged Exa error (any status, tag, message, request ID), Cloudflare-style HTML page with `cf-ray`, non-JSON body, slow or hanging response, closed connection, 200 with failed URL statuses, 200 with warnings and notices. Records every request it receives so checks can read what the MCP server actually sent.

R2. Local target. Clones Exa's MCP server at a pinned commit, builds it, and runs it over stdio with `EXA_API_BASE_URL` pointed at the fake API and a fake key. Captures its stderr, where it logs warnings.

R3. Hosted target. Connects to `https://mcp.exa.ai/mcp` over Streamable HTTP with no key. Opt-in with `--live`. At most one call per second, to stay under the free tier's 3 per second.

R4. Session checks. Initialize, record server name, version and protocol version, list tools, and handle timeouts and closed connections without crashing the run.

R5. Scenarios. Each one has: id, title, layer under test, label (reproduced, regression, simulated, external, manual), target, how the fake API fails, tool and arguments, checks, and timeout. Written in TypeScript so they are type-checked. Adding one means adding one object to a file.

R6. Observation. One plain record per call: how the call ended (transport error, MCP error, tool error, success), the content the agent got, structured content and `_meta`, the requests the fake API received, server stderr lines, and timings.

R7. Checks. Small functions over the observation that return pass or fail with a reason. For example: the result is marked as an error; the text contains Exa's request ID; the request sent to Exa has no `maxAgeHours`; warnings are not shown to the model; notices are.

R8. Diagnosis. Reads the evidence and returns: layer, confidence (certain, likely or unknown), the observed facts, the inference kept separate from the facts, and the next step. Works in two modes. Agent-view mode sees only what the agent saw, which is what a support engineer gets in a ticket. Instrumented mode (first called full mode) also reads the server log and the fake API's request log. Both are scored.

R9. Evaluation. Scores the diagnosis on labeled cases:
- Generated cases: every scenario has a known layer, because we caused the failure.
- Held-out cases: written separately and never used while writing the rules. These are real error texts (the Nov 9 message, error snippets from public GitHub issues with a known cause) and new variants (other Cloudflare pages, other status codes).
- Metrics: detection rate, layer accuracy, per-layer precision and recall, false positives, false negatives, and reproducibility (each scenario run three times must give the same verdict). Generated and held-out scores are reported separately, so a tuned-to-the-test score cannot hide.

R10. Schema checks. Pull tool schemas from both targets. Compile each with Ajv in strict mode, and check it against OpenAI's documented strict-mode rules, with the source linked in the code. Report failures per tool.

R11. Reports. A terminal summary; one JSON file per run in `runs/`; one self-contained HTML report with the environment (OS, Node version, server commit, hosted server version), every scenario with its label, evidence and repro command, the table of failure condition against what the agent saw, evaluation scores, schema results and manual results.

R12. Secrets. Keys come only from environment variables. Everything captured passes through one redact function before it is stored. A test fails if a key, token or `exaApiKey` query value appears in any output.

R13. Manual clients. Written test steps for Claude Desktop and Cursor. Results are entered in `manual/results.json` with the date, client version and a screenshot path, and shown in the report as manual.

R14. Real client, optional. If the Claude Code command line tool is installed and logged in, run a few scenarios through it headless and record what the agent did. Otherwise this section of the report says it was skipped and why.

## Non-functional

- Runs offline by default. `npm run lab` needs no key and no network after setup.
- Same inputs give the same outputs. No random data in checks.
- Works on Windows, macOS and Linux with Node 20 or later.
- Few dependencies. Each one has a reason below.
- Costs nothing to run. Live mode uses only the free keyless tier.

## Tech stack, and why

| Choice | Why | Rejected, and why |
|---|---|---|
| TypeScript on Node 20 | Exa's MCP server is TypeScript on Node 20, so we use the same SDK and types, and Exa engineers can read it with no context switch | Python: would mean a second SDK and a different runtime from the system under test |
| Official MCP SDK (`@modelcontextprotocol/sdk`) | The client and both transports (stdio, Streamable HTTP) already exist and follow the spec. Writing our own would test our code, not Exa's | A hand-written JSON-RPC client |
| Run Exa's server as a separate process | Tests the built artifact that users run, exactly as an MCP client would. Their internals can change without breaking us | Importing their modules directly: faster, but couples us to private code and skips the transport |
| `node:http` for the fake API | Two routes and a few failure modes need no framework | Express or Fastify: an extra dependency for no gain |
| Scenarios as TypeScript objects | Type-checked, checks are plain functions, no parser | YAML: needs a parser and a small language for checks |
| Ajv | The standard JSON Schema validator, with a real strict mode | Writing our own schema rules |
| Vitest | Fast TypeScript tests, and the same runner Exa's repo uses | Jest: slower setup with TypeScript |
| `tsx` and `tsc` | Run TypeScript directly in development, type-check in CI | A bundler: not needed for a command line tool |
| `node:util` parseArgs | Built in, enough for a few flags | Commander or yargs |
| JSON files per run | Easy to diff, commit and read | SQLite: a native module on Windows and a schema to maintain |
| One HTML file from a template string | Read-only report, opens anywhere, no build step | React: a build pipeline for a static page |

Runtime dependencies: the MCP SDK and Ajv. Development: TypeScript, tsx, Vitest.

## Repo layout

```
src/
  fake-exa/       fake Exa API: routes, failure modes, request log
  targets/        local (pinned server over stdio) and hosted (Streamable HTTP)
  scenarios/      scenario definitions, grouped by layer
  observe.ts      turns a call into an observation
  checks.ts       check functions
  diagnose.ts     layer diagnosis rules
  evaluate.ts     scoring on labeled cases
  schemas.ts      Ajv and strict-mode checks
  report/         JSON and HTML output
  redact.ts       secret removal
  cli.ts          entry point
eval/             held-out cases, kept apart from the rules
manual/           manual test steps and results
scripts/          setup: clone and build Exa's server at the pinned commit
test/             tests for the lab itself
docs/             this file, SCOPE.md, findings
```

## Build rounds

Round 1. Build everything above end to end and run it.

Round 2. Review for correctness and honesty, then fix:
- Does every label match what actually ran?
- Can any check pass without testing anything?
- Does agent-view diagnosis use only what an agent would see?
- Are held-out cases truly untouched by the rules?
- Do failure paths (timeouts, crashes, a bad build) behave well?
- Can any secret leak?

Round 3. Review for simplicity, then fix:
- Remove unused code, layers of indirection and options nobody uses.
- Make names and short comments explain the reasoning.
- Run from a fresh clone in a new folder, following only the README.
- Write the README with screenshots, and record a short demo of one real failure and its diagnosis.

## Assumptions to confirm during the build

- The pinned server builds on Windows. Its build script ends with `chmod`, which fails in Windows `cmd`, so setup runs the same esbuild command directly.
- The hosted server still allows keyless calls at 3 per second, as Exa's February 2026 changelog says.
- Exa's API error format matches Exa's error-codes page: `requestId`, `error`, `tag`.
