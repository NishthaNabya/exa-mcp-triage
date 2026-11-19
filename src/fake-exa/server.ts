// A local stand-in for Exa's API. Each route answers with a Behavior the scenario
// chooses: a normal body, a tagged Exa error, a Cloudflare page, a hang, and so on.
// It records every request so checks can read what the MCP server actually sent.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { redactHeaders } from "../redact.js";
import type { ApiRequestRecord } from "../types.js";
import { exaError } from "./bodies.js";

export type Behavior =
  | { kind: "ok"; body: unknown }
  | { kind: "exa-error"; status: number; tag: string; error: string; requestId: string }
  | { kind: "edge-html"; status: number; html: string; cfRay: string }
  | { kind: "non-json"; status: number; body: string; contentType: string }
  | { kind: "hang" } // never answers
  | { kind: "drop" } // closes the connection without a response
  | { kind: "sequence"; steps: Behavior[] }; // nth request gets steps[n]; the last step repeats

export type Routes = Partial<Record<"/search" | "/contents", Behavior>>;

export interface FakeExa {
  url: string;
  requests: ApiRequestRecord[];
  close(): Promise<void>;
}

export async function startFakeExa(routes: Routes): Promise<FakeExa> {
  const requests: ApiRequestRecord[] = [];
  const hits = new Map<string, number>();
  const sockets = new Set<Socket>();

  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const body = await readJson(req);
    const n = hits.get(path) ?? 0;
    hits.set(path, n + 1);

    const route = routes[path as keyof Routes];
    const behavior = route ? pick(route, n) : notFound;
    // Edge and proxy answers never reach Exa's app, so Exa's own log would not show them.
    const reachedExaApp = behavior.kind !== "edge-html" && behavior.kind !== "non-json";
    const status = behavior.kind === "ok" ? 200 : "status" in behavior ? behavior.status : undefined;
    requests.push({
      method: req.method ?? "GET",
      path,
      headers: redactHeaders(req.headers as Record<string, string>),
      body,
      reachedExaApp,
      ...(status !== undefined && { status }),
    });
    respond(res, behavior);
  });

  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy(); // releases hung requests
        server.close(() => resolve());
      }),
  };
}

const notFound: Behavior = { kind: "exa-error", status: 404, tag: "NOT_FOUND", error: "Route not in this scenario", requestId: "req_404" };

function pick(behavior: Behavior, n: number): Behavior {
  if (behavior.kind !== "sequence") return behavior;
  const step = behavior.steps[Math.min(n, behavior.steps.length - 1)];
  if (!step) throw new Error("sequence behavior needs at least one step");
  return step;
}

function respond(res: ServerResponse, b: Behavior): void {
  switch (b.kind) {
    case "ok":
      return sendJson(res, 200, b.body);
    case "exa-error":
      return sendJson(res, b.status, exaError(b.error, b.tag, b.requestId));
    case "edge-html":
      res.writeHead(b.status, { "content-type": "text/html; charset=UTF-8", server: "cloudflare", "cf-ray": b.cfRay });
      return void res.end(b.html);
    case "non-json":
      res.writeHead(b.status, { "content-type": b.contentType });
      return void res.end(b.body);
    case "hang":
      return; // the socket stays open until close()
    case "drop":
      return void res.socket?.destroy();
    case "sequence":
      throw new Error("sequence is resolved by pick()");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
