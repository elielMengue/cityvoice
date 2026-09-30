import { describe, expect, test } from "bun:test";

import type { Content, Model, ToolServer } from "../src/orchestrator";
import { runTurn } from "../src/orchestrator";
import { cleanSpeech, extractTextToolCalls } from "../src/textToolCalls";

const TOOLS = new Set(["resolve_location", "list_service_types", "find_nearby_reports"]);

describe("extractTextToolCalls", () => {
    test("finds a Python-style call inside brackets, as open models write it", () => {
        const text = `Let's get started. I'll use U Street to find your location. [resolve_location(spoken_place="U Street")]`;

        expect(extractTextToolCalls(text, TOOLS)).toEqual([
            { name: "resolve_location", args: { spoken_place: "U Street" } },
        ]);
    });

    test("finds several calls and reads numbers and booleans", () => {
        const text = `[list_service_types(problem_description="pothole"), find_nearby_reports(location_id='loc_1', radius_m=75)]`;

        expect(extractTextToolCalls(text, TOOLS)).toEqual([
            { name: "list_service_types", args: { problem_description: "pothole" } },
            { name: "find_nearby_reports", args: { location_id: "loc_1", radius_m: 75 } },
        ]);
    });

    test("finds a JSON call, with parameters or arguments", () => {
        expect(
            extractTextToolCalls('{"name": "resolve_location", "parameters": {"spoken_place": "home"}}', TOOLS),
        ).toEqual([{ name: "resolve_location", args: { spoken_place: "home" } }]);
        expect(
            extractTextToolCalls(
                '{"type":"function","function":{"name":"list_service_types","arguments":"{\\"problem_description\\":\\"graffiti\\"}"}}',
                TOOLS,
            ),
        ).toEqual([{ name: "list_service_types", args: { problem_description: "graffiti" } }]);
    });

    test("ignores tools that do not exist and ordinary sentences", () => {
        expect(extractTextToolCalls("[delete_everything(now=true)]", TOOLS)).toEqual([]);
        expect(extractTextToolCalls("I found 14th Street and U Street Northwest.", TOOLS)).toEqual([]);
    });
});

describe("cleanSpeech", () => {
    test("drops anything technical and keeps the sentence", () => {
        expect(cleanSpeech(`Done. [resolve_location(spoken_place="x")] Ask me anytime.`, TOOLS)).toBe(
            "Done. Ask me anytime.",
        );
        expect(cleanSpeech("The id is location_id and `code`.", TOOLS)).toBe("The id is and.");
    });

    test("turns service codes back into words", () => {
        expect(cleanSpeech("The service is POTHOLE.", TOOLS)).toBe("The service is pothole.");
        expect(cleanSpeech("A MISSED_TRASH report.", TOOLS)).toBe("A missed trash report.");
    });

    test("leaves normal speech alone", () => {
        const speech = "Two neighbors already reported a streetlight out near your home, 4 days ago.";
        expect(cleanSpeech(speech, TOOLS)).toBe(speech);
    });
});

describe("runTurn with a model that writes calls as text", () => {
    test("runs the call for real and never speaks it", async () => {
        const answers: Content["parts"][] = [
            [{ text: `I'll use U Street to find your location. [resolve_location(spoken_place="U Street")]` }],
            [{ text: "A few places could match: 14th and U, or 13th and U. Which one is it?" }],
        ];
        let step = 0;
        const model: Model = {
            generate: async () => ({ content: { role: "model", parts: answers[step++] ?? [] }, model: "fake" }),
        };
        const called: string[] = [];
        const tools: ToolServer = {
            listTools: async () => ({
                tools: [...TOOLS].map((name) => ({ name, description: name, parametersJsonSchema: {} })),
                instructions: "",
            }),
            callTool: async (name) => {
                called.push(name);
                return { isError: false, speech: "A few places could match.", data: {} };
            },
        };

        const result = await runTurn({ model, tools }, [], "pothole on U Street");

        expect(called).toEqual(["resolve_location"]);
        expect(result.speech).toBe("A few places could match: 14th and U, or 13th and U. Which one is it?");
        expect(JSON.stringify(result.history)).not.toContain("I'll use U Street");
    });
});
