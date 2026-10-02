import { describe, expect, test } from "bun:test";

import type { ReportMap } from "../src/map/reportMap";
import { REPORT_MAP_URI } from "../src/ui/reportMapResource";
import { fitView, MAX_ZOOM, screenPixel, tilesFor, worldPixel } from "../ui/report-map/tiles";
import { createTestApp, TEST_BACKENDS } from "./support/testApp";

const U_STREET = { lat: 38.91705, lng: -77.03196 };
const CAPITOL_HILL = { lat: 38.8883, lng: -76.9982 };

describe("tile math", () => {
    test("places the origin and the antimeridian where Web Mercator puts them", () => {
        expect(worldPixel({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
        expect(worldPixel({ lat: 0, lng: 180 }, 1).x).toBe(512);
    });

    test("zooms all the way in on a single place, and centers it", () => {
        const view = fitView([U_STREET], 768, 480, 48);

        expect(view.zoom).toBe(MAX_ZOOM);
        expect(screenPixel(U_STREET, view, 768, 480)).toEqual({ x: 384, y: 240 });
    });

    test("zooms out until places across the city fit inside the padding", () => {
        const view = fitView([U_STREET, CAPITOL_HILL], 768, 480, 48);

        expect(view.zoom).toBeLessThan(MAX_ZOOM);
        for (const place of [U_STREET, CAPITOL_HILL]) {
            const at = screenPixel(place, view, 768, 480);
            expect(at.x).toBeGreaterThanOrEqual(48);
            expect(at.x).toBeLessThanOrEqual(768 - 48);
            expect(at.y).toBeGreaterThanOrEqual(48);
            expect(at.y).toBeLessThanOrEqual(480 - 48);
        }
    });

    test("covers the whole screen with tiles and no more", () => {
        const view = fitView([U_STREET], 768, 480, 48);
        const tiles = tilesFor(view, 768, 480);

        expect(Math.min(...tiles.map((tile) => tile.left))).toBeLessThanOrEqual(0);
        expect(Math.min(...tiles.map((tile) => tile.top))).toBeLessThanOrEqual(0);
        expect(Math.max(...tiles.map((tile) => tile.left + 256))).toBeGreaterThanOrEqual(768);
        expect(Math.max(...tiles.map((tile) => tile.top + 256))).toBeGreaterThanOrEqual(480);
        expect(tiles.every((tile) => tile.left > -256 && tile.top > -256)).toBe(true);
    });
});

describe.each([...TEST_BACKENDS])("show_report_map (%s)", (backend) => {
    test("with nothing to go on, shows the open reports around the resident's home", async () => {
        const app = createTestApp(backend);

        const outcome = await app.callTool("show_report_map", {}, "aisha");

        expect(outcome.speech).toBe(
            "Around your home, there are four open reports within a few blocks: two broken streetlight reports, " +
                "a missed trash pickup report, and a pothole report. One of them is yours.",
        );
        const map = outcome.data["map"] as ReportMap;
        expect(map.place?.address).toBe("612 A Street Southeast");
        expect(map.pins).toHaveLength(4);
        expect(map.pins.filter((pin) => pin.mine).map((pin) => pin.service_name)).toEqual(["missed trash pickup"]);
    });

    test("centers on one report and says where it stands", async () => {
        const app = createTestApp(backend);

        const outcome = await app.callTool("show_report_map", { request_id: "26-00482233" }, "aisha");

        expect(outcome.speech).toBe(
            "Your pothole report on U Street is in progress. " + "There are no other open reports within a few blocks.",
        );
        const map = outcome.data["map"] as ReportMap;
        expect(map.focus_id).toBe("26-00482233");
        expect(map.pins[0]).toMatchObject({ request_id: "26-00482233", status: "progress", mine: true });
    });

    test("maps a place the resident named", async () => {
        const app = createTestApp(backend);
        const place = await app.callTool("resolve_location", { spoken_place: "14th and U" }, "daniel");

        const outcome = await app.callTool("show_report_map", { location_id: place.data["location_id"] }, "daniel");

        expect(outcome.speech).toBe(
            "Around 14th and U, there is one open report within a few blocks: a pothole report.",
        );
    });

    test("asks for a place when the location id is not one of ours", async () => {
        const app = createTestApp(backend);

        const outcome = await app.callTool("show_report_map", { location_id: "somewhere" }, "daniel");

        expect(outcome.isError).toBe(true);
        expect(outcome.speech).toBe("Which place should I show? You can say an intersection, like 14th and U.");
    });

    test("maps a place in the resident's own words, without a separate lookup", async () => {
        const app = createTestApp(backend);

        const outcome = await app.callTool("show_report_map", { spoken_place: "14th and U" }, "daniel");

        expect(outcome.speech).toStartWith("Around 14th and U,");
        expect((outcome.data["map"] as ReportMap).place?.address).toBe("14th Street and U Street Northwest");
    });

    test("asks which one when the place could be several", async () => {
        const app = createTestApp(backend);

        const outcome = await app.callTool("show_report_map", { spoken_place: "U Street" }, "daniel");

        expect(outcome.isError).toBe(true);
        expect(outcome.speech).toStartWith("A few places could match:");
    });

    test("says so when the report is gone", async () => {
        const app = createTestApp(backend);

        const outcome = await app.callTool("show_report_map", { request_id: "26-00000000" }, "daniel");

        expect(outcome.isError).toBe(true);
        expect(outcome.speech).toBe("I couldn't find that report anymore.");
    });
});

describe("many kinds of reports", () => {
    test("names the three most common and counts the rest, so the sentence stays short", async () => {
        const app = createTestApp();
        const services = ["POTHOLE", "STREETLIGHT", "GRAFFITI", "SIDEWALK", "ABANDONED_VEHICLE", "TREE_HAZARD"];
        for (const [index, service_code] of [...services, "POTHOLE"].entries()) {
            await app.deps.open311.createRequest({
                service_code,
                lat: 38.9171 + index * 0.0001,
                long: -77.032,
                address_string: "14th Street and U Street Northwest",
                description: "test",
                attributes: {},
            });
        }

        const outcome = await app.callTool("show_report_map", { spoken_place: "14th and U" }, "daniel");

        expect(outcome.speech).toMatch(/: \w+ pothole reports, .+, and \w+ other reports\.$/);
        expect(outcome.speech.split(" ").length).toBeLessThanOrEqual(60);
    });
});

describe("scenario C on a screen", () => {
    test("the reports Alexa reads out are the pins on the map, colored by status", async () => {
        const app = createTestApp();

        const outcome = await app.callTool("get_my_reports", {}, "aisha");

        const map = outcome.data["map"] as ReportMap;
        expect(map.pins.map((pin) => [pin.service_name, pin.status, pin.mine])).toEqual([
            ["graffiti", "closed", true],
            ["pothole", "progress", true],
            ["missed trash pickup", "open", true],
        ]);
    });
});

describe("the map as an MCP App", () => {
    test("the tools that come with the map point to it", async () => {
        const app = createTestApp();

        const { result } = await app.rpc("tools/list");
        const tools = result?.["tools"] as { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
        const withMap = tools.filter((tool) => tool._meta?.ui?.resourceUri === REPORT_MAP_URI).map((tool) => tool.name);

        expect(withMap.sort()).toEqual(["get_my_reports", "show_report_map"]);
    });

    test("the page is a versioned HTML resource that loads tiles from this server only", async () => {
        const app = createTestApp();

        const { result } = await app.rpc("resources/read", { uri: REPORT_MAP_URI });
        const [page] = result?.["contents"] as {
            uri: string;
            mimeType: string;
            text: string;
            _meta: { ui: { csp: { resourceDomains: string[]; connectDomains?: string[] } } };
        }[];

        expect(REPORT_MAP_URI).toMatch(/^ui:\/\/cityvoice\/report-map\.[0-9a-f]{12}\.html$/);
        expect(page?.mimeType).toBe("text/html;profile=mcp-app");
        expect(page?.text).toStartWith("<!doctype html>");
        expect(page?.text).not.toContain("/* SCRIPT */");
        expect(page?._meta.ui.csp.resourceDomains).toEqual(["http://localhost"]);
        expect(page?.text).toContain('content="http://localhost/tiles"');
        expect(page?._meta.ui.csp.connectDomains).toBeUndefined();
    });
});
