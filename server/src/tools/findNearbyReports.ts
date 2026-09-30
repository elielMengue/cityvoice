import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { findServiceType } from "../catalog/serviceCatalog";
import { decodeLocationId } from "../geo/locationId";
import { DEFAULT_RADIUS_METERS, findNearbyReports, nearbySpeech } from "../reports/nearby";
import { nearbyReportSchema } from "./schemas";
import type { Caller, ToolDeps } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const FIND_NEARBY_REPORTS_TOOL = "find_nearby_reports";

const MAX_RADIUS_METERS = 500;

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({ reports: z.array(nearbyReportSchema) }),
});

export function registerFindNearbyReportsTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        FIND_NEARBY_REPORTS_TOOL,
        {
            title: "Find nearby reports",
            description:
                "Checks whether neighbors already reported the same problem close to the place, so the user can " +
                "support an existing report instead of filing a duplicate. start_report already does this; use this " +
                "tool after the place or the service changed. Returns up to five open reports, closest first.",
            inputSchema: z.object({
                location_id: z.string().describe("The location_id returned by start_report or resolve_location."),
                service_code: z
                    .string()
                    .describe("The service_code of the problem, for example POTHOLE or STREETLIGHT."),
                radius_m: z
                    .number()
                    .int()
                    .min(10)
                    .max(MAX_RADIUS_METERS)
                    .nullish()
                    .describe(`Search radius in meters. Defaults to ${DEFAULT_RADIUS_METERS}, about half a block.`),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        async ({ location_id: locationId, service_code: serviceCode, radius_m: radius }) => {
            const location = decodeLocationId(locationId);
            if (location === undefined) {
                return toolFailure("I lost track of the place. Could you tell me where the problem is again?");
            }
            const service = findServiceType(serviceCode);
            if (service === undefined) {
                return toolFailure("I'm not sure which kind of problem this is. Could you describe it again?");
            }
            const reports = await findNearbyReports(deps, caller, location, service, radius ?? undefined);
            return toolSuccess({ speech: nearbySpeech(reports, service, location), data: { reports } });
        },
    );
}
