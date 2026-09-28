import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toolSuccess } from "./toolResult";

export const PING_TOOL_NAME = "ping";

/**
 * A health probe that goes through the full MCP path, not just HTTP. It lets
 * us measure the round trip Alexa+ would see before any real tool exists.
 */
export function registerPingTool(server: McpServer, now: () => Date = () => new Date()): void {
    server.registerTool(
        PING_TOOL_NAME,
        {
            title: "Ping",
            description:
                "Checks that the CityVoice service is up. Use only when the user asks whether CityVoice is working.",
            inputSchema: z.object({}),
            outputSchema: z.object({
                speech: z.string(),
                data: z.object({ status: z.literal("ok"), serverTime: z.string() }),
            }),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        () =>
            toolSuccess({
                speech: "CityVoice is up and ready to take your report.",
                data: { status: "ok", serverTime: now().toISOString() },
            }),
    );
}
