# Manual client checks

Some MCP clients cannot be driven by a script: Claude Desktop, Cursor, ChatGPT. For those, a person runs the check and records what happened. The report lists these results separately and marks them as manual. No client counts as tested until a result with evidence is recorded here.

## What these checks answer

The automated lab shows what Exa's MCP server sends. These checks show what a real client does with it: whether it shows the error to the user, hides it, retries or rewords it. That is the client-interpretation layer, and only a real client can show it.

## Setup for checks against a failure

1. Build the pinned server once: `npm run setup`.
2. Start the fake Exa API for one scenario, for example the dropped request ID:

   ```bash
   npm run lab -- --serve request-id-dropped
   ```

   It prints a server entry for your client's MCP config. The fake API uses a fake key, so nothing reaches Exa.
3. Add that entry to the client's MCP config and restart the client.
   - Claude Desktop: Settings > Developer > Edit Config (`claude_desktop_config.json`).
   - Cursor: Settings > MCP > Add new MCP server, or `.cursor/mcp.json`.
4. Ask the agent to use the tool the scenario names, for example: "Search the web for test query using exa-mcp-triage."
5. Take a screenshot of what the client shows. Save it under `manual/evidence/`.

## Checks

| Id | Scenario to serve | What to look for |
|---|---|---|
| M1 | none: connect to `https://mcp.exa.ai/mcp` | The client connects and lists web_search_exa and web_fetch_exa. |
| M2 | none: connect to `https://mcp.exa.ai/mcp?login` | The client starts an OAuth sign-in (the fix for #378). |
| M3 | `request-id-dropped` | What the user sees for a 429. Is the error shown, and does it include any ID? |
| M4 | `cloudflare-403` | Does the client show the Cloudflare page text, a summary, or nothing? |
| M5 | `partial-url-failure` (use web_fetch_exa) | Does the agent mention that one URL failed, given the result is not marked as an error? |
| M6 | `client-timeout-hides-cause` | How long the client waits before giving up, and what it shows. |

## Recording a result

Add an entry to `manual/results.json` (create it as a JSON array if it does not exist):

```json
[
  {
    "client": "Claude Desktop",
    "clientVersion": "1.2.3",
    "date": "2026-11-16",
    "check": "M3 request-id-dropped",
    "result": "pass",
    "evidence": "manual/evidence/m3-claude-desktop.png",
    "notes": "Shows 'web_search_exa error (429): Rate limit exceeded'. No ID."
  }
]
```

`result` is pass when the client behaved as the "What to look for" column describes, and fail otherwise. The next `npm run lab` puts these results in the report.
