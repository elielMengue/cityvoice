/**
 * Web Mercator tile math, the same scheme as OpenStreetMap and every common
 * tile server. Pure functions, so the map's framing is tested without a
 * browser.
 */

export const TILE_SIZE = 256;

/**
 * Tile servers the page loads from. The resource's CSP allows exactly these.
 * OpenStreetMap's own tiles need no key, and its usage policy allows a
 * light, attributed use like this one.
 */
export const TILE_HOSTS = ["https://tile.openstreetmap.org"];

/** Close enough for a street, far enough to see a few blocks around it. */
export const MAX_ZOOM = 17;
/** All of DC fits at this zoom on a small screen. */
export const MIN_ZOOM = 11;

export interface LatLng {
    readonly lat: number;
    readonly lng: number;
}

export interface Pixel {
    readonly x: number;
    readonly y: number;
}

export interface View {
    readonly zoom: number;
    /** The world pixel at the middle of the screen. */
    readonly center: Pixel;
}

export interface Tile {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
    /** Where the tile's top-left corner goes on the screen. */
    readonly left: number;
    readonly top: number;
}

export function worldPixel(point: LatLng, zoom: number): Pixel {
    const size = TILE_SIZE * 2 ** zoom;
    const latRad = (point.lat * Math.PI) / 180;
    return {
        x: ((point.lng + 180) / 360) * size,
        y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * size,
    };
}

/** The highest zoom at which every point fits on the screen, padding included. */
export function fitView(points: readonly LatLng[], width: number, height: number, padding: number): View {
    if (points.length === 0) {
        throw new Error("fitView needs at least one point");
    }
    const usableWidth = Math.max(1, width - 2 * padding);
    const usableHeight = Math.max(1, height - 2 * padding);
    for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
        const view = framing(points, zoom);
        if (view.spanX <= usableWidth && view.spanY <= usableHeight) {
            return { zoom, center: view.center };
        }
    }
    return { zoom: MIN_ZOOM, center: framing(points, MIN_ZOOM).center };
}

function framing(points: readonly LatLng[], zoom: number): { center: Pixel; spanX: number; spanY: number } {
    const pixels = points.map((point) => worldPixel(point, zoom));
    const xs = pixels.map((pixel) => pixel.x);
    const ys = pixels.map((pixel) => pixel.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, spanX: maxX - minX, spanY: maxY - minY };
}

/** Where a place lands on a screen of the given size. */
export function screenPixel(point: LatLng, view: View, width: number, height: number): Pixel {
    const pixel = worldPixel(point, view.zoom);
    return { x: pixel.x - view.center.x + width / 2, y: pixel.y - view.center.y + height / 2 };
}

/** Every tile needed to cover the screen, with its position. */
export function tilesFor(view: View, width: number, height: number): Tile[] {
    const originX = view.center.x - width / 2;
    const originY = view.center.y - height / 2;
    const lastIndex = 2 ** view.zoom - 1;
    const tiles: Tile[] = [];
    for (let y = Math.floor(originY / TILE_SIZE); y * TILE_SIZE < originY + height; y += 1) {
        for (let x = Math.floor(originX / TILE_SIZE); x * TILE_SIZE < originX + width; x += 1) {
            if (x < 0 || y < 0 || x > lastIndex || y > lastIndex) {
                continue;
            }
            tiles.push({ x, y, zoom: view.zoom, left: x * TILE_SIZE - originX, top: y * TILE_SIZE - originY });
        }
    }
    return tiles;
}
