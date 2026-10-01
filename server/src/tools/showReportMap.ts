import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { findServiceType } from "../catalog/serviceCatalog";
import type { GeoPoint } from "../geo/geo";
import { distanceMeters } from "../geo/geo";
import type { ResolvedLocation } from "../geo/locationId";
import { decodeLocationId } from "../geo/locationId";
import type { MapPin, MapStatus, ReportMap } from "../map/reportMap";
import { pinFor, placeFor, reportMapSchema } from "../map/reportMap";
import type { ServiceRequest } from "../open311/types";
import { candidatesSpeech, PLACE_NOT_FOUND_SPEECH, resolvePlace } from "../reports/place";
import type { Resident } from "../residents/residentStore";
import { capitalized, countOf, joinWithAnd, numberWord, withArticle } from "../speech/speech";
import { SHOWS_REPORT_MAP } from "../ui/reportMapResource";
import type { Caller, ToolDeps } from "./toolContext";
import { NOT_LINKED_SPEECH, resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const SHOW_REPORT_MAP_TOOL = "show_report_map";

/** A few blocks: what a resident thinks of as "around here". */
export const MAP_RADIUS_METERS = 300;
/** More pins than this stop being readable from across the room, and too long to say. */
export const MAX_PINS = 8;
/** "This week", "lately": the longest look back the map offers. */
const MAX_RECENT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({ map: reportMapSchema }),
});

const STATUS_WORDS: Record<MapStatus, string> = {
    open: "still waiting for the city",
    progress: "in progress",
    closed: "closed",
};

function serviceName(request: ServiceRequest): string {
    return findServiceType(request.service_code)?.name ?? request.service_name;
}

/** Reports within the radius, closest first. Open ones only, unless keep says otherwise. */
async function reportsAround(
    deps: ToolDeps,
    point: GeoPoint,
    keep: (request: ServiceRequest) => boolean = (request) => request.status === "open",
): Promise<ServiceRequest[]> {
    const all = await deps.open311.findRequests({});
    return all
        .filter(keep)
        .map((request) => ({ request, distance: distanceMeters(point, { lat: request.lat, lng: request.long }) }))
        .filter(({ distance }) => distance <= MAP_RADIUS_METERS)
        .sort((a, b) => a.distance - b.distance)
        .map(({ request }) => request);
}

/** "two pothole reports and a graffiti report". */
function describePins(pins: readonly MapPin[]): string {
    const counts = new Map<string, number>();
    for (const pin of pins) {
        counts.set(pin.service_name, (counts.get(pin.service_name) ?? 0) + 1);
    }
    return joinWithAnd(
        [...counts].map(([name, count]) =>
            count === 1 ? withArticle(`${name} report`) : countOf(count, `${name} report`),
        ),
    );
}

// The sentences stand on their own: on a device without a screen, they are
// the whole answer, so none of them mentions the map.

/** "was", "were". */
function was(count: number): string {
    return count === 1 ? "was" : "were";
}

function aroundSpeech(address: string, pins: readonly MapPin[]): string {
    if (pins.length === 0) {
        return `I don't see any open reports within a few blocks of ${address}.`;
    }
    const yours = pins.filter((pin) => pin.mine).length;
    const mine =
        yours === 0 ? "" : yours === 1 ? " One of them is yours." : ` ${capitalized(numberWord(yours))} are yours.`;
    return (
        `Around ${address}, there ${pins.length === 1 ? "is" : "are"} ` +
        `${countOf(pins.length, "open report")} within a few blocks: ${describePins(pins)}.${mine}`
    );
}

function focusSpeech(focus: MapPin, others: readonly MapPin[]): string {
    const whose = focus.mine ? "Your" : "The";
    const subject = `${whose} ${focus.service_name} report at ${focus.address} is ${STATUS_WORDS[focus.status]}.`;
    if (others.length === 0) {
        return `${subject} There are no other open reports within a few blocks.`;
    }
    return (
        `${subject} ${capitalized(countOf(others.length, "other open report"))} ` +
        `${others.length === 1 ? "is" : "are"} nearby: ${describePins(others)}.`
    );
}

/** "This week around your home, two reports were filed: ... One report was fixed: ..." */
function recentSpeech(address: string, days: number, fresh: readonly MapPin[], fixed: readonly MapPin[]): string {
    const period = days === 7 ? "this week" : days === 1 ? "since yesterday" : `in the last ${days} days`;
    if (fresh.length === 0 && fixed.length === 0) {
        return `Nothing changed around ${address} ${period}: no reports were filed or fixed within a few blocks.`;
    }
    const lead = `${capitalized(period)} around ${address}`;
    const filed =
        fresh.length === 0
            ? `${lead}, no new reports were filed.`
            : `${lead}, ${countOf(fresh.length, "report")} ${was(fresh.length)} filed: ${describePins(fresh)}.`;
    const closed =
        fixed.length === 0
            ? ""
            : ` ${capitalized(countOf(fixed.length, "report"))} ${was(fixed.length)} fixed: ${describePins(fixed)}.`;
    return `${filed}${closed}`;
}

const WHICH_PLACE_SPEECH = "Which place should I show? You can say an intersection, like 14th and U.";

/** The place to map, or what to say instead. Home when the resident named nothing. */
async function placeToMap(
    deps: ToolDeps,
    caller: Caller,
    resident: Resident,
    args: { readonly location_id?: string | null; readonly spoken_place?: string | null },
): Promise<ResolvedLocation | { readonly speech: string }> {
    if (args.location_id !== undefined && args.location_id !== null) {
        return decodeLocationId(args.location_id) ?? { speech: WHICH_PLACE_SPEECH };
    }
    if (args.spoken_place === undefined || args.spoken_place === null) {
        return { address: resident.homeAddress, point: resident.homePoint, isHome: true };
    }
    const outcome = await resolvePlace(deps, caller, args.spoken_place);
    switch (outcome.kind) {
        case "found":
            return outcome.location;
        case "ambiguous":
            return { speech: candidatesSpeech(outcome.candidates) };
        case "not_found":
            return { speech: PLACE_NOT_FOUND_SPEECH };
        case "not_linked":
            return { speech: NOT_LINKED_SPEECH };
    }
}

export function registerShowReportMapTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    registerAppTool(
        server,
        SHOW_REPORT_MAP_TOOL,
        {
            title: "Show report map",
            description:
                "Shows a map of city reports on devices with a screen, and says what it shows. Use it when the user " +
                'asks to see reports: "show me the map", "what\'s been reported around here?", "show me my ' +
                "pothole\". Pass request_id to center on one report, or the place: spoken_place in the user's " +
                "words, or a location_id you already have. With none of them, the map is around the user's home. " +
                'For "what\'s new around here this week?", set recent_days.',
            inputSchema: z.object({
                location_id: z
                    .string()
                    .nullish()
                    .describe("A location_id from start_report or resolve_location, to map that place."),
                spoken_place: z
                    .string()
                    .min(1)
                    .max(200)
                    .nullish()
                    .describe('The place exactly as the user said it, like "14th and U" or "my street".'),
                request_id: z.string().nullish().describe("A request_id, to center the map on that report."),
                recent_days: z
                    .number()
                    .int()
                    .min(1)
                    .max(MAX_RECENT_DAYS)
                    .nullish()
                    .describe(
                        'For "what\'s new" questions: show what was filed or fixed in the last days, 7 for ' +
                            '"this week". Leave out to show what is open now.',
                    ),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            _meta: SHOWS_REPORT_MAP,
        },
        async (args) => {
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }
            const { resident } = found;
            const mine = new Set((await deps.residents.listReports(resident.id)).map((link) => link.requestId));
            const pin = (request: ServiceRequest) =>
                pinFor(request, serviceName(request), mine.has(request.service_request_id));

            const requestId = args.request_id ?? undefined;
            if (requestId !== undefined) {
                const [request] = await deps.open311.getRequests([requestId]);
                if (request === undefined) {
                    return toolFailure("I couldn't find that report anymore.");
                }
                const point = { lat: request.lat, lng: request.long };
                const others = (
                    await reportsAround(
                        deps,
                        point,
                        (other) => other.status === "open" && other.service_request_id !== requestId,
                    )
                )
                    .slice(0, MAX_PINS - 1)
                    .map(pin);
                const focus = pin(request);
                const map: ReportMap = { pins: [focus, ...others], focus_id: requestId };
                return toolSuccess({ speech: focusSpeech(focus, others), data: { map } });
            }

            const location = await placeToMap(deps, caller, resident, args);
            if ("speech" in location) {
                return toolFailure(location.speech);
            }
            const address = location.isHome ? "your home" : location.address;
            const place = placeFor(location.address, location.point);
            const days = args.recent_days ?? undefined;
            if (days !== undefined) {
                const since = deps.now().getTime() - days * DAY_MS;
                const filedSince = (request: ServiceRequest) => Date.parse(request.requested_datetime) >= since;
                const fixedSince = (request: ServiceRequest) =>
                    request.status === "closed" &&
                    Date.parse(request.updated_datetime ?? request.requested_datetime) >= since;
                const recent = (await reportsAround(deps, location.point, (r) => filedSince(r) || fixedSince(r)))
                    .slice(0, MAX_PINS)
                    .map((request) => ({ request, pin: pin(request) }));
                const fresh = recent.filter(({ request }) => filedSince(request) && !fixedSince(request));
                const fixed = recent.filter(({ request }) => fixedSince(request));
                const map: ReportMap = { place, pins: recent.map((entry) => entry.pin) };
                return toolSuccess({
                    speech: recentSpeech(
                        address,
                        days,
                        fresh.map((entry) => entry.pin),
                        fixed.map((entry) => entry.pin),
                    ),
                    data: { map },
                });
            }
            const pins = (await reportsAround(deps, location.point)).slice(0, MAX_PINS).map(pin);
            const map: ReportMap = { place, pins };
            return toolSuccess({ speech: aroundSpeech(address, pins), data: { map } });
        },
    );
}
