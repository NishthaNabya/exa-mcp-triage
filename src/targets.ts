// The two MCP servers the lab talks to:
// - local: Exa's real server, pinned and built by scripts/setup-server.mjs, run over stdio
//   with EXA_API_BASE_URL pointed at the fake Exa API.
// - hosted: Exa's production server at mcp.exa.ai, on the free keyless tier.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SERVER_BUNDLE = join(root, "vendor", "exa-mcp-server", "dist", "stdio.cjs");
export const HOSTED_URL = "https://mcp.exa.ai/mcp";

/** Not a real key. The local server only ever talks to the fake API. */
export const FAKE_KEY = "lab-fake-key-not-a-secret";

export interface Target {
  client: Client;
  server: { name?: string; version?: string };
  serverLog: string[];
  close(): Promise<void>;
}

const clientInfo = { name: "exa-mcp-fault-lab", version: "0.1.0" };

/** How to start the server. Scenarios override this to simulate a broken setup. */
export interface Spawn {
  command: string;
  args: string[];
}

export async function startLocal(opts: { apiBaseUrl: string; env?: Record<string, string>; spawn?: Spawn }): Promise<Target> {
  if (!opts.spawn && !existsSync(SERVER_BUNDLE)) {
    throw new Error(`Exa MCP server is not built. Run: npm run setup`);
  }
  const { command, args } = opts.spawn ?? { command: process.execPath, args: [SERVER_BUNDLE] };
  const transport = new StdioClientTransport({
    command,
    args,
    // Start from the SDK's safe default env, so the user's real EXA_API_KEY is never passed in.
    env: { ...getDefaultEnvironment(), EXA_API_KEY: FAKE_KEY, EXA_API_BASE_URL: opts.apiBaseUrl, ...opts.env },
    stderr: "pipe",
  });
  const serverLog: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => serverLog.push(...chunk.toString("utf8").split(/\r?\n/).filter(Boolean)));

  const client = new Client(clientInfo);
  await client.connect(transport);
  return { client, server: client.getServerVersion() ?? {}, serverLog, close: () => client.close() };
}

export async function startHosted(url = HOSTED_URL): Promise<Target> {
  const client = new Client(clientInfo);
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return { client, server: client.getServerVersion() ?? {}, serverLog: [], close: () => client.close() };
}
