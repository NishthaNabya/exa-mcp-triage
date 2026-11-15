// The compatibility matrix: every client and configuration the lab knows about,
// with how it was covered. A row is never marked tested unless something ran.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ManualResult } from "./lab.js";
import type { ScenarioResult } from "./run.js";
import type { SchemaFinding } from "./schemas.js";

export interface MatrixRow {
  client: string;
  version: string;
  transport: string;
  auth: string;
  server: string;
  coverage: "automated" | "static" | "manual" | "not run";
  result: string;
}

// Read the SDK's own package.json by path: its export map sends "package.json" to a nested file with no version.
const sdkVersion = (() => {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@modelcontextprotocol", "sdk", "package.json");
    return (JSON.parse(readFileSync(path, "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

const MANUAL_CLIENTS = [
  { client: "Claude Desktop", transport: "remote (Streamable HTTP) or stdio" },
  { client: "Cursor", transport: "stdio or remote" },
  { client: "ChatGPT developer mode", transport: "remote (Streamable HTTP)" },
];

function summarize(results: ScenarioResult[]): string {
  if (!results.length) return "not run in this report";
  const count = (v: ScenarioResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  const surprises = count("regressed") + count("unexpected") + count("error");
  return [
    `${results.length} scenarios`,
    `${count("pass") + count("as-expected")} pass or as expected`,
    count("reproduced") ? `${count("reproduced")} defects reproduced` : "",
    count("not-reproduced") ? `${count("not-reproduced")} not reproduced` : "",
    surprises ? `${surprises} regressed or errors` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function buildMatrix(results: ScenarioResult[], schemas: SchemaFinding[], manual: ManualResult[]): MatrixRow[] {
  const local = results.filter((r) => r.target === "local");
  const hosted = results.filter((r) => r.target === "hosted");
  const hostedVersion = hosted.find((r) => r.server?.version)?.server?.version ?? "production";
  const lab = `Lab client (MCP TypeScript SDK)`;

  const rows: MatrixRow[] = [
    { client: lab, version: sdkVersion, transport: "stdio", auth: "fake key, fake Exa API", server: "pinned 3.4.3 (93c0d5e)", coverage: local.length ? "automated" : "not run", result: summarize(local) },
    { client: lab, version: sdkVersion, transport: "Streamable HTTP", auth: "keyless, plus ?login probe", server: `mcp.exa.ai ${hostedVersion}`, coverage: hosted.length ? "automated" : "not run", result: hosted.length ? summarize(hosted) : "run with --live" },
  ];

  for (const source of ["local", "hosted"] as const) {
    const s = schemas.filter((x) => x.source === source);
    if (!s.length) continue;
    const server = source === "local" ? "pinned 3.4.3" : `mcp.exa.ai ${hostedVersion}`;
    const ajvFails = s.filter((x) => x.ajvStrict.length).map((x) => x.tool);
    const strictFails = s.filter((x) => x.openAiStrict.length).map((x) => x.tool);
    rows.push({
      client: "Strict JSON Schema validators (Ajv strict)",
      version: "Ajv 8",
      transport: "schema only",
      auth: "n/a",
      server,
      coverage: "static",
      result: ajvFails.length ? `fails: ${ajvFails.join(", ")}` : `all ${s.length} tool schemas compile`,
    });
    rows.push({
      client: "OpenAI strict-mode function calling",
      version: "rules as documented, 2026-11",
      transport: "schema only",
      auth: "n/a",
      server,
      coverage: "static",
      result: strictFails.length ? `needs conversion: ${strictFails.join(", ")} (optional fields)` : "all tools meet the rules as-is",
    });
  }

  for (const m of MANUAL_CLIENTS) {
    const done = manual.filter((r) => r.client === m.client);
    rows.push({
      client: m.client,
      version: done.map((r) => r.clientVersion).filter(Boolean).join(", ") || "-",
      transport: m.transport,
      auth: "-",
      server: "-",
      coverage: done.length ? "manual" : "not run",
      result: done.length ? `${done.filter((r) => r.result === "pass").length}/${done.length} checks pass` : "no result recorded; steps in manual/README.md",
    });
  }
  return rows;
}
