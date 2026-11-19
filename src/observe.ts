// Turns one MCP tool call into an Observation: what the agent actually received.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { redactDeep, redactText } from "./redact.js";
import type { Observation } from "./types.js";

export async function callTool(client: Client, name: string, args: unknown, timeoutMs: number): Promise<Observation> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  try {
    const result = await client.callTool({ name, arguments: args as Record<string, unknown> }, undefined, { timeout: timeoutMs });
    const blocks = Array.isArray(result.content) ? result.content : [];
    const text = blocks
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("\n");
    const isError = result.isError === true;
    return {
      outcome: isError ? "tool-error" : "success",
      isError,
      text: redactText(text),
      ...(result._meta && { meta: redactDeep(result._meta as Record<string, unknown>) }),
      ...(result.structuredContent !== undefined && { structured: redactDeep(result.structuredContent) }),
      durationMs: ms(),
    };
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : String(error));
    if (error instanceof McpError) {
      // The SDK reports a dropped connection as an McpError (-32000), but it is a transport
      // failure, not an MCP protocol error, so classify it with the other transport errors.
      const outcome =
        error.code === ErrorCode.RequestTimeout ? "timeout" : error.code === ErrorCode.ConnectionClosed ? "transport-error" : "mcp-error";
      return {
        outcome,
        isError: true,
        text: message,
        errorCode: error.code,
        durationMs: ms(),
      };
    }
    return { outcome: "transport-error", isError: true, text: message, durationMs: ms() };
  }
}
