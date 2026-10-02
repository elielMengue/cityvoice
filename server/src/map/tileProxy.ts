import type { BoundingBox } from "../geo/geo";
import { MAX_ZOOM, MIN_ZOOM, TILE_SIZE, worldPixel } from "../../ui/report-map/tiles";

/**
 * Street tiles for the report map, served from our own origin. Fetching
 * OpenStreetMap from the map page broke on some networks: the tile servers
 * block browsers they cannot identify, and an MCP App frame sends no useful
 * Referer. Here tiles are fetched with a User-Agent that names CityVoice,
 * as the OpenStreetMap tile policy asks, and cached for a week: by browsers,
 * and by the edge where the Cache API is available. Only the zooms the map
 * uses, around the service area, are served, so this is not an open proxy.
 */

export const TILES_PATH = "/tiles";

const UPSTREAM = "https://tile.openstreetmap.org";
const USER_AGENT = "CityVoice/0.2 (+https://github.com/elielMengue/cityvoice)";
const CACHE_SECONDS = 7 * 24 * 60 * 60;
/** The map frames pins with a margin, so tiles a little outside the area are drawn too. */
const MARGIN_TILES = 4;

export interface TileCoordinates {
    readonly zoom: number;
    readonly x: number;
    readonly y: number;
}

/** Where the proxy keeps tiles. The Workers edge cache in production; nothing locally. */
export interface TileCache {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
}

export interface TileProxyDeps {
    /** The areas of the cities served; a tile must be near one of them. */
    readonly areas: readonly BoundingBox[];
    readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
    readonly cache?: TileCache | undefined;
}

const TILE_PATTERN = /^\/tiles\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/;

export function parseTilePath(pathname: string): TileCoordinates | undefined {
    const match = TILE_PATTERN.exec(pathname);
    if (match === null) {
        return undefined;
    }
    return { zoom: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
}

/** True for a tile the report map could draw: a zoom it uses, near the service area. */
export function tileInArea(tile: TileCoordinates, area: BoundingBox): boolean {
    if (tile.zoom < MIN_ZOOM || tile.zoom > MAX_ZOOM) {
        return false;
    }
    const northWest = worldPixel({ lat: area.north, lng: area.west }, tile.zoom);
    const southEast = worldPixel({ lat: area.south, lng: area.east }, tile.zoom);
    const index = (pixel: number) => Math.floor(pixel / TILE_SIZE);
    return (
        tile.x >= index(northWest.x) - MARGIN_TILES &&
        tile.x <= index(southEast.x) + MARGIN_TILES &&
        tile.y >= index(northWest.y) - MARGIN_TILES &&
        tile.y <= index(southEast.y) + MARGIN_TILES
    );
}

export async function serveTile(request: Request, deps: TileProxyDeps): Promise<Response> {
    const tile = parseTilePath(new URL(request.url).pathname);
    if (request.method !== "GET" || tile === undefined || !deps.areas.some((area) => tileInArea(tile, area))) {
        return new Response("Not found", { status: 404 });
    }
    const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
    const cached = await deps.cache?.match(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    const fetchTile = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    const upstream = await fetchTile(`${UPSTREAM}/${tile.zoom}/${tile.x}/${tile.y}.png`, {
        headers: { "user-agent": USER_AGENT },
    });
    if (!upstream.ok) {
        // An upstream refusal is not cached, so it heals on its own.
        return new Response("Tile unavailable", { status: 502 });
    }
    const response = new Response(await upstream.arrayBuffer(), {
        headers: {
            "content-type": "image/png",
            "cache-control": `public, max-age=${CACHE_SECONDS}`,
            // Map pages run in sandboxed frames with an opaque origin.
            "access-control-allow-origin": "*",
        },
    });
    await deps.cache?.put(cacheKey, response.clone());
    return response;
}
