// A stand-in MCP server that starts normally and exits when a tool is called.
// Used to test what the lab observes when a server dies mid-call.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "dies-on-call", version: "0.0.0" });
server.registerTool("web_search_exa", { description: "Exits the process instead of answering." }, async () => {
  process.exit(1);
});
await server.connect(new StdioServerTransport());
