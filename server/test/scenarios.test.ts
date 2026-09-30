import { describe, expect, test } from "bun:test";

import { MAX_SPEECH_WORDS, wordCount } from "../src/speech/speech";
import { DRAFT_TTL_MS } from "../src/tools/draftReport";
import { NOT_LINKED_SPEECH } from "../src/tools/toolContext";
import type { TestBackend } from "./support/testApp";
import { createTestApp as createAppOn, TEST_BACKENDS } from "./support/testApp";

/**
 * The demo scenarios from the project brief, played turn by turn the way the
 * Alexa+ orchestrator would call the tools. If one of these breaks, nothing
 * else matters.
 */

describe.each([...TEST_BACKENDS])("with the %s store", (backend: TestBackend) => {
    const createTestApp = () => createAppOn(backend);

    describe("Scenario A: Daniel reports a new pothole", () => {
        test("from the first sentence to a request number, in three answers", async () => {
            const app = createTestApp();
            const daniel = "daniel";

            // "Alexa, there's a huge pothole at 14th and U Street."
            const place = await app.callTool("resolve_location", { spoken_place: "14th and U Street" }, daniel);
            expect(place.isError).toBe(false);
            expect(place.speech).toBe("I found 14th Street and U Street Northwest.");
            const locationId = place.data["location_id"] as string;

            const services = await app.callTool(
                "list_service_types",
                { problem_description: "there's a huge pothole", location_id: locationId },
                daniel,
            );
            expect(services.speech).toBe("That sounds like a pothole report.");
            const [pothole] = services.data["services"] as { service_code: string }[];
            expect(pothole?.service_code).toBe("POTHOLE");

            const nearby = await app.callTool(
                "find_nearby_reports",
                { location_id: locationId, service_code: "POTHOLE" },
                daniel,
            );
            expect(nearby.speech).toBe("I don't see any open pothole reports there.");

            const draft = await app.callTool(
                "draft_report",
                { location_id: locationId, service_code: "POTHOLE", description: "huge pothole" },
                daniel,
            );
            expect(draft.speech).toBe("Is it in the road or in a crosswalk?");
            expect(draft.data["ready"]).toBe(false);
            const draftId = draft.data["draft_id"] as string;

            // "In the road, right lane."
            const completed = await app.callTool(
                "draft_report",
                {
                    draft_id: draftId,
                    answers: { position: "in the road, right lane" },
                    description: "huge, right lane",
                },
                daniel,
            );
            expect(completed.data["ready"]).toBe(true);
            expect(completed.speech).toBe(
                "Here's your report: a pothole, in the road, at 14th Street and U Street Northwest. " +
                    "Details: huge, right lane. Should I send it to the city?",
            );

            // "Yes."
            const submitted = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, daniel);
            expect(submitted.isError).toBe(false);
            expect(submitted.speech).toBe(
                "Done. Your request number ends in 4 8 2 1. " +
                    "The city usually handles potholes within 3 business days. Ask me anytime for an update.",
            );
            expect(submitted.data["request_id"]).toBe("26-00484821");

            // The report is really in the city's system now.
            const [filed] = await app.deps.open311.getRequests(["26-00484821"]);
            expect(filed).toMatchObject({
                service_code: "POTHOLE",
                status: "open",
                address: "14th Street and U Street Northwest",
            });
        });

        test("a retried submit returns the same request instead of filing twice", async () => {
            const app = createTestApp();
            const draftId = await readyPotholeDraft(app);

            const first = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel");
            const retry = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel");

            expect(retry.data["request_id"]).toBe(first.data["request_id"] as string);
            const potholes = await app.deps.open311.findRequests({ service_code: "POTHOLE", status: "open" });
            expect(potholes.filter((request) => request.description === "huge pothole")).toHaveLength(1);
        });

        test("two submit calls at the same moment file one report", async () => {
            const app = createTestApp();
            const draftId = await readyPotholeDraft(app);

            const outcomes = await Promise.all([
                app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel"),
                app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel"),
            ]);

            const filed = await app.deps.open311.findRequests({ service_code: "POTHOLE" });
            expect(filed.filter((request) => request.description === "huge pothole")).toHaveLength(1);
            expect(outcomes.filter((outcome) => !outcome.isError)).toHaveLength(1);
            const retry = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel");
            expect(retry.data["request_id"]).toBe("26-00484821");
        });

        test("a spoken street address resolves to that exact address", async () => {
            const app = createTestApp();

            const place = await app.callTool("resolve_location", { spoken_place: "1421 Columbia Road" }, "daniel");

            expect(place.speech).toBe("I found 1421 Columbia Road Northwest.");
        });

        test("an obvious service is named, not offered as a choice", async () => {
            const app = createTestApp();

            const outcome = await app.callTool(
                "list_service_types",
                { problem_description: "a tree branch is blocking the sidewalk" },
                "daniel",
            );

            expect(outcome.speech).toBe("That sounds like a tree hazard report.");
            expect(outcome.data["clear_match"]).toBe(true);
        });

        test("nothing is sent without an explicit yes", async () => {
            const app = createTestApp();
            const draftId = await readyPotholeDraft(app);

            const refused = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: false }, "daniel");

            expect(refused.isError).toBe(true);
            expect(refused.speech).toBe("I haven't sent anything. Just say yes when you want me to send the report.");
            const potholes = await app.deps.open311.findRequests({ service_code: "POTHOLE" });
            expect(potholes.some((request) => request.description === "huge pothole")).toBe(false);
        });

        test("a correction of the place keeps the answers already given", async () => {
            const app = createTestApp();
            const draftId = await readyPotholeDraft(app);

            // "No, it's on 14th and T."
            const newPlace = await app.callTool("resolve_location", { spoken_place: "14th and T" }, "daniel");
            const corrected = await app.callTool(
                "draft_report",
                { draft_id: draftId, location_id: newPlace.data["location_id"] },
                "daniel",
            );

            expect(corrected.data["ready"]).toBe(true);
            expect(corrected.data["readback"]).toBe(
                "a pothole, in the road, at 14th Street and T Street Northwest. Details: huge pothole.",
            );
        });

        test("an answer that fits no option is asked again, not guessed", async () => {
            const app = createTestApp();
            const place = await app.callTool("resolve_location", { spoken_place: "14th and U" }, "daniel");
            const draft = await app.callTool(
                "draft_report",
                {
                    location_id: place.data["location_id"],
                    service_code: "POTHOLE",
                    answers: { position: "I don't know, somewhere" },
                },
                "daniel",
            );

            expect(draft.speech).toBe("Sorry, I didn't catch that. Is it in the road or in a crosswalk?");
        });

        test("a draft left for more than 15 minutes cannot be sent", async () => {
            const app = createTestApp();
            const draftId = await readyPotholeDraft(app);
            app.advance(DRAFT_TTL_MS + 1000);

            const late = await app.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel");

            expect(late.isError).toBe(true);
            expect(late.speech).toContain("timed out");
        });
    });

    describe("Scenario B: Maria supports her neighbors' streetlight report", () => {
        test("after supporting, Maria is told she supports it, not that she filed it", async () => {
            const app = createTestApp();
            const place = await app.callTool("resolve_location", { spoken_place: "my house" }, "maria");
            const args = { location_id: place.data["location_id"], service_code: "STREETLIGHT" };
            const nearby = await app.callTool("find_nearby_reports", args, "maria");
            const [report] = nearby.data["reports"] as { request_id: string }[];
            await app.callTool("support_report", { request_id: report?.request_id }, "maria");

            const again = await app.callTool("find_nearby_reports", args, "maria");

            expect(again.speech).toBe(
                "You already support a streetlight out report near your home. It has three neighbors behind it and it's still open.",
            );
        });

        test("two support calls at the same moment count Maria once", async () => {
            const app = createTestApp();

            await Promise.all([
                app.callTool("support_report", { request_id: "26-00481907" }, "maria"),
                app.callTool("support_report", { request_id: "26-00481907" }, "maria"),
            ]);

            const [request] = await app.deps.open311.getRequests(["26-00481907"]);
            expect(request?.supporters).toBe(3);
        });

        test("the duplicate is found and Maria adds her support", async () => {
            const app = createTestApp();
            const maria = "maria";

            // "Alexa, the streetlight in front of my house is out."
            const place = await app.callTool("resolve_location", { spoken_place: "in front of my house" }, maria);
            expect(place.speech).toBe("I'll use your home address, 1421 Columbia Road Northwest.");

            const services = await app.callTool(
                "list_service_types",
                { problem_description: "the streetlight is out", location_id: place.data["location_id"] },
                maria,
            );
            expect((services.data["services"] as { service_code: string }[])[0]?.service_code).toBe("STREETLIGHT");

            const nearby = await app.callTool(
                "find_nearby_reports",
                { location_id: place.data["location_id"], service_code: "STREETLIGHT" },
                maria,
            );
            expect(nearby.speech).toBe(
                "Two neighbors already reported a streetlight out near your home, 4 days ago. " +
                    "Do you want to add your support so the city sees it matters, or file a separate report?",
            );
            const [report] = nearby.data["reports"] as { request_id: string }[];

            // "Add my support."
            const supported = await app.callTool("support_report", { request_id: report?.request_id }, maria);
            expect(supported.speech).toBe("Done. That's three neighbors now. Ask me anytime for an update.");

            // Asking twice changes nothing.
            const again = await app.callTool("support_report", { request_id: report?.request_id }, maria);
            expect(again.speech).toBe("You already support that report. It has three neighbors behind it.");
            expect(again.data["supporters"]).toBe(3);
        });
    });

    describe("Scenario C: Aisha asks what's happening with her reports", () => {
        test("each report gets its status in plain words, newest news first", async () => {
            const app = createTestApp();

            // "Alexa, what's happening with my reports?"
            const outcome = await app.callTool("get_my_reports", {}, "aisha");

            expect(outcome.speech).toBe(
                "You have three reports. " +
                    "The graffiti at 1100 11th Street Northwest was closed today. " +
                    "The pothole at 900 U Street Northwest is in progress: a crew has been assigned. " +
                    "The missed trash pickup at 612 A Street Southeast is still waiting for the city, filed 2 days ago.",
            );
            const reports = outcome.data["reports"] as { status: string; lat: number }[];
            expect(reports.map((report) => report.status)).toEqual(["closed", "open", "open"]);
            expect(outcome.data["next_cursor"]).toBeUndefined();
        });

        test("can be narrowed to open reports", async () => {
            const app = createTestApp();

            const outcome = await app.callTool("get_my_reports", { status: "open" }, "aisha");

            expect(outcome.speech).toStartWith("You have two open reports.");
        });

        test("a report the resident supports is listed as supported, not filed", async () => {
            const app = createTestApp();
            await app.callTool("support_report", { request_id: "26-00481907" }, "maria");

            const outcome = await app.callTool("get_my_reports", {}, "maria");

            expect(outcome.speech).toStartWith(
                "You have one report. The streetlight out you support at 1425 Columbia Road Northwest",
            );
        });

        test("long lists are read three at a time", async () => {
            const app = createTestApp();
            for (const place of ["14th and U", "14th and T", "14th and V", "11th and T"]) {
                const location = await app.callTool("resolve_location", { spoken_place: place }, "daniel");
                const draft = await app.callTool(
                    "draft_report",
                    { location_id: location.data["location_id"], service_code: "SIDEWALK" },
                    "daniel",
                );
                await app.callTool(
                    "submit_report",
                    { draft_id: draft.data["draft_id"], user_confirmed: true },
                    "daniel",
                );
            }

            const first = await app.callTool("get_my_reports", {}, "daniel");
            expect(first.speech).toStartWith("You have four reports.");
            expect(first.speech).toEndWith("There is one more. Want to hear it?");
            expect(first.data["reports"] as unknown[]).toHaveLength(3);

            const second = await app.callTool("get_my_reports", { cursor: first.data["next_cursor"] }, "daniel");
            expect(second.data["reports"] as unknown[]).toHaveLength(1);
            expect(second.speech).not.toContain("You have");
            expect(second.data["next_cursor"]).toBeUndefined();
        });

        test("someone with no reports hears so", async () => {
            const app = createTestApp();

            const outcome = await app.callTool("get_my_reports", {}, "daniel");

            expect(outcome.speech).toBe("You don't have any reports right now.");
        });
    });

    describe("Scenario D: an emergency is never filed", () => {
        test.each([
            ["there's a gas smell in my building", "leave the building and call 911"],
            ["I can see smoke coming from a house", "leave the building and call 911"],
            ["a tree fell on a power line", "stay well away from it and call 911"],
            ["someone is hurt on the sidewalk", "Please call 911 now"],
        ])("%s", async (description, advice) => {
            const app = createTestApp();

            const outcome = await app.callTool("list_service_types", { problem_description: description }, "aisha");

            expect(outcome.isError).toBe(true);
            expect(outcome.speech).toContain(advice);
            expect(outcome.speech).toContain("I haven't filed anything.");
        });

        test("routine reports that mention a scary word still go through", async () => {
            const app = createTestApp();

            const outcome = await app.callTool(
                "list_service_types",
                { problem_description: "the fire hydrant on my corner is covered in graffiti" },
                "aisha",
            );

            expect(outcome.isError).toBe(false);
            expect((outcome.data["services"] as { service_code: string }[])[0]?.service_code).toBe("GRAFFITI");
        });
    });

    describe("Edges every scenario relies on", () => {
        test("an ambiguous place gets up to three candidates to choose from", async () => {
            const app = createTestApp();

            const outcome = await app.callTool("resolve_location", { spoken_place: "14th Street" }, "daniel");

            expect(outcome.data["location_id"]).toBeUndefined();
            expect((outcome.data["candidates"] as unknown[]).length).toBe(3);
            expect(outcome.speech).toStartWith("A few places could match:");
            expect(outcome.speech).toEndWith("Which one is it?");
        });

        test("a place outside the city is refused", async () => {
            const app = createTestApp();

            const outcome = await app.callTool("resolve_location", { spoken_place: "Times Square" }, "daniel");

            expect(outcome.isError).toBe(true);
        });

        test("a resident who has not linked an account is told how to fix it", async () => {
            const app = createTestApp();

            const outcome = await app.callTool("resolve_location", { spoken_place: "my house" });

            expect(outcome.isError).toBe(true);
            expect(outcome.speech).toBe(NOT_LINKED_SPEECH);
        });

        test("a tampered location id is rejected", async () => {
            const app = createTestApp();

            const outcome = await app.callTool(
                "find_nearby_reports",
                { location_id: "loc_not-a-real-place", service_code: "POTHOLE" },
                "daniel",
            );

            expect(outcome.isError).toBe(true);
            expect(outcome.speech).toContain("lost track of the place");
        });
    });

    describe("Voice rules", () => {
        test("every sentence is short, plain, and free of codes", async () => {
            const app = createTestApp();
            await readyPotholeDraft(app);
            const place = await app.callTool("resolve_location", { spoken_place: "my home" }, "maria");
            await app.callTool(
                "find_nearby_reports",
                { location_id: place.data["location_id"], service_code: "STREETLIGHT" },
                "maria",
            );
            await app.callTool("list_service_types", { problem_description: "gas leak" }, "maria");
            await app.callTool("list_service_types", { problem_description: "the tree is dead" }, "maria");
            await app.callTool("get_my_reports", {}, "aisha");

            expect(app.spoken.length).toBeGreaterThan(5);
            for (const speech of app.spoken) {
                expect(wordCount(speech)).toBeLessThanOrEqual(MAX_SPEECH_WORDS);
                expect(speech).not.toMatch(/[{}[\]_]/);
                expect(speech).not.toMatch(/\d{5,}/);
                expect(speech).not.toMatch(/as you can see|on the screen|below/i);
            }
        });
    });
});

async function readyPotholeDraft(app: ReturnType<typeof createAppOn>): Promise<string> {
    const place = await app.callTool("resolve_location", { spoken_place: "14th and U" }, "daniel");
    const draft = await app.callTool(
        "draft_report",
        {
            location_id: place.data["location_id"],
            service_code: "POTHOLE",
            description: "huge pothole",
            answers: { position: "road" },
        },
        "daniel",
    );
    expect(draft.data["ready"]).toBe(true);
    return draft.data["draft_id"] as string;
}
