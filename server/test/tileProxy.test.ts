import { describe, expect, test } from "bun:test";

import { DC_BOUNDS } from "../src/demo/dcDemo";
import type { TileCache } from "../src/map/tileProxy";
import { parseTilePath, serveTile, tileInArea } from "../src/map/tileProxy";
import { createTestApp } from "./support/testApp";

/** The tile under 14th and U Street at zoom 16. */
const U_STREET_TILE = "/tiles/16/18744/25070.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function upstream(status = 200) {
    const calls: { url: string; userAgent: string | null }[] = [];
    const fetchTile = async (input: string, init?: RequestInit) => {
        calls.push({ url: input, userAgent: new Headers(init?.headers).get("user-agent") });
        return new Response(status === 200 ? PNG : "blocked", { status });
    };
    return { calls, fetchTile };
}

function memoryCache(): TileCache & { size: () => number } {
    const entries = new Map<string, Response>();
    return {
        size: () => entries.size,
        match: async (request) => entries.get(request.url)?.clone(),
        put: async (request, response) => {
            entries.set(request.url, response);
        },
    };
}

describe("tile paths", () => {
    test("reads zoom, x and y, and nothing else", () => {
        expect(parseTilePath(U_STREET_TILE)).toEqual({ zoom: 16, x: 18744, y: 25070 });
        expect(parseTilePath("/tiles/16/18744/25070.jpg")).toBeUndefined();
        expect(parseTilePath("/tiles/../16/1/2.png")).toBeUndefined();
    });

    test("serves only the zooms the map uses, around the service area", () => {
        expect(tileInArea({ zoom: 16, x: 18744, y: 25070 }, DC_BOUNDS)).toBe(true);
        expect(tileInArea({ zoom: 18, x: 74976, y: 100280 }, DC_BOUNDS)).toBe(false);
        expect(tileInArea({ zoom: 10, x: 292, y: 391 }, DC_BOUNDS)).toBe(false);
        // Paris, at the same zoom.
        expect(tileInArea({ zoom: 16, x: 33199, y: 22547 }, DC_BOUNDS)).toBe(false);
    });
});

describe("serveTile", () => {
    test("fetches the tile from OpenStreetMap as CityVoice, and lets browsers keep it", async () => {
        const { calls, fetchTile } = upstream();

        const response = await serveTile(new Request(`https://cityvoice.test${U_STREET_TILE}`), {
            areas: [DC_BOUNDS],
            fetch: fetchTile,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("image/png");
        expect(response.headers.get("cache-control")).toBe("public, max-age=604800");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
        expect(calls).toEqual([
            {
                url: "https://tile.openstreetmap.org/16/18744/25070.png",
                userAgent: "CityVoice/0.2 (+https://github.com/elielMengue/cityvoice)",
            },
        ]);
    });

    test("asks OpenStreetMap once, then answers from the cache", async () => {
        const { calls, fetchTile } = upstream();
        const cache = memoryCache();
        const request = () => new Request(`https://cityvoice.test${U_STREET_TILE}`);

        await serveTile(request(), { areas: [DC_BOUNDS], fetch: fetchTile, cache });
        const second = await serveTile(request(), { areas: [DC_BOUNDS], fetch: fetchTile, cache });

        expect(second.status).toBe(200);
        expect(calls).toHaveLength(1);
    });

    test("passes a refusal on without caching it", async () => {
        const { fetchTile } = upstream(403);
        const cache = memoryCache();

        const response = await serveTile(new Request(`https://cityvoice.test${U_STREET_TILE}`), {
            areas: [DC_BOUNDS],
            fetch: fetchTile,
            cache,
        });

        expect(response.status).toBe(502);
        expect(cache.size()).toBe(0);
    });

    test("is reachable on the server, and refuses tiles the map would never draw", async () => {
        const app = createTestApp();

        const response = await app.handle(new Request("http://localhost/tiles/16/33199/22547.png"));

        expect(response.status).toBe(404);
    });
});
