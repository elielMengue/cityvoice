import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { MCP_PATH } from "../src/httpServer";
import { ALEXA_PROTOCOL_VERSION, createTestApp } from "./support/testApp";

// The Alexa+ QuickStart asks for a round trip under 500 ms. Locally we should
// be far below that, so a slow test here points at real work in the hot path.
const LOCAL_LATENCY_BUDGET_MS = 100;

const PING_SPEECH = "CityVoice is up and ready to take your report.";

const EXPECTED_TOOLS = [
    "draft_report",
    "find_nearby_reports",
    "get_my_reports",
    "list_service_types",
    "ping",
    "resolve_location",
    "start_report",
    "submit_report",
    "support_report",
];

describe("MCP as Alexa+ calls it (2025-11-25, stateless)", () => {
    const app = createTestApp();

    test("initialize agrees on the Alexa+ protocol version", async () => {
        const { result } = await app.rpc("initialize", {
            protocolVersion: ALEXA_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "alexa-plus-test", version: "0.0.0" },
        });

        expect(result?.["protocolVersion"]).toBe(ALEXA_PROTOCOL_VERSION);
    });

    test("every tool is listed with an object input schema", async () => {
        const { result } = await app.rpc("tools/list");
        const tools = result?.["tools"] as { name: string; description: string; inputSchema: { type: string } }[];

        expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
        for (const tool of tools) {
            expect(tool.inputSchema.type).toBe("object");
            expect(tool.description.length).toBeGreaterThan(20);
        }
    });

    test("ping answers with speech and structured data, without a session", async () => {
        const outcome = await app.callTool("ping", {});

        expect(outcome.isError).toBe(false);
        expect(outcome.speech).toBe(PING_SPEECH);
        expect(outcome.data).toMatchObject({ status: "ok" });
    });

    test("ping stays inside the local latency budget", async () => {
        await app.callTool("ping", {});
        const startedAt = performance.now();
        await app.callTool("ping", {});

        expect(performance.now() - startedAt).toBeLessThan(LOCAL_LATENCY_BUDGET_MS);
    });
});

describe("MCP with the current SDK client", () => {
    let server: ReturnType<typeof Bun.serve>;
    let client: Client;

    beforeAll(async () => {
        server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: createTestApp().handle });
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
    const { handle } = createTestApp();

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
