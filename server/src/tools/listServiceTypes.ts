import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { detectEmergency } from "../catalog/emergency";
import { hasClearWinner, rankServiceTypes } from "../catalog/serviceCatalog";
import { isInside } from "../geo/geo";
import { decodeLocationId } from "../geo/locationId";
import { serviceMatchSpeech } from "../reports/services";
import { describeService, serviceSchema } from "./schemas";
import type { ToolDeps } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const LIST_SERVICE_TYPES_TOOL = "list_service_types";

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({ services: z.array(serviceSchema), clear_match: z.boolean() }),
});

export function registerListServiceTypesTool(server: McpServer, deps: ToolDeps): void {
    server.registerTool(
        LIST_SERVICE_TYPES_TOOL,
        {
            title: "List service types",
            description:
                "Finds which city service fits the problem the user describes, for example pothole, streetlight out, " +
                "missed trash pickup, graffiti, illegal dumping, sidewalk damage, abandoned vehicle or tree hazard. " +
                "start_report already does this; use this tool when the user changes what the problem is. " +
                "Returns up to five services, best first, with the questions the city needs answered. If the " +
                "description sounds like an emergency (fire, smoke, gas smell, someone hurt, a downed power line), " +
                "it returns an error telling the user to call 911: say only that and do not file anything.",
            inputSchema: z.object({
                problem_description: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe(
                        "The problem in the user's words, for example \"there's a huge pothole\", " +
                            '"the street lamp is out", "they didn\'t pick up the garbage".',
                    ),
                location_id: z.string().nullish().describe("The location_id, if the place is already known."),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        async ({ problem_description: description, location_id: locationId }) => {
            const emergency = detectEmergency(description);
            if (emergency !== undefined) {
                return toolFailure(emergency);
            }
            if (locationId !== undefined && locationId !== null) {
                const location = decodeLocationId(locationId);
                if (location === undefined) {
                    return toolFailure("I lost track of the place. Could you tell me where the problem is again?");
                }
                if (!isInside(location.point, deps.serviceArea)) {
                    return toolFailure("CityVoice doesn't cover that area yet, so I can't file a report there.");
                }
            }
            const ranked = rankServiceTypes(description);
            return toolSuccess({
                speech: serviceMatchSpeech(ranked),
                data: {
                    services: ranked.map(({ service }) => describeService(service)),
                    clear_match: hasClearWinner(ranked),
                },
            });
        },
    );
}
