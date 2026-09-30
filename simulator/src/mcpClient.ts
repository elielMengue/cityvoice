import type { FetchLike } from "./boundFetch";
import { boundFetch } from "./boundFetch";

import type { ToolDeclaration, ToolResult, ToolServer } from "./orchestrator";

/** The revision Alexa+ speaks. The simulator uses it so the server sees exactly Alexa's traffic. */
export const ALEXA_PROTOCOL_VERSION = "2025-11-25";

const REQUEST_TIMEOUT_MS = 5_000;

export class UnauthorizedError extends Error {}

interface JsonRpcResponse {
    readonly result?: Record<string, unknown>;
    readonly error?: { readonly code: number; readonly message: string };
}

/** Reads one JSON-RPC message from a plain JSON body or a short SSE stream. */
async function readMessage(response: Response): Promise<JsonRpcResponse> {
    const body = await response.text();
    if (!(response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
        return JSON.parse(body) as JsonRpcResponse;
    }
    const line = body.split("\n").find((candidate) => candidate.startsWith("data: {"));
    if (line === undefined) {
        throw new Error("The MCP server sent an empty stream.");
    }
    return JSON.parse(line.slice("data: ".length)) as JsonRpcResponse;
}

/** JSON Schema keys Gemini does not accept in function declarations. */
function forGemini(schema: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema"));
}

/**
 * A minimal MCP client over Streamable HTTP, stateless, the way Alexa+ calls
 * an add-on: every call is one POST with the access token.
 */
export class McpHttpClient implements ToolServer {
    constructor(
        private readonly endpoint: string,
        private readonly accessToken: string,
        private readonly fetchImpl: FetchLike = boundFetch,
    ) {}

    private async rpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        const response = await this.fetchImpl(this.endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-protocol-version": ALEXA_PROTOCOL_VERSION,
                authorization: `Bearer ${this.accessToken}`,
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status === 401) {
            throw new UnauthorizedError("The access token was refused.");
        }
        const message = await readMessage(response);
        if (message.error !== undefined || message.result === undefined) {
            throw new Error(`MCP ${method} failed: ${message.error?.message ?? "no result"}`);
        }
        return message.result;
    }

    async listTools(): Promise<{ readonly tools: readonly ToolDeclaration[]; readonly instructions: string }> {
        const initialized = await this.rpc("initialize", {
            protocolVersion: ALEXA_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "cityvoice-alexa-simulator", version: "0.1.0" },
        });
        const listed = await this.rpc("tools/list", {});
        const tools = (
            listed["tools"] as { name: string; description?: string; inputSchema: Record<string, unknown> }[]
        )
            // ping is for health checks, not for residents.
            .filter((tool) => tool.name !== "ping")
            .map((tool) => ({
                name: tool.name,
                description: tool.description ?? "",
                parametersJsonSchema: forGemini(tool.inputSchema),
            }));
        return { tools, instructions: String(initialized["instructions"] ?? "") };
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        const result = await this.rpc("tools/call", { name, arguments: args });
        const content = (result["content"] as { type: string; text?: string }[] | undefined) ?? [];
        const structured = result["structuredContent"] as { data?: Record<string, unknown> } | undefined;
        const isError = result["isError"] === true;
        const text = content.find((item) => item.type === "text")?.text ?? "";
        return {
            isError,
            speech: text,
            // The SDK reports bad arguments this way. The model can fix its call; the resident must not hear it.
            ...(isError && text.startsWith("Input validation error") ? { forModel: true } : {}),
            ...(structured?.data === undefined ? {} : { data: structured.data }),
        };
    }
}
