import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { detectEmergency } from "../catalog/emergency";
import type { ServiceType } from "../catalog/serviceCatalog";
import { hasClearWinner, rankServiceTypes } from "../catalog/serviceCatalog";
import { isInside } from "../geo/geo";
import { decodeLocationId } from "../geo/locationId";
import { joinWithAnd, withArticle } from "../speech/speech";
import type { ToolDeps } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

export const LIST_SERVICE_TYPES_TOOL = "list_service_types";

export const questionSchema = z.object({
    code: z.string(),
    question: z.string(),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
});

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        services: z.array(
            z.object({
                service_code: z.string(),
                name: z.string(),
                typical_business_days: z.number(),
                questions: z.array(questionSchema),
            }),
        ),
        clear_match: z.boolean(),
    }),
});

export function describeQuestions(service: ServiceType): z.infer<typeof questionSchema>[] {
    return service.attributes.map((attribute) => ({
        code: attribute.code,
        question: attribute.question,
        required: attribute.required,
        ...(attribute.options === undefined ? {} : { options: attribute.options.map((option) => option.key) }),
    }));
}

export function registerListServiceTypesTool(server: McpServer, deps: ToolDeps): void {
    server.registerTool(
        LIST_SERVICE_TYPES_TOOL,
        {
            title: "List service types",
            description:
                "Finds which city service fits the problem the user describes, for example pothole, streetlight out, " +
                "missed trash pickup, graffiti, illegal dumping, sidewalk damage, abandoned vehicle or tree hazard. " +
                "Call it first, with the user's own words, before resolve_location: it also screens for emergencies. " +
                "Returns up to five services, best first, " +
                "with the questions the city needs answered. If the description sounds like an emergency " +
                "(fire, smoke, gas smell, someone hurt, a downed power line), it returns an error telling the user " +
                "to call 911: read that to the user and do not file anything.",
            inputSchema: z.object({
                problem_description: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe(
                        "The problem in the user's words, for example \"there's a huge pothole\", " +
                            '"the street lamp is out", "they didn\'t pick up the garbage".',
                    ),
                location_id: z
                    .string()
                    .optional()
                    .describe("The location_id from resolve_location, if the place is already known."),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        async ({ problem_description: description, location_id: locationId }) => {
            const emergency = detectEmergency(description);
            if (emergency !== undefined) {
                return toolFailure(emergency);
            }

            if (locationId !== undefined) {
                const location = decodeLocationId(locationId);
                if (location === undefined) {
                    return toolFailure("I lost track of the place. Could you tell me where the problem is again?");
                }
                if (!isInside(location.point, deps.serviceArea)) {
                    return toolFailure("CityVoice doesn't cover that area yet, so I can't file a report there.");
                }
            }

            const ranked = rankServiceTypes(description);
            const services = ranked.map(({ service }) => ({
                service_code: service.code,
                name: service.name,
                typical_business_days: service.typicalBusinessDays,
                questions: describeQuestions(service),
            }));

            const first = ranked[0]?.service;
            if (first === undefined) {
                return toolSuccess({
                    speech:
                        "I couldn't match that to a city service. Could you describe what you see, " +
                        "like a pothole, a broken streetlight, or graffiti?",
                    data: { services, clear_match: false },
                });
            }
            const clearMatch = hasClearWinner(ranked);
            const speech = clearMatch
                ? `That sounds like ${withArticle(first.name)} report.`
                : `That could be ${joinWithAnd(
                      ranked.slice(0, 3).map(({ service }) => `${withArticle(service.name)} report`),
                      "or",
                  )}. Which fits best?`;
            return toolSuccess({ speech, data: { services, clear_match: clearMatch } });
        },
    );
}
