import { describe, expect, test } from "bun:test";

import { buildDemoSeed, DC_BOUNDS } from "../src/demo/dcDemo";
import { distanceMeters, isInside } from "../src/geo/geo";
import { DEFAULT_RADIUS_METERS } from "../src/tools/findNearbyReports";

const now = new Date("2026-10-15T14:00:00Z");
const seed = buildDemoSeed(now);

describe("demo seed", () => {
    test("has 40 reports with unique ids, all inside Washington DC", () => {
        expect(seed.requests).toHaveLength(40);
        expect(new Set(seed.requests.map((request) => request.service_request_id)).size).toBe(40);
        for (const request of seed.requests) {
            expect(isInside({ lat: request.lat, lng: request.long }, DC_BOUNDS)).toBe(true);
        }
    });

    test("is identical on every run, so demo takes can be repeated", () => {
        expect(buildDemoSeed(now)).toEqual(seed);
    });

    test("leaves no open pothole near 14th and U, for scenario A", () => {
        const corner = { lat: 38.91705, lng: -77.03196 };
        const nearby = seed.requests.filter(
            (request) =>
                request.service_code === "POTHOLE" &&
                request.status === "open" &&
                distanceMeters(corner, { lat: request.lat, lng: request.long }) <= DEFAULT_RADIUS_METERS,
        );
        expect(nearby).toHaveLength(0);
    });

    test("has exactly one open streetlight report near Maria's home, for scenario B", () => {
        const home = seed.residents.find((resident) => resident.id === "maria")?.homePoint;
        if (home === undefined) throw new Error("Maria is missing");
        const nearby = seed.requests.filter(
            (request) =>
                request.service_code === "STREETLIGHT" &&
                request.status === "open" &&
                distanceMeters(home, { lat: request.lat, lng: request.long }) <= DEFAULT_RADIUS_METERS,
        );
        expect(nearby).toHaveLength(1);
        expect(nearby[0]?.supporters).toBe(2);
    });

    test("gives Aisha her three reports, for scenario C", () => {
        expect(seed.myReports.filter((report) => report.residentId === "aisha")).toHaveLength(3);
    });
});
