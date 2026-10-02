import { findServiceType } from "../catalog/serviceCatalog";
import type { SqlDatabase } from "../db/sqlDatabase";
import type { BoundingBox } from "../geo/geo";
import { isInside } from "../geo/geo";
import type { GazetteerEntry } from "../geo/gazetteerGeocoder";
import type { FeedFetch, MirrorOutcome } from "../open311/cityMirror";
import { mirrorRequests, readRecentRequests } from "../open311/cityMirror";
import type { ServiceRequest } from "../open311/types";
import type { Resident } from "../residents/residentStore";
import type { City } from "./city";

/**
 * San Francisco, with its real 311 requests. The city publishes them through
 * Open311 GeoReport v2, the same standard CityVoice speaks, so they are read
 * as they are and mirrored into the sandbox. Nothing is ever sent to the
 * city: reports filed here go to the sandbox, like everywhere else.
 */

export const SF_OPEN311_URL = "https://mobile311.sfgov.org/open311/v2";

export const SF_BOUNDS: BoundingBox = { south: 37.703, west: -122.527, north: 37.833, east: -122.348 };

/** Intersections and the demo resident's home, with coordinates checked against OpenStreetMap. */
export const SF_PLACES: readonly GazetteerEntry[] = [
    { address: "16th Street and Mission Street", point: { lat: 37.76517, lng: -122.41941 } },
    { address: "24th Street and Mission Street", point: { lat: 37.75217, lng: -122.41867 } },
    { address: "18th Street and Valencia Street", point: { lat: 37.76166, lng: -122.42128 } },
    { address: "Market Street and 5th Street", point: { lat: 37.78363, lng: -122.40853 } },
    { address: "Market Street and Castro Street", point: { lat: 37.76241, lng: -122.4355 } },
    { address: "Market Street and Van Ness Avenue", point: { lat: 37.77541, lng: -122.41899 } },
    { address: "Columbus Avenue and Broadway", point: { lat: 37.79814, lng: -122.40691 } },
    { address: "Divisadero Street and Hayes Street", point: { lat: 37.77519, lng: -122.43774 } },
    { address: "Hyde Street and Eddy Street", point: { lat: 37.7835, lng: -122.41564 } },
    { address: "Folsom Street and 7th Street", point: { lat: 37.77689, lng: -122.40762 } },
    { address: "3150 18th Street", point: { lat: 37.76271, lng: -122.4142 } },
];

export const SAN_FRANCISCO: City = {
    id: "san-francisco",
    name: "San Francisco",
    serviceArea: SF_BOUNDS,
    places: SF_PLACES,
};

export const SF_RESIDENTS: readonly Resident[] = [
    {
        id: "sam",
        name: "Sam",
        city: "san-francisco",
        homeAddress: "3150 18th Street",
        homePoint: { lat: 37.76271, lng: -122.4142 },
    },
];

/** A request as San Francisco's GeoReport v2 feed sends it. Fields it may leave out are optional. */
export interface SanFranciscoRequest {
    readonly service_request_id?: string;
    readonly status?: string;
    readonly status_notes?: string | null;
    readonly service_name?: string;
    readonly service_code?: string;
    readonly description?: string | null;
    readonly requested_datetime?: string;
    readonly updated_datetime?: string | null;
    readonly address?: string | null;
    readonly lat?: number | null;
    readonly long?: number | null;
}

/**
 * The city's request types that mean the same as one of ours. A match lets
 * CityVoice spot a real duplicate. Anything else keeps the city's own name.
 */
const SAME_SERVICE: Readonly<Record<string, string>> = {
    "street defect": "POTHOLE",
    "pothole and street issues": "POTHOLE",
    streetlights: "STREETLIGHT",
    "streetlight repair": "STREETLIGHT",
    graffiti: "GRAFFITI",
    "curb or sidewalk issues": "SIDEWALK",
    "abandoned vehicles": "ABANDONED_VEHICLE",
    "tree maintenance": "TREE_HAZARD",
};

// The city files dumped mattresses and sweeping under one type; only the
// first is what CityVoice calls illegal dumping.
const CLEANING = "street or sidewalk cleaning";
const DUMPING_WORDS = /\b(dump\w*|garbage|trash|mattress\w*|furniture|couch|debris|bags?)\b/i;

function ourService(name: string, description: string | undefined): string | undefined {
    if (name === CLEANING) {
        return description !== undefined && DUMPING_WORDS.test(description) ? "ILLEGAL_DUMPING" : undefined;
    }
    return SAME_SERVICE[name];
}

/**
 * Turns one of the city's requests into a CityVoice one, or undefined when it
 * cannot be placed on a map: no id, no date, or coordinates outside the city.
 */
export function fromSanFrancisco(raw: SanFranciscoRequest): ServiceRequest | undefined {
    const { service_request_id: id, requested_datetime: requested, lat, long } = raw;
    if (id === undefined || requested === undefined || typeof lat !== "number" || typeof long !== "number") {
        return undefined;
    }
    if (!isInside({ lat, lng: long }, SF_BOUNDS)) {
        return undefined;
    }
    const cityName = (raw.service_name ?? "city request").trim().toLowerCase();
    const description = raw.description?.trim() || undefined;
    const code = ourService(cityName, description);
    const service = code === undefined ? undefined : findServiceType(code);
    const notes = raw.status_notes?.trim();
    return {
        service_request_id: id,
        status: raw.status === "closed" ? "closed" : "open",
        service_name: service?.name ?? cityName,
        service_code: service?.code ?? `SF:${raw.service_code ?? cityName}`,
        requested_datetime: requested,
        lat,
        long,
        supporters: 1,
        ...(notes ? { status_notes: notes } : {}),
        ...(description === undefined ? {} : { description }),
        ...(raw.updated_datetime ? { updated_datetime: raw.updated_datetime } : {}),
        ...(raw.address ? { address: raw.address } : {}),
    };
}

/**
 * Refreshes the mirror of San Francisco's recent requests. Run on a schedule;
 * see src/open311/cityMirror.ts for why the tools never call the city.
 */
export async function syncSanFrancisco(db: SqlDatabase, now: Date, fetchFeed?: FeedFetch): Promise<MirrorOutcome> {
    const raw = await readRecentRequests(SF_OPEN311_URL, fetchFeed);
    const requests = raw.flatMap((item) => {
        const request = typeof item === "object" && item !== null ? fromSanFrancisco(item) : undefined;
        return request === undefined ? [] : [request];
    });
    return mirrorRequests(db, "san-francisco", requests, now);
}
