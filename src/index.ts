// The server on stdio, as MCP clients (Claude Code, Claude Desktop…) start it.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { nodeHttp } from "./http";
import { createServer } from "./server";

await createServer(nodeHttp()).connect(new StdioServerTransport());
console.error("CrossRef MCP server running on stdio");
