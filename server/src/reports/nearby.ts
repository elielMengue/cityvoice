import type { ServiceType } from "../catalog/serviceCatalog";
import { distanceMeters } from "../geo/geo";
import type { ResolvedLocation } from "../geo/locationId";
import type { ReportRole } from "../residents/residentStore";
import { ageInWords, capitalized, countOf, withArticle } from "../speech/speech";
import type { Caller, ToolDeps } from "../tools/toolContext";

export const DEFAULT_RADIUS_METERS = 75;
const MAX_REPORTS = 5;

export interface NearbyReport {
    readonly request_id: string;
    readonly service_name: string;
    readonly address: string;
    readonly distance_m: number;
    readonly requested_datetime: string;
    readonly age: string;
    readonly supporters: number;
    readonly status_notes?: string;
    readonly my_role: ReportRole | "none";
}

/** Open reports of the same service within the radius, closest first. */
export async function findNearbyReports(
    deps: ToolDeps,
    caller: Caller,
    location: ResolvedLocation,
    service: ServiceType,
    radius = DEFAULT_RADIUS_METERS,
): Promise<NearbyReport[]> {
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

    return Promise.all(
        nearby.map(async ({ request, distance }) => {
            const link =
                caller.residentId === undefined
                    ? undefined
                    : await deps.residents.getReport(caller.residentId, request.service_request_id);
            return {
                request_id: request.service_request_id,
                service_name: request.service_name,
                address: request.address ?? location.address,
                distance_m: Math.round(distance),
                requested_datetime: request.requested_datetime,
                age: ageInWords(new Date(request.requested_datetime), now),
                supporters: request.supporters,
                ...(request.status_notes === undefined ? {} : { status_notes: request.status_notes }),
                my_role: link?.role ?? "none",
            };
        }),
    );
}

export function nearbySpeech(
    reports: readonly NearbyReport[],
    service: ServiceType,
    location: ResolvedLocation,
): string {
    const place = location.isHome ? "near your home" : "there";
    const [closest] = reports;
    if (closest === undefined) {
        return `I don't see any open ${service.name} reports ${place}.`;
    }
    if (closest.my_role === "author") {
        return `You already reported ${withArticle(service.name)} ${place}, ${closest.age}. It's still open.`;
    }
    if (closest.my_role === "supporter") {
        return (
            `You already support ${withArticle(service.name)} report ${place}. ` +
            `It has ${countOf(closest.supporters, "neighbor")} behind it and it's still open.`
        );
    }
    const intro =
        reports.length === 1
            ? `${capitalized(countOf(closest.supporters, "neighbor"))} already reported ` +
              `${withArticle(service.name)} ${place}, ${closest.age}.`
            : `There are ${countOf(reports.length, "open report")} ${place}. ` +
              `The closest was reported ${closest.age} by ${countOf(closest.supporters, "neighbor")}.`;
    return `${intro} Do you want to add your support so the city sees it matters, or file a separate report?`;
}
