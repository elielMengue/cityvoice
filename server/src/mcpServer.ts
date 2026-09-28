import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import type { Logger } from "./logger";
import { registerPingTool } from "./tools/ping";

export const SERVER_NAME = "cityvoice";
export const SERVER_VERSION = "0.1.0";

/** Anything bigger than this is not a voice request. */
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

export type McpFetch = (request: Request) => Promise<Response>;

/** Builds a fresh MCP server with every tool registered. */
export function createMcpServer(): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerPingTool(server);
    return server;
}

/**
 * Serves MCP over Streamable HTTP. The SDK builds one server per request, so
 * nothing survives between calls and any task behind the load balancer can
 * answer any request. Alexa+ speaks the 2025-11-25 revision, which the SDK
 * serves through its stateless legacy path, answering each call as a short
 * SSE stream that carries the single result.
 */
export function createMcpFetch(logger: Logger): McpFetch {
    const handler = createMcpHandler(createMcpServer, {
        legacy: "stateless",
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
        onerror: (error) => logger.warn("mcp request rejected", { error: error.message }),
    });
    return (request) => handler.fetch(request);
}
