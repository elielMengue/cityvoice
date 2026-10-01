import { SERVICE_TYPES } from "../catalog/serviceCatalog";
import type { BoundingBox, GeoPoint } from "../geo/geo";
import { distanceMeters } from "../geo/geo";
import type { GazetteerEntry } from "../geo/gazetteerGeocoder";
import type { ServiceRequest } from "../open311/types";
import type { MyReport, Resident } from "../residents/residentStore";

/**
 * Demo data for the Washington DC pilot. Places and coordinates are real;
 * residents and reports are made up. Everything is built relative to "now"
 * and from a fixed random seed, so every run, and every take of the demo
 * video, starts from exactly the same state.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DC_BOUNDS: BoundingBox = { south: 38.79, west: -77.12, north: 38.996, east: -76.909 };

export const DC_PLACES: readonly GazetteerEntry[] = [
    // U Street and Shaw
    { address: "14th Street and U Street Northwest", point: { lat: 38.91705, lng: -77.03196 } },
    { address: "13th Street and U Street Northwest", point: { lat: 38.917, lng: -77.0295 } },
    { address: "11th Street and U Street Northwest", point: { lat: 38.91695, lng: -77.02715 } },
    { address: "9th Street and U Street Northwest", point: { lat: 38.91695, lng: -77.02405 } },
    { address: "14th Street and T Street Northwest", point: { lat: 38.9156, lng: -77.03196 } },
    { address: "14th Street and V Street Northwest", point: { lat: 38.9184, lng: -77.03196 } },
    { address: "11th Street and T Street Northwest", point: { lat: 38.9156, lng: -77.02715 } },
    { address: "7th Street and S Street Northwest", point: { lat: 38.9142, lng: -77.0219 } },
    // Columbia Heights
    { address: "14th Street and Irving Street Northwest", point: { lat: 38.9287, lng: -77.0325 } },
    { address: "14th Street and Park Road Northwest", point: { lat: 38.931, lng: -77.0325 } },
    { address: "16th Street and Columbia Road Northwest", point: { lat: 38.9256, lng: -77.0365 } },
    { address: "11th Street and Columbia Road Northwest", point: { lat: 38.9278, lng: -77.0272 } },
    // Capitol Hill
    { address: "8th Street and Pennsylvania Avenue Southeast", point: { lat: 38.8845, lng: -76.995 } },
    { address: "6th Street and East Capitol Street", point: { lat: 38.8899, lng: -76.9987 } },
    { address: "4th Street and A Street Southeast", point: { lat: 38.8883, lng: -77.0003 } },
    { address: "7th Street and C Street Southeast", point: { lat: 38.886, lng: -76.9965 } },
    // Street addresses used by the residents and the scripted reports
    { address: "1421 Columbia Road Northwest", point: { lat: 38.9274, lng: -77.0327 } },
    { address: "1425 Columbia Road Northwest", point: { lat: 38.92745, lng: -77.03295 } },
    { address: "1520 T Street Northwest", point: { lat: 38.9156, lng: -77.0345 } },
    { address: "900 U Street Northwest", point: { lat: 38.91698, lng: -77.02412 } },
    { address: "1100 11th Street Northwest", point: { lat: 38.9045, lng: -77.0271 } },
    { address: "612 A Street Southeast", point: { lat: 38.8883, lng: -76.9982 } },
];

export const DEMO_RESIDENTS: readonly Resident[] = [
    {
        id: "maria",
        name: "Maria",
        homeAddress: "1421 Columbia Road Northwest",
        homePoint: { lat: 38.9274, lng: -77.0327 },
    },
    {
        id: "daniel",
        name: "Daniel",
        homeAddress: "1520 T Street Northwest",
        homePoint: { lat: 38.9156, lng: -77.0345 },
    },
    {
        id: "aisha",
        name: "Aisha",
        homeAddress: "612 A Street Southeast",
        homePoint: { lat: 38.8883, lng: -76.9982 },
    },
];

/** Request numbers filed during the demo start here, so the first one ends in 4 8 2 1. */
export const FIRST_DEMO_REQUEST_NUMBER = 484821;

const NEIGHBORHOOD_CENTERS: readonly GeoPoint[] = [
    { lat: 38.917, lng: -77.029 },
    { lat: 38.929, lng: -77.0325 },
    { lat: 38.8875, lng: -76.9975 },
];

const STREETS_BY_NEIGHBORHOOD: readonly (readonly string[])[] = [
    ["U Street Northwest", "T Street Northwest", "12th Street Northwest", "Vermont Avenue Northwest"],
    ["Columbia Road Northwest", "Irving Street Northwest", "Park Road Northwest", "13th Street Northwest"],
    ["A Street Southeast", "C Street Southeast", "5th Street Southeast", "Independence Avenue Southeast"],
];

// Generated reports stay this far from the places the scripted scenarios
// use, so the scenarios always see exactly the reports written for them.
const SCENARIO_CLEARANCE_METERS = 150;

const SCENARIO_ANCHORS: readonly GeoPoint[] = [
    { lat: 38.91705, lng: -77.03196 }, // Scenario A: 14th and U, no open pothole
    { lat: 38.9274, lng: -77.0327 }, // Scenario B: Maria's home
];

const GENERATED_REPORT_COUNT = 34;

/** Small deterministic PRNG (mulberry32), so the seed is identical on every run. */
function createRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Demo request numbers look like Washington DC's: "26-00484821". */
export function formatDemoRequestId(sequence: number): string {
    return `26-00${sequence}`;
}

const requestId = formatDemoRequestId;

function iso(date: Date): string {
    return date.toISOString();
}

export interface DemoSeed {
    readonly requests: readonly ServiceRequest[];
    readonly residents: readonly Resident[];
    readonly myReports: readonly MyReport[];
}

export function buildDemoSeed(now: Date): DemoSeed {
    const ago = (days: number, hours = 0): Date => new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS);

    const scripted: ServiceRequest[] = [
        // Scenario B: two neighbors already reported the light outside Maria's home.
        {
            service_request_id: requestId(481907),
            status: "open",
            service_name: "broken streetlight",
            service_code: "STREETLIGHT",
            description: "Light pole outside 1425 Columbia Road is completely dark.",
            requested_datetime: iso(ago(4)),
            updated_datetime: iso(ago(4)),
            address: "1425 Columbia Road Northwest",
            lat: 38.92745,
            long: -77.03295,
            supporters: 2,
        },
        // Scenario C: Aisha's three reports.
        {
            service_request_id: requestId(482233),
            status: "open",
            status_notes: "A crew has been assigned.",
            service_name: "pothole",
            service_code: "POTHOLE",
            description: "Deep pothole in the eastbound lane.",
            requested_datetime: iso(ago(6)),
            updated_datetime: iso(ago(1)),
            address: "900 U Street Northwest",
            lat: 38.91698,
            long: -77.02412,
            supporters: 1,
        },
        {
            service_request_id: requestId(482410),
            status: "closed",
            status_notes: "Graffiti removed.",
            service_name: "graffiti",
            service_code: "GRAFFITI",
            description: "Tags on the mailbox.",
            requested_datetime: iso(ago(5)),
            updated_datetime: iso(ago(0, 5)),
            address: "1100 11th Street Northwest",
            lat: 38.9045,
            long: -77.0271,
            supporters: 1,
        },
        {
            service_request_id: requestId(482598),
            status: "open",
            service_name: "missed trash pickup",
            service_code: "MISSED_TRASH",
            description: "Trash not collected on Monday.",
            requested_datetime: iso(ago(2)),
            updated_datetime: iso(ago(2)),
            address: "612 A Street Southeast",
            lat: 38.8883,
            long: -76.9982,
            supporters: 1,
        },
        // Scenario A: a pothole close to 14th and U, but outside the 75 m radius.
        {
            service_request_id: requestId(482015),
            status: "open",
            service_name: "pothole",
            service_code: "POTHOLE",
            description: "Pothole near the bus stop.",
            requested_datetime: iso(ago(3)),
            updated_datetime: iso(ago(3)),
            address: "14th Street and V Street Northwest",
            lat: 38.9184,
            long: -77.03196,
            supporters: 1,
        },
        // Scenario A: a closed pothole at the very spot, which must not count.
        {
            service_request_id: requestId(481522),
            status: "closed",
            status_notes: "Pothole filled.",
            service_name: "pothole",
            service_code: "POTHOLE",
            description: "Pothole in the crosswalk.",
            requested_datetime: iso(ago(20)),
            updated_datetime: iso(ago(12)),
            address: "14th Street and U Street Northwest",
            lat: 38.91708,
            long: -77.03201,
            supporters: 3,
        },
    ];

    const random = createRandom(311);
    const generated: ServiceRequest[] = [];
    let number = 470000;
    while (generated.length < GENERATED_REPORT_COUNT) {
        const neighborhood = Math.floor(random() * NEIGHBORHOOD_CENTERS.length);
        const center = NEIGHBORHOOD_CENTERS[neighborhood] as GeoPoint;
        const point = {
            lat: Number((center.lat + (random() - 0.5) * 0.012).toFixed(5)),
            lng: Number((center.lng + (random() - 0.5) * 0.016).toFixed(5)),
        };
        const service = SERVICE_TYPES[Math.floor(random() * SERVICE_TYPES.length)];
        const streets = STREETS_BY_NEIGHBORHOOD[neighborhood] as readonly string[];
        const street = streets[Math.floor(random() * streets.length)];
        const age = 1 + Math.floor(random() * 25);
        const closed = random() < 0.35;
        const supporters = 1 + Math.floor(random() * 3);
        number += 1 + Math.floor(random() * 300);

        if (SCENARIO_ANCHORS.some((anchor) => distanceMeters(anchor, point) < SCENARIO_CLEARANCE_METERS)) {
            continue;
        }
        if (service === undefined || street === undefined) {
            continue;
        }
        generated.push({
            service_request_id: requestId(number),
            status: closed ? "closed" : "open",
            ...(closed ? { status_notes: "Resolved." } : {}),
            service_name: service.name,
            service_code: service.code,
            requested_datetime: iso(ago(age)),
            updated_datetime: iso(ago(closed ? Math.floor(age / 2) : age)),
            address: `${100 + Math.floor(random() * 1800)} ${street}`,
            lat: point.lat,
            long: point.lng,
            supporters,
        });
    }

    const myReports: MyReport[] = [482233, 482410, 482598].map((id, index) => ({
        residentId: "aisha",
        requestId: requestId(id),
        role: "author",
        createdAt: iso(ago(6 - index * 2)),
    }));

    return { requests: [...scripted, ...generated], residents: DEMO_RESIDENTS, myReports };
}

/** Hands out demo request numbers in order: 26-00484821, 26-00484822, and so on. */
export function createDemoRequestIds(start = FIRST_DEMO_REQUEST_NUMBER): () => string {
    let next = start;
    return () => {
        const id = requestId(next);
        next += 1;
        return id;
    };
}
