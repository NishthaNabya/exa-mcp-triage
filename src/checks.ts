// Small checks over what a scenario observed. Each returns pass or fail with a reason.
import type { Observation, ApiRequestRecord } from "./types.js";

export interface CheckContext {
  obs?: Observation;
  apiRequests: ApiRequestRecord[];
  serverLog: string[];
  tools?: { name: string; inputSchema: unknown }[];
  server?: { name?: string; version?: string };
  http?: { status: number; headers: Record<string, string>; body: string };
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Check {
  name: string;
  run(ctx: CheckContext): { pass: boolean; detail: string };
}

const check = (name: string, run: Check["run"]): Check => ({ name, run });
const text = (ctx: CheckContext) => ctx.obs?.text ?? "";
const short = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}...` : s);

export const isError = (expected: boolean) =>
  check(`result is ${expected ? "" : "not "}marked as an error`, (ctx) => ({
    pass: ctx.obs?.isError === expected,
    detail: `isError = ${ctx.obs?.isError}, outcome = ${ctx.obs?.outcome}`,
  }));

export const outcomeIs = (outcome: Observation["outcome"]) =>
  check(`call ends as ${outcome}`, (ctx) => ({ pass: ctx.obs?.outcome === outcome, detail: `outcome = ${ctx.obs?.outcome}` }));

export const textIncludes = (needle: string, name = `agent text includes "${needle}"`) =>
  check(name, (ctx) => ({ pass: text(ctx).includes(needle), detail: `text: ${short(text(ctx))}` }));

export const textExcludes = (needle: string, name = `agent text does not include "${needle}"`) =>
  check(name, (ctx) => ({ pass: !text(ctx).includes(needle), detail: `text: ${short(text(ctx))}` }));

export const textMatches = (re: RegExp, name: string) =>
  check(name, (ctx) => ({ pass: re.test(text(ctx)), detail: `text: ${short(text(ctx))}` }));

export const apiRequestCount = (path: string, n: number) =>
  check(`Exa API received ${n} request(s) on ${path}`, (ctx) => {
    const got = ctx.apiRequests.filter((x) => x.path === path).length;
    return { pass: got === n, detail: `received ${got}` };
  });

export const apiRequestBody = (path: string, name: string, test: (body: Record<string, unknown>) => boolean) =>
  check(name, (ctx) => {
    const x = ctx.apiRequests.find((u) => u.path === path);
    const body = (x?.body ?? {}) as Record<string, unknown>;
    return { pass: x !== undefined && test(body), detail: x ? `body sent: ${short(JSON.stringify(body))}` : `no request on ${path}` };
  });

export const apiRequestHeader = (path: string, header: string, test: (value: string | undefined) => boolean, name: string) =>
  check(name, (ctx) => {
    const value = ctx.apiRequests.find((u) => u.path === path)?.headers[header];
    return { pass: test(value), detail: `${header}: ${value ?? "(missing)"}` };
  });

export const serverLogIncludes = (needle: string, name = `server log includes "${needle}"`) =>
  check(name, (ctx) => ({ pass: ctx.serverLog.some((l) => l.includes(needle)), detail: `${ctx.serverLog.length} log line(s)` }));

export const toolsInclude = (names: string[]) =>
  check(`tools/list includes ${names.join(", ")}`, (ctx) => {
    const have = new Set((ctx.tools ?? []).map((t) => t.name));
    const missing = names.filter((n) => !have.has(n));
    return { pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : `tools: ${[...have].join(", ")}` };
  });

export const httpStatus = (status: number) =>
  check(`HTTP status is ${status}`, (ctx) => ({ pass: ctx.http?.status === status, detail: `status = ${ctx.http?.status}` }));

export const httpHeaderMatches = (header: string, re: RegExp) =>
  check(`${header} header matches ${re}`, (ctx) => {
    const v = ctx.http?.headers[header];
    return { pass: v !== undefined && re.test(v), detail: `${header}: ${v ?? "(missing)"}` };
  });

export const serverVersion = (version: string) =>
  check(`server reports version ${version}`, (ctx) => ({ pass: ctx.server?.version === version, detail: `version = ${ctx.server?.version}` }));

export function runChecks(checks: Check[], ctx: CheckContext): CheckResult[] {
  return checks.map((c) => {
    try {
      return { name: c.name, ...c.run(ctx) };
    } catch (error) {
      return { name: c.name, pass: false, detail: `check threw: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
}
