import { z } from "zod";

import type { GeoPoint } from "../geo/geo";
import type { ServiceRequest } from "../open311/types";

/**
 * What the report map shows. Tools that come with the map put this in
 * data.map; the map page reads nothing else, so any tool can use it.
 */

export const mapStatusSchema = z.enum(["open", "progress", "closed"]);
export type MapStatus = z.infer<typeof mapStatusSchema>;

export const mapPinSchema = z.object({
    request_id: z.string(),
    service_name: z.string(),
    address: z.string(),
    lat: z.number(),
    lng: z.number(),
    status: mapStatusSchema,
    /** The resident filed or supports it. */
    mine: z.boolean(),
});
export type MapPin = z.infer<typeof mapPinSchema>;

export const reportMapSchema = z.object({
    /** The place the map is about, drawn as a ring. Absent when the map shows reports spread across the city. */
    place: z.object({ address: z.string(), lat: z.number(), lng: z.number() }).optional(),
    pins: z.array(mapPinSchema),
    /** The pin to draw larger than the others, when one report is the subject. */
    focus_id: z.string().optional(),
});
export type ReportMap = z.infer<typeof reportMapSchema>;

/** Open with a note from the city means someone is on it. */
export function mapStatus(request: ServiceRequest): MapStatus {
    if (request.status === "closed") {
        return "closed";
    }
    return request.status_notes !== undefined && request.status_notes.trim().length > 0 ? "progress" : "open";
}

export function pinFor(request: ServiceRequest, serviceName: string, mine: boolean): MapPin {
    return {
        request_id: request.service_request_id,
        service_name: serviceName,
        address: request.address ?? "an unknown address",
        lat: request.lat,
        lng: request.long,
        status: mapStatus(request),
        mine,
    };
}

export function placeFor(address: string, point: GeoPoint): NonNullable<ReportMap["place"]> {
    return { address, lat: point.lat, lng: point.lng };
}
