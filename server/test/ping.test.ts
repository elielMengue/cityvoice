import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { createFetchHandler, MCP_PATH } from "../src/httpServer";
import { SILENT_LOGGER } from "../src/logger";

// Alexa+ speaks this revision of the spec, so it is the one that must work.
const ALEXA_PROTOCOL_VERSION = "2025-11-25";

// The Alexa+ QuickStart asks for a round trip under 500 ms. Locally we should
// be far below that, so a slow test here points at real work in the hot path.
const LOCAL_LATENCY_BUDGET_MS = 100;

const PING_SPEECH = "CityVoice is up and ready to take your report.";

interface JsonRpcResponse {
    readonly jsonrpc: "2.0";
    readonly id: number;
    readonly result?: Record<string, unknown>;
    readonly error?: { readonly code: number; readonly message: string };
}

/**
 * A 2025-era call may be answered as plain JSON or as an SSE stream. Both are
 * valid, so the test reads either and returns the one JSON-RPC message.
 */
async function readJsonRpcResult(response: Response): Promise<JsonRpcResponse> {
    const body = await response.text();
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
        return JSON.parse(body) as JsonRpcResponse;
    }
    const dataLine = body.split("\n").find((line) => line.startsWith("data: {"));
    if (dataLine === undefined) {
        throw new Error(`No JSON-RPC message in stream: ${body}`);
    }
    return JSON.parse(dataLine.slice("data: ".length)) as JsonRpcResponse;
}

describe("MCP as Alexa+ calls it (2025-11-25, stateless)", () => {
    const handle = createFetchHandler({ logger: SILENT_LOGGER });

    async function call(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
        const response = await handle(
            new Request(`http://localhost${MCP_PATH}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    "mcp-protocol-version": ALEXA_PROTOCOL_VERSION,
                },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            }),
        );
        expect(response.status).toBe(200);
        return readJsonRpcResult(response);
    }

    test("initialize agrees on the Alexa+ protocol version", async () => {
        const { result } = await call("initialize", {
            protocolVersion: ALEXA_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "alexa-plus-test", version: "0.0.0" },
        });

        expect(result?.["protocolVersion"]).toBe(ALEXA_PROTOCOL_VERSION);
    });

    test("lists the ping tool with a valid input schema", async () => {
        const { result } = await call("tools/list");
        const tools = result?.["tools"] as { name: string; inputSchema: { type: string } }[];

        expect(tools.find((tool) => tool.name === "ping")?.inputSchema.type).toBe("object");
    });

    test("ping answers with speech and structured data, without a session", async () => {
        const { result } = await call("tools/call", { name: "ping", arguments: {} });

        expect(result?.["isError"]).toBeFalsy();
        expect(result?.["content"]).toEqual([{ type: "text", text: PING_SPEECH }]);
        expect(result?.["structuredContent"]).toMatchObject({ speech: PING_SPEECH, data: { status: "ok" } });
    });

    test("ping stays inside the local latency budget", async () => {
        await call("tools/call", { name: "ping", arguments: {} });
        const startedAt = performance.now();
        await call("tools/call", { name: "ping", arguments: {} });

        expect(performance.now() - startedAt).toBeLessThan(LOCAL_LATENCY_BUDGET_MS);
    });
});

describe("MCP with the current SDK client", () => {
    let server: ReturnType<typeof Bun.serve>;
    let client: Client;

    beforeAll(async () => {
        server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: createFetchHandler({ logger: SILENT_LOGGER }) });
        client = new Client({ name: "test-client", version: "0.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(MCP_PATH, server.url)));
    });

    afterAll(async () => {
        await client.close();
        await server.stop(true);
    });

    test("ping works over the newest protocol revision too", async () => {
        const result = await client.callTool({ name: "ping", arguments: {} });

        expect(result.content).toEqual([{ type: "text", text: PING_SPEECH }]);
    });
});

describe("HTTP routes", () => {
    const handle = createFetchHandler({ logger: SILENT_LOGGER });

    test("health check answers ok", async () => {
        const response = await handle(new Request("http://localhost/health"));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "ok" });
    });

    test("unknown paths return 404", async () => {
        const response = await handle(new Request("http://localhost/nope"));

        expect(response.status).toBe(404);
    });
});
