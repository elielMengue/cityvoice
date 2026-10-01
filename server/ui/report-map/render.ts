import type { MapPin, MapStatus, ReportMap } from "../../src/map/reportMap";
import type { LatLng } from "./tiles";
import { fitView, screenPixel, tilesFor } from "./tiles";

/**
 * Draws the report map: street tiles, a ring on the place, one pin per
 * report colored by status, and a legend that counts them. The map is a
 * picture to glance at from across the room, so nothing pans or zooms.
 */

const ATTRIBUTION = "© OpenStreetMap contributors";

const STATUS_LABELS: Record<MapStatus, string> = { open: "Waiting", progress: "In progress", closed: "Closed" };

/** Room around the outermost pins, so none sits on the edge or under the legend. */
const PADDING = 48;

/** OpenStreetMap tiles, served through CityVoice's own origin. */
const TILES_BASE = document.querySelector<HTMLMetaElement>('meta[name="cityvoice-tiles"]')?.content ?? "";

function tileUrl(x: number, y: number, zoom: number): string {
    return `${TILES_BASE}/${zoom}/${x}/${y}.png`;
}

function element(tag: string, className: string, text?: string): HTMLElement {
    const created = document.createElement(tag);
    created.className = className;
    if (text !== undefined) {
        created.textContent = text;
    }
    return created;
}

function pinElement(pin: MapPin, focused: boolean): HTMLElement {
    const marker = element("div", "pin");
    marker.dataset["status"] = pin.status;
    marker.dataset["mine"] = String(pin.mine);
    marker.dataset["focus"] = String(focused);
    marker.title = `${pin.service_name}, ${pin.address}: ${STATUS_LABELS[pin.status].toLowerCase()}`;
    return marker;
}

function legend(pins: readonly MapPin[]): HTMLElement {
    const box = element("div", "legend");
    for (const status of ["open", "progress", "closed"] as const) {
        const count = pins.filter((pin) => pin.status === status).length;
        if (count === 0) {
            continue;
        }
        const row = element("div", "legend-row");
        const dot = element("span", "legend-dot");
        dot.dataset["status"] = status;
        row.append(dot, element("span", "", `${count} ${STATUS_LABELS[status].toLowerCase()}`));
        box.append(row);
    }
    if (pins.some((pin) => pin.mine)) {
        const row = element("div", "legend-row");
        row.append(element("span", "legend-dot legend-mine"), element("span", "", "yours"));
        box.append(row);
    }
    return box;
}

export function renderMap(root: HTMLElement, map: ReportMap): void {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const points: LatLng[] = map.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng }));
    if (map.place !== undefined) {
        points.push(map.place);
    }
    root.replaceChildren();
    if (points.length === 0 || width === 0 || height === 0) {
        root.append(element("p", "empty", "No reports to show here."));
        return;
    }

    const view = fitView(points, width, height, PADDING);
    const tiles = element("div", "tiles");
    for (const tile of tilesFor(view, width, height)) {
        const image = document.createElement("img");
        image.src = tileUrl(tile.x, tile.y, tile.zoom);
        image.alt = "";
        image.style.left = `${tile.left}px`;
        image.style.top = `${tile.top}px`;
        tiles.append(image);
    }
    root.append(tiles);

    if (map.place !== undefined) {
        const ring = element("div", "place");
        const at = screenPixel(map.place, view, width, height);
        ring.style.left = `${at.x}px`;
        ring.style.top = `${at.y}px`;
        ring.title = map.place.address;
        root.append(ring);
    }

    // The focused pin goes last so it is drawn on top of the others.
    const ordered = [...map.pins].sort(
        (a, b) => Number(a.request_id === map.focus_id) - Number(b.request_id === map.focus_id),
    );
    for (const pin of ordered) {
        const marker = pinElement(pin, pin.request_id === map.focus_id);
        const at = screenPixel(pin, view, width, height);
        marker.style.left = `${at.x}px`;
        marker.style.top = `${at.y}px`;
        root.append(marker);
    }

    root.append(legend(map.pins), element("div", "attribution", ATTRIBUTION));
}
