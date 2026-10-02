import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { syncSanFrancisco } from "../src/cities/sanFrancisco";
import type { TestApp } from "./support/testApp";
import { createTestApp, TEST_BACKENDS, TEST_NOW } from "./support/testApp";

/** What a city's system, or a curious judge, gets from the feed. */
async function get(app: TestApp, path: string): Promise<{ status: number; body: unknown; headers: Headers }> {
    const response = await app.handle(new Request(`http://localhost/open311/v2${path}`));
    return { status: response.status, body: await response.json(), headers: response.headers };
}

/** Files a pothole by voice, the way scenario A does, and returns its request number. */
async function fileByVoice(app: TestApp): Promise<string> {
    const started = await app.callTool(
        "start_report",
        { problem_description: "there's a huge pothole", spoken_place: "14th and U Street" },
        "daniel",
    );
    const draftId = (started.data["draft"] as { draft_id: string }).draft_id;
    await app.callTool("draft_report", { draft_id: draftId, answers: { position: "in the road" } }, "daniel");
    const sent = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel");
    return sent.data["request_id"] as string;
}

describe.each([...TEST_BACKENDS])("the Open311 feed (%s)", (backend) => {
    test("lists the services, with the city's questions for each", async () => {
        const app = createTestApp(backend);

        const services = await get(app, "/services.json");
        const pothole = await get(app, "/services/POTHOLE.json");

        expect(services.status).toBe(200);
        expect((services.body as { service_code: string }[]).map((service) => service.service_code)).toContain(
            "POTHOLE",
        );
        expect(pothole.body).toEqual({
            service_code: "POTHOLE",
            attributes: [
                {
                    variable: true,
                    code: "position",
                    datatype: "singlevaluelist",
                    required: true,
                    datatype_description: "Is it in the road or in a crosswalk?",
                    order: 1,
                    description: "Is it in the road or in a crosswalk?",
                    values: [
                        { key: "road", name: "in the road" },
                        { key: "crosswalk", name: "in a crosswalk" },
                    ],
                },
            ],
        });
    });

    test("shows a report filed by voice exactly as a city would receive it", async () => {
        const app = createTestApp(backend);
        const id = await fileByVoice(app);

        const { status, body, headers } = await get(app, `/requests/${id}.json`);

        expect(status).toBe(200);
        expect(headers.get("access-control-allow-origin")).toBe("*");
        expect(body).toEqual([
            {
                service_request_id: id,
                status: "open",
                service_name: "pothole",
                service_code: "POTHOLE",
                description: "there's a huge pothole",
                agency_responsible: "CityVoice sandbox",
                requested_datetime: TEST_NOW.toISOString(),
                updated_datetime: TEST_NOW.toISOString(),
                expected_datetime: expect.any(String),
                address: "14th Street and U Street Northwest",
                lat: 38.91705,
                long: -77.03196,
            },
        ]);
    });

    test("leaves out a description nobody gave", async () => {
        const app = createTestApp(backend);
        const place = await app.callTool("resolve_location", { spoken_place: "14th and U" }, "daniel");
        const draft = await app.callTool(
            "draft_report",
            { location_id: place.data["location_id"], service_code: "POTHOLE", answers: { position: "road" } },
            "daniel",
        );
        const sent = await app.callTool(
            "submit_report",
            { draft_id: draft.data["draft_id"], user_confirmed: true },
            "daniel",
        );

        const { body } = await get(app, `/requests/${String(sent.data["request_id"])}.json`);

        expect((body as Record<string, unknown>[])[0]).not.toHaveProperty("description");
    });

    test("never says who filed a report", async () => {
        const app = createTestApp(backend);
        const id = await fileByVoice(app);

        const { body } = await get(app, `/requests/${id}.json`);

        expect(JSON.stringify(body)).not.toMatch(/daniel|resident|supporters/i);
    });

    test("filters by status, service and id, newest first", async () => {
        const app = createTestApp(backend);
        const id = await fileByVoice(app);

        const open = (await get(app, "/requests.json?status=open&service_code=POTHOLE")).body as {
            service_request_id: string;
            status: string;
            service_code: string;
        }[];
        const byIds = (await get(app, `/requests.json?service_request_id=${id},26-00482233`)).body as unknown[];

        expect(open[0]?.service_request_id).toBe(id);
        expect(open.every((request) => request.status === "open" && request.service_code === "POTHOLE")).toBe(true);
        expect(byIds).toHaveLength(2);
    });

    test("answers mistakes the way the standard does", async () => {
        const app = createTestApp(backend);

        expect(await get(app, "/requests.json?status=pending")).toMatchObject({
            status: 400,
            body: [{ code: 400, description: "status must be open or closed" }],
        });
        expect((await get(app, "/requests/26-99999999.json")).status).toBe(404);
        expect((await get(app, "/requests.xml")).status).toBe(404);
        const post = await app.handle(new Request("http://localhost/open311/v2/requests.json", { method: "POST" }));
        expect(post.status).toBe(405);
    });
});

test("leaves out the requests mirrored from San Francisco: they are the city's, not ours", async () => {
    const app = createTestApp("sql");
    if (app.db === undefined) {
        throw new Error("The SQL backend has a database");
    }
    const feed = await Bun.file(join(import.meta.dir, "fixtures", "sanFranciscoFeed.json")).json();
    await syncSanFrancisco(app.db, TEST_NOW, async () => Response.json(feed));

    const { body } = await get(app, "/requests.json?service_request_id=101000000001");
    const all = (await get(app, "/requests.json")).body as { service_request_id: string }[];

    expect(body).toEqual([]);
    expect(all.some((request) => request.service_request_id.startsWith("1010"))).toBe(false);
});
