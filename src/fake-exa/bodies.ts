// Response bodies in the shape of Exa's API, modeled on the fixtures in
// exa-mcp-server/tests/fixtures/exaResponses.ts and Exa's error-codes page.

export function searchOk(opts: { requestId?: string; warnings?: unknown[]; notices?: unknown[]; results?: number } = {}) {
  const count = opts.results ?? 2;
  return {
    requestId: opts.requestId ?? "req_search_ok",
    resolvedSearchType: "auto",
    results: Array.from({ length: count }, (_, i) => ({
      id: `https://example.com/page-${i + 1}`,
      title: `Example page ${i + 1}`,
      url: `https://example.com/page-${i + 1}`,
      publishedDate: "2026-10-01T12:00:00.000Z",
      author: "Example Author",
      highlights: [`Highlight from page ${i + 1}`],
    })),
    ...(opts.warnings && { warnings: opts.warnings }),
    ...(opts.notices && { notices: opts.notices }),
    searchTime: 0.42,
    costDollars: { total: 0.007 },
  };
}

type UrlOutcome = { url: string; ok: true } | { url: string; ok: false; tag: string; httpStatusCode?: number };

export function contents(outcomes: UrlOutcome[], requestId = "req_contents") {
  return {
    requestId,
    results: outcomes
      .filter((o) => o.ok)
      .map((o) => ({ id: o.url, url: o.url, title: `Title of ${o.url}`, text: `Text of ${o.url}` })),
    statuses: outcomes.map((o) =>
      o.ok
        ? { id: o.url, status: "success" }
        : { id: o.url, status: "error", error: { tag: o.tag, httpStatusCode: o.httpStatusCode ?? null } },
    ),
    costDollars: { total: 0.001 * outcomes.length },
  };
}

/** Exa's documented error body: `requestId`, `error`, `tag`. */
export function exaError(error: string, tag: string, requestId: string) {
  return { requestId, error, tag };
}

// Cloudflare-style pages, trimmed to the parts that identify them.
export const cloudflare403 = `<!DOCTYPE html>
<html><head><title>Attention Required! | Cloudflare</title></head>
<body><h1>Sorry, you have been blocked</h1>
<p>You are unable to access api.exa.ai</p>
<p>Cloudflare Ray ID: <strong>8f1a2b3c4d5e6f70</strong></p></body></html>`;

export const cloudflare520 = `<!DOCTYPE html>
<html><head><title>api.exa.ai | 520: Web server is returning an unknown error</title></head>
<body><h1>Web server is returning an unknown error</h1>
<p>Error code 520</p><p>Cloudflare Ray ID: 8f1a2b3c4d5e6f71</p></body></html>`;
