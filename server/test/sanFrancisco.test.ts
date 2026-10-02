import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { SanFranciscoRequest } from "../src/cities/sanFrancisco";
import { fromSanFrancisco, SF_OPEN311_URL, syncSanFrancisco } from "../src/cities/sanFrancisco";
import type { ReportMap } from "../src/map/reportMap";
import type { FeedFetch } from "../src/open311/cityMirror";
import { mirrorRequests, readRecentRequests } from "../src/open311/cityMirror";
import { createTestApp, TEST_NOW } from "./support/testApp";

/**
 * San Francisco publishes its 311 requests over Open311 GeoReport v2. These
 * tests use a recorded-style feed, so they never reach the city.
 */

const FEED = (await Bun.file(
    join(import.meta.dir, "fixtures", "sanFranciscoFeed.json"),
).json()) as SanFranciscoRequest[];

/** A feed that serves the fixture and remembers what was asked. */
function fakeFeed(pages: unknown[][] = [FEED]): FeedFetch & { calls: { url: string; init?: RequestInit }[] } {
    const calls: { url: string; init?: RequestInit }[] = [];
    const feed = async (url: string, init?: RequestInit) => {
        calls.push({ url, ...(init === undefined ? {} : { init }) });
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json(pages[page - 1] ?? []);
    };
    return Object.assign(feed, { calls });
}

function byId(id: string): SanFranciscoRequest {
    const found = FEED.find((request) => request.service_request_id === id);
    if (found === undefined) {
        throw new Error(`No ${id} in the fixture`);
    }
    return found;
}

async function sanFranciscoApp() {
    const app = createTestApp("sql");
    if (app.db === undefined) {
        throw new Error("The SQL backend has a database");
    }
    await syncSanFrancisco(app.db, TEST_NOW, fakeFeed());
    return { app, db: app.db };
}

describe("reading San Francisco's requests", () => {
    test("a request type that means the same as ours takes our name, so duplicates are found", () => {
        expect(fromSanFrancisco(byId("101000000001"))).toMatchObject({
            service_code: "GRAFFITI",
            service_name: "graffiti",
            status: "open",
            supporters: 1,
        });
        expect(fromSanFrancisco(byId("101000000005"))).toMatchObject({
            service_code: "POTHOLE",
            status: "closed",
            status_notes: "Pothole filled",
        });
    });

    test("street cleaning counts as illegal dumping only when something was dumped", () => {
        expect(fromSanFrancisco(byId("101000000002"))?.service_code).toBe("ILLEGAL_DUMPING");
        expect(fromSanFrancisco(byId("101000000003"))).toMatchObject({
            service_code: "SF:PW:BSES:Street and Sidewalk Cleaning",
            service_name: "street or sidewalk cleaning",
        });
    });

    test("other types keep the city's own name", () => {
        expect(fromSanFrancisco(byId("101000000004"))?.service_name).toBe("blocked driveway and illegal parking");
    });

    test("requests that cannot go on a map are left out", () => {
        expect(fromSanFrancisco(byId("101000000006"))).toBeUndefined();
        expect(fromSanFrancisco(byId("101000000008"))).toBeUndefined();
        expect(fromSanFrancisco({ status: "open", lat: 37.765, long: -122.419 })).toBeUndefined();
    });

    test("the feed is read page by page, as CityVoice, and only read", async () => {
        const full = Array.from({ length: 200 }, () => ({}));
        const feed = fakeFeed([full, [{}]]);

        const requests = await readRecentRequests(SF_OPEN311_URL, feed);

        expect(requests).toHaveLength(201);
        expect(feed.calls.map((call) => new URL(call.url).searchParams.get("page"))).toEqual(["1", "2"]);
        for (const call of feed.calls) {
            expect(call.init?.method ?? "GET").toBe("GET");
            expect(new Headers(call.init?.headers).get("user-agent")).toStartWith("CityVoice/");
        }
    });

    test("a feed that fails says so, and the mirror is left as it was", async () => {
        const broken: FeedFetch = async () => new Response("busy", { status: 503 });

        await expect(readRecentRequests(SF_OPEN311_URL, broken)).rejects.toThrow("503");
    });
});

describe("the mirror", () => {
    test("keeps the requests that fit on a map, and drops the old ones nobody supports", async () => {
        const { db } = await sanFranciscoApp();

        const { results } = await db
            .prepare("SELECT service_request_id FROM service_requests WHERE source = ?")
            .bind("san-francisco")
            .all<{ service_request_id: string }>();

        expect(results.map((row) => row.service_request_id).sort()).toEqual([
            "101000000001",
            "101000000002",
            "101000000003",
            "101000000004",
            "101000000005",
        ]);
    });

    test("a second run refreshes the city's fields and keeps CityVoice's supporters", async () => {
        const { app, db } = await sanFranciscoApp();
        await app.callTool("support_report", { request_id: "101000000001" }, "sam");
        const closed = { ...byId("101000000001"), status: "closed", updated_datetime: "2026-10-15T13:00:00Z" };

        await syncSanFrancisco(db, TEST_NOW, fakeFeed([[closed]]));

        const [request] = await app.deps.open311.getRequests(["101000000001"]);
        expect(request).toMatchObject({ status: "closed", supporters: 2 });
    });

    test("does not write a request again when nothing about it changed", async () => {
        const { db } = await sanFranciscoApp();
        const changes = () => (db.db.query("SELECT total_changes() AS n").get() as { n: number }).n;
        const before = changes();

        await syncSanFrancisco(db, TEST_NOW, fakeFeed());

        expect(changes()).toBe(before);
    });

    test("never overwrites a request filed through CityVoice", async () => {
        const { db, app } = await sanFranciscoApp();
        const [ours] = await app.deps.open311.getRequests(["26-00482233"]);
        const impostor = fromSanFrancisco({ ...byId("101000000001"), service_request_id: "26-00482233" });
        if (ours === undefined || impostor === undefined) {
            throw new Error("Both requests exist");
        }

        await mirrorRequests(db, "san-francisco", [impostor], TEST_NOW);

        expect((await app.deps.open311.getRequests(["26-00482233"]))[0]).toEqual(ours);
    });
});

describe("Sam, in San Francisco", () => {
    test("hears about the real requests around a corner of his city", async () => {
        const { app } = await sanFranciscoApp();

        const outcome = await app.callTool("show_report_map", { spoken_place: "16th and Mission" }, "sam");

        expect(outcome.speech).toBe(
            "Around 16th and Mission, there are four open reports within a few blocks: a graffiti report, " +
                "a street or sidewalk cleaning report, a blocked driveway and illegal parking report, " +
                "and an illegal dumping report.",
        );
        expect((outcome.data["map"] as ReportMap).pins.map((pin) => pin.request_id)).toContain("101000000001");
    });

    test("is offered to support a real request instead of filing a duplicate", async () => {
        const { app } = await sanFranciscoApp();

        const started = await app.callTool(
            "start_report",
            { problem_description: "someone sprayed graffiti on the wall", spoken_place: "16th and Mission" },
            "sam",
        );

        expect(started.data["next_step"]).toBe("support_or_new_report");
        expect(started.speech).toContain("One neighbor already reported graffiti there, today.");
        const supported = await app.callTool("support_report", { request_id: "101000000001" }, "sam");
        expect(supported.speech).toBe("Done. That's two neighbors now. Ask me anytime for an update.");
    });

    test("files new reports in the sandbox, never with the city", async () => {
        const { app } = await sanFranciscoApp();
        const feed = fakeFeed();

        const started = await app.callTool(
            "start_report",
            { problem_description: "there's a pothole", spoken_place: "Market and Castro" },
            "sam",
        );
        const draftId = (started.data["draft"] as { draft_id: string }).draft_id;
        await app.callTool("draft_report", { draft_id: draftId, answers: { position: "road" } }, "sam");
        const sent = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "sam");

        expect(sent.speech).toStartWith("Done. Your request number ends in");
        expect(feed.calls).toHaveLength(0);
    });

    test("only knows the places of his own city", async () => {
        const { app } = await sanFranciscoApp();

        const outcome = await app.callTool("show_report_map", { spoken_place: "14th and U" }, "sam");

        expect(outcome.isError).toBe(true);
    });

    test("Washington residents do not hear about San Francisco", async () => {
        const { app } = await sanFranciscoApp();

        const outcome = await app.callTool("show_report_map", { spoken_place: "16th and Mission" }, "daniel");

        expect(outcome.isError).toBe(true);
    });
});
