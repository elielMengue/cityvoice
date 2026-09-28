import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { findServiceType } from "../catalog/serviceCatalog";
import { distanceMeters } from "../geo/geo";
import { decodeLocationId } from "../geo/locationId";
import { ageInWords, capitalized, countOf, withArticle } from "../speech/speech";
import type { Caller, ToolDeps } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

export const FIND_NEARBY_REPORTS_TOOL = "find_nearby_reports";

export const DEFAULT_RADIUS_METERS = 75;
const MAX_RADIUS_METERS = 500;
const MAX_REPORTS = 5;

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        reports: z.array(
            z.object({
                request_id: z.string(),
                service_name: z.string(),
                address: z.string(),
                distance_m: z.number(),
                requested_datetime: z.string(),
                age: z.string(),
                supporters: z.number(),
                status_notes: z.string().optional(),
                is_mine: z.boolean(),
            }),
        ),
    }),
});

export function registerFindNearbyReportsTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        FIND_NEARBY_REPORTS_TOOL,
        {
            title: "Find nearby reports",
            description:
                "Checks whether neighbors already reported the same problem close to the place. " +
                "Always call it after choosing the service and before draft_report, so the user can support " +
                "an existing report instead of filing a duplicate. Returns up to five open reports, closest first.",
            inputSchema: z.object({
                location_id: z.string().describe("The location_id returned by resolve_location."),
                service_code: z
                    .string()
                    .describe("The service_code chosen from list_service_types, for example POTHOLE or STREETLIGHT."),
                radius_m: z
                    .number()
                    .int()
                    .min(10)
                    .max(MAX_RADIUS_METERS)
                    .optional()
                    .describe(`Search radius in meters. Defaults to ${DEFAULT_RADIUS_METERS}, about half a block.`),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        async ({ location_id: locationId, service_code: serviceCode, radius_m: radius = DEFAULT_RADIUS_METERS }) => {
            const location = decodeLocationId(locationId);
            if (location === undefined) {
                return toolFailure("I lost track of the place. Could you tell me where the problem is again?");
            }
            const service = findServiceType(serviceCode);
            if (service === undefined) {
                return toolFailure("I'm not sure which kind of problem this is. Could you describe it again?");
            }

            const now = deps.now();
            const open = await deps.open311.findRequests({ service_code: service.code, status: "open" });
            const nearby = open
                .map((request) => ({
                    request,
                    distance: distanceMeters(location.point, { lat: request.lat, lng: request.long }),
                }))
                .filter(({ distance }) => distance <= radius)
                .sort((a, b) => a.distance - b.distance)
                .slice(0, MAX_REPORTS);

            const reports = await Promise.all(
                nearby.map(async ({ request, distance }) => {
                    const mine =
                        caller.residentId !== undefined &&
                        (await deps.residents.getReport(caller.residentId, request.service_request_id)) !== undefined;
                    return {
                        request_id: request.service_request_id,
                        service_name: request.service_name,
                        address: request.address ?? location.address,
                        distance_m: Math.round(distance),
                        requested_datetime: request.requested_datetime,
                        age: ageInWords(new Date(request.requested_datetime), now),
                        supporters: request.supporters,
                        ...(request.status_notes === undefined ? {} : { status_notes: request.status_notes }),
                        is_mine: mine,
                    };
                }),
            );

            const place = location.isHome ? "near your home" : "there";
            const [closest] = reports;
            if (closest === undefined) {
                return toolSuccess({
                    speech: `I don't see any open ${service.name} reports ${place}.`,
                    data: { reports },
                });
            }
            if (closest.is_mine) {
                return toolSuccess({
                    speech: `You already reported ${withArticle(service.name)} ${place}, ${closest.age}. It's still open.`,
                    data: { reports },
                });
            }

            const who = capitalized(countOf(closest.supporters, "neighbor"));
            const intro =
                reports.length === 1
                    ? `${who} already reported ${withArticle(service.name)} ${place}, ${closest.age}.`
                    : `There are ${countOf(reports.length, "open report")} ${place}. ` +
                      `The closest was reported ${closest.age} by ${countOf(closest.supporters, "neighbor")}.`;
            return toolSuccess({
                speech: `${intro} Do you want to add your support so the city sees it matters, or file a separate report?`,
                data: { reports },
            });
        },
    );
}
