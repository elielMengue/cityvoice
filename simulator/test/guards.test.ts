import { describe, expect, test } from "bun:test";

import {
    asksAboutOwnReports,
    groundedAnswers,
    isClearYes,
    NOT_CONFIRMED_MESSAGE,
    soundsLikeReportFacts,
} from "../src/guards";
import type { Content, Model, ToolResult, ToolServer } from "../src/orchestrator";
import { runTurn } from "../src/orchestrator";

describe("isClearYes", () => {
    test.each(["Yes.", "Yeah, send it", "Go ahead", "Add my support.", "yes please", "OK"])("yes: %s", (utterance) => {
        expect(isClearYes(utterance)).toBe(true);
    });

    test.each(["In the road, right lane.", "No, wait", "Yes, but it's on 15th street, not 14th", "Hmm", ""])(
        "not a clear yes: %s",
        (utterance) => {
            expect(isClearYes(utterance)).toBe(false);
        },
    );
});

describe("asksAboutOwnReports", () => {
    test.each([
        "What's happening with my reports?",
        "hi Alexa do I have reports? any news?",
        "did they fix the pothole",
        "Any update on my requests",
        "hi Alexa do I have reports",
        "what did I report last week",
    ])("catches: %s", (utterance) => {
        expect(asksAboutOwnReports(utterance)).toBe(true);
    });

    test.each(["There's a pothole at 14th and U", "Thank you", "What can you do?", "Report graffiti on my street"])(
        "leaves alone: %s",
        (utterance) => {
            expect(asksAboutOwnReports(utterance)).toBe(false);
        },
    );
});

describe("soundsLikeReportFacts", () => {
    test.each([
        "You have three reports open.",
        "The pothole on 14th Street is still open.",
        "The graffiti was closed today.",
        "It's in progress.",
    ])("spots: %s", (text) => {
        expect(soundsLikeReportFacts(text)).toBe(true);
    });

    test.each(["You're welcome!", "Let me know if there's a pothole you'd like to report.", "Hello! How can I help?"])(
        "leaves alone: %s",
        (text) => {
            expect(soundsLikeReportFacts(text)).toBe(false);
        },
    );
});

describe("groundedAnswers", () => {
    test("keeps answers the resident gave and drops the ones the model made up", () => {
        const said = ["There's a huge pothole at 14th and U Street.", "In the road, right lane."];

        expect(groundedAnswers({ position: "in the road" }, said)).toEqual({ position: "in the road" });
        expect(groundedAnswers({ position: "crosswalk" }, said)).toEqual({});
        expect(groundedAnswers({ position: "road" }, ["There's a huge pothole at 14th and U Street."])).toEqual({});
    });
});

describe("runTurn guards", () => {
    function setup(steps: Content["parts"][]) {
        let step = 0;
        const model: Model = {
            generate: async () => ({
                content: { role: "model", parts: steps[step++] ?? [{ text: "" }] },
                model: "fake",
            }),
        };
        const calls: { name: string; args: Record<string, unknown> }[] = [];
        const tools: ToolServer = {
            listTools: async () => ({
                tools: ["draft_report", "submit_report"].map((name) => ({
                    name,
                    description: name,
                    parametersJsonSchema: {},
                })),
                instructions: "",
            }),
            callTool: async (name, args): Promise<ToolResult> => {
                calls.push({ name, args });
                return { isError: false, speech: `${name} ok`, data: {} };
            },
        };
        return { model, tools, calls };
    }

    test("a report is never submitted without the resident's clear yes", async () => {
        const { model, tools, calls } = setup([
            [{ functionCall: { name: "submit_report", args: { draft_id: "d1", user_confirmed: true } } }],
            [{ text: "Should I send it to the city?" }],
        ]);

        const result = await runTurn({ model, tools }, [], "In the road, right lane.");

        expect(calls).toEqual([]);
        expect(result.trace[0]).toMatchObject({ tool: "submit_report", isError: true, speech: NOT_CONFIRMED_MESSAGE });
        expect(result.speech).toBe("Should I send it to the city?");
    });

    test("a clear yes lets the submit through", async () => {
        const { model, tools, calls } = setup([
            [{ functionCall: { name: "submit_report", args: { draft_id: "d1", user_confirmed: true } } }],
            [{ text: "Done." }],
        ]);

        await runTurn({ model, tools }, [], "Yes, send it.");

        expect(calls.map((call) => call.name)).toEqual(["submit_report"]);
    });

    test("answers the model invented are removed before drafting", async () => {
        const { model, tools, calls } = setup([
            [
                {
                    functionCall: {
                        name: "draft_report",
                        args: { service_code: "POTHOLE", answers: { position: "road" } },
                    },
                },
            ],
            [{ text: "Is it in the road or in a crosswalk?" }],
        ]);

        await runTurn({ model, tools }, [], "There's a huge pothole at 14th and U Street.");

        expect(calls[0]?.args).toEqual({ service_code: "POTHOLE", answers: {} });
    });
});
