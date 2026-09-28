import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { countOf } from "../speech/speech";
import type { Caller, ToolDeps } from "./toolContext";
import { resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

export const SUPPORT_REPORT_TOOL = "support_report";

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        request_id: z.string(),
        supporters: z.number(),
        already_supported: z.boolean(),
    }),
});

export function registerSupportReportTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        SUPPORT_REPORT_TOOL,
        {
            title: "Support report",
            description:
                "Adds the user's support to a report a neighbor already filed, so the city sees how many people it " +
                'affects. Use it when the user says "add my support", "me too" or "yes, same problem" after ' +
                "find_nearby_reports. Each person can support a report once; calling it twice changes nothing.",
            inputSchema: z.object({
                request_id: z.string().describe("The request_id of the report, as returned by find_nearby_reports."),
            }),
            outputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true, destructiveHint: false },
        },
        async ({ request_id: requestId }) => {
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }
            const { resident } = found;

            const [request] = await deps.open311.getRequests([requestId]);
            if (request === undefined) {
                return toolFailure("I couldn't find that report anymore. Would you like me to file a new one?");
            }
            if (request.status === "closed") {
                return toolFailure(
                    "The city has already closed that report. If the problem is back, I can file a new one.",
                );
            }

            const neighbors = (count: number) => countOf(count, "neighbor");
            const existing = await deps.residents.getReport(resident.id, requestId);
            if (existing !== undefined) {
                const yours = existing.role === "author" ? "You filed that report" : "You already support that report";
                return toolSuccess({
                    speech: `${yours}. It has ${neighbors(request.supporters)} behind it.`,
                    data: { request_id: requestId, supporters: request.supporters, already_supported: true },
                });
            }

            // Link the resident before counting. If the count then fails, a
            // retry finds the link and the total stays one short. We prefer
            // that to the other order, where a retry would count them twice.
            await deps.residents.addReport({
                residentId: resident.id,
                requestId,
                role: "supporter",
                createdAt: deps.now().toISOString(),
            });
            const supporters = await deps.open311.addSupporter(requestId);
            return toolSuccess({
                speech: `Done. That's ${neighbors(supporters)} now. Ask me anytime for an update.`,
                data: { request_id: requestId, supporters, already_supported: false },
            });
        },
    );
}
