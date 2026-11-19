import { afterEach, describe, expect, it } from "vitest";
import { cloudflare403, searchOk } from "../src/fake-exa/bodies.js";
import { startFakeExa, type FakeExa } from "../src/fake-exa/server.js";

let fake: FakeExa | undefined;
afterEach(async () => fake?.close());

const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
  fetch(`${fake!.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("fake Exa API", () => {
  it("answers with Exa's error body shape", async () => {
    fake = await startFakeExa({ "/search": { kind: "exa-error", status: 429, tag: "RATE_LIMIT_EXCEEDED", error: "Rate limit exceeded", requestId: "r1" } });
    const res = await post("/search");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ requestId: "r1", error: "Rate limit exceeded", tag: "RATE_LIMIT_EXCEEDED" });
  });

  it("serves a Cloudflare page that never reaches the app log", async () => {
    fake = await startFakeExa({ "/search": { kind: "edge-html", status: 403, html: cloudflare403, cfRay: "abc-EWR" } });
    const res = await post("/search");
    expect(res.headers.get("cf-ray")).toBe("abc-EWR");
    expect(await res.text()).toContain("Cloudflare");
    expect(fake.requests[0]?.reachedExaApp).toBe(false);
  });

  it("plays a sequence, repeating the last step", async () => {
    fake = await startFakeExa({
      "/search": { kind: "sequence", steps: [{ kind: "exa-error", status: 503, tag: "T", error: "e", requestId: "r" }, { kind: "ok", body: searchOk() }] },
    });
    expect((await post("/search")).status).toBe(503);
    expect((await post("/search")).status).toBe(200);
    expect((await post("/search")).status).toBe(200);
  });

  it("records request bodies and redacts the API key header", async () => {
    fake = await startFakeExa({ "/search": { kind: "ok", body: searchOk() } });
    await post("/search", { query: "q" }, { "x-api-key": "secret-value-123" });
    expect(fake.requests[0]?.body).toEqual({ query: "q" });
    expect(fake.requests[0]?.headers["x-api-key"]).toBe("[redacted]");
  });

  it("releases hung requests on close", async () => {
    fake = await startFakeExa({ "/search": { kind: "hang" } });
    const pending = post("/search").catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 50));
    await fake.close();
    fake = undefined;
    expect(await pending).toBeInstanceOf(Error);
  });
});
