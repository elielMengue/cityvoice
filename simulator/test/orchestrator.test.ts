import { describe, expect, test } from "bun:test";

import type { FetchLike } from "../src/boundFetch";
import { Gemini, ModelUnavailableError } from "../src/gemini";
import type { Content, Model, ToolResult, ToolServer } from "../src/orchestrator";
import { FALLBACK_SPEECH, MAX_STEPS, runTurn } from "../src/orchestrator";

/** A model that plays back a script, one answer per step, and records what it was sent. */
function scriptedModel(steps: Content["parts"][]): Model & { calls: Content[][] } {
    const calls: Content[][] = [];
    return {
        calls,
        async generate({ contents }) {
            calls.push([...contents]);
            const parts = steps[calls.length - 1] ?? [{ text: "" }];
            return { content: { role: "model", parts }, model: "fake-model" };
        },
    };
}

function fakeTools(results: Record<string, ToolResult>): ToolServer & { called: string[] } {
    const called: string[] = [];
    return {
        called,
        async listTools() {
            return {
                tools: Object.keys(results).map((name) => ({ name, description: name, parametersJsonSchema: {} })),
                instructions: "Use the tools.",
            };
        },
        async callTool(name) {
            called.push(name);
            const result = results[name];
            if (result === undefined) {
                throw new Error(`unexpected tool ${name}`);
            }
            return result;
        },
    };
}

describe("runTurn", () => {
    test("runs the tools the model asks for and returns its final words", async () => {
        const model = scriptedModel([
            [
                {
                    functionCall: { name: "resolve_location", args: { spoken_place: "14th and U" } },
                    thoughtSignature: "sig-1",
                },
            ],
            [{ text: "I found 14th Street and U Street Northwest." }],
        ]);
        const tools = fakeTools({
            resolve_location: { isError: false, speech: "I found 14th Street and U Street Northwest.", data: {} },
        });

        const result = await runTurn({ model, tools, now: () => 0 }, [], "There's a pothole at 14th and U");

        expect(result.speech).toBe("I found 14th Street and U Street Northwest.");
        expect(tools.called).toEqual(["resolve_location"]);
        expect(result.trace).toEqual([
            {
                tool: "resolve_location",
                args: { spoken_place: "14th and U" },
                isError: false,
                speech: "I found 14th Street and U Street Northwest.",
                data: {},
                ms: 0,
            },
        ]);
    });

    test("sends the model's own message back unchanged, thought signature included", async () => {
        const model = scriptedModel([
            [{ functionCall: { id: "call-1", name: "ping", args: {} }, thoughtSignature: "sig-1" }],
            [{ text: "Up." }],
        ]);
        await runTurn({ model, tools: fakeTools({ ping: { isError: false, speech: "ok" } }) }, [], "hi");

        const secondRequest = model.calls[1] ?? [];
        expect(secondRequest[1]?.parts[0]?.["thoughtSignature"]).toBe("sig-1");
        expect(secondRequest[2]?.parts[0]?.functionResponse).toEqual({
            id: "call-1",
            name: "ping",
            response: { speech: "ok", data: {} },
        });
    });

    test("says a tool error as it is, without asking the model again", async () => {
        const model = scriptedModel([
            [{ functionCall: { name: "start_report", args: { problem_description: "gas smell" } } }],
            [{ text: "This must never be said." }],
        ]);
        const tools = fakeTools({ start_report: { isError: true, speech: "Call 911 now." } });

        const result = await runTurn({ model, tools }, [], "gas smell");

        expect(result.speech).toBe("Call 911 now.");
        expect(model.calls).toHaveLength(1);
    });

    test("says the answer of a resident-facing tool directly, and keeps it in the history", async () => {
        const model = scriptedModel([[{ functionCall: { name: "start_report", args: {} } }]]);
        const tools = fakeTools({
            start_report: { isError: false, speech: "Is it in the road or in a crosswalk?", data: {} },
        });

        const result = await runTurn({ model, tools }, [], "pothole at 14th and U");

        expect(result.speech).toBe("Is it in the road or in a crosswalk?");
        expect(result.steps).toHaveLength(1);
        expect(result.history.at(-1)).toEqual({
            role: "model",
            parts: [{ text: "Is it in the road or in a crosswalk?" }],
        });
    });

    test("lets the model go on after an intermediate tool", async () => {
        const model = scriptedModel([
            [{ functionCall: { name: "resolve_location", args: { spoken_place: "15th and U" } } }],
            [{ text: "Got it, 15th and U." }],
        ]);
        const tools = fakeTools({ resolve_location: { isError: false, speech: "I found 15th and U.", data: {} } });

        const result = await runTurn({ model, tools }, [], "no, it's on 15th");

        expect(model.calls).toHaveLength(2);
        expect(result.speech).toBe("Got it, 15th and U.");
    });

    test("keeps the conversation, so the next turn has the context", async () => {
        const model = scriptedModel([[{ text: "Is it in the road or in a crosswalk?" }]]);
        const history: Content[] = [{ role: "user", parts: [{ text: "pothole" }] }];

        const result = await runTurn({ model, tools: fakeTools({}) }, history, "in the road");

        expect(result.history.map((content) => content.role)).toEqual(["user", "user", "model"]);
    });

    test("gives up politely when the model loops", async () => {
        const loop = Array.from({ length: MAX_STEPS + 2 }, () => [{ functionCall: { name: "ping", args: {} } }]);
        const tools = fakeTools({ ping: { isError: false, speech: "ok" } });

        const result = await runTurn({ model: scriptedModel(loop), tools }, [], "hi");

        expect(result.speech).toBe(FALLBACK_SPEECH);
        expect(tools.called).toHaveLength(MAX_STEPS);
    });
});

describe("Gemini", () => {
    const request = { systemInstruction: "", contents: [], tools: [] };
    const answer = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    test("falls through busy models to the next one", async () => {
        const tried: string[] = [];
        const gemini = new Gemini({
            apiKey: "test",
            models: ["busy-model", "good-model"],
            sleep: async () => {},
            fetch: (async (url: string) => {
                tried.push(url);
                return url.includes("busy-model")
                    ? answer(503, { error: { code: 503, message: "high demand" } })
                    : answer(200, { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }] });
            }) as unknown as FetchLike,
        });

        const result = await gemini.generate(request);

        expect(result.model).toBe("good-model");
        expect(tried).toHaveLength(2);
    });

    test("does not retry a request we got wrong", async () => {
        const gemini = new Gemini({
            apiKey: "test",
            models: ["a", "b"],
            sleep: async () => {},
            fetch: (async () => answer(400, { error: { code: 400, message: "bad schema" } })) as unknown as FetchLike,
        });

        await expect(gemini.generate(request)).rejects.toThrow("bad schema");
    });

    test("sends Gemini only the fields it knows, never the tool's app", async () => {
        let sent: { tools: { functionDeclarations: Record<string, unknown>[] }[] } | undefined;
        const gemini = new Gemini({
            apiKey: "test",
            models: ["a"],
            sleep: async () => {},
            fetch: (async (_url: string, init: RequestInit) => {
                sent = JSON.parse(String(init.body)) as typeof sent;
                return answer(200, { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }] });
            }) as unknown as FetchLike,
        });

        await gemini.generate({
            ...request,
            tools: [{ name: "map", description: "d", parametersJsonSchema: {}, uiResourceUri: "ui://x/map.html" }],
        });

        expect(sent?.tools[0]?.functionDeclarations).toEqual([
            { name: "map", description: "d", parametersJsonSchema: {} },
        ]);
    });

    test("reports when no model answered", async () => {
        const gemini = new Gemini({
            apiKey: "test",
            models: ["a"],
            sleep: async () => {},
            fetch: (async () => answer(503, { error: { code: 503, message: "busy" } })) as unknown as FetchLike,
        });

        await expect(gemini.generate(request)).rejects.toBeInstanceOf(ModelUnavailableError);
    });
});

describe("runTurn with a rejected argument", () => {
    test("lets the model fix its call and never speaks the validation message", async () => {
        const model = scriptedModel([
            [{ functionCall: { name: "get_my_reports", args: { status: null } } }],
            [{ functionCall: { name: "get_my_reports", args: {} } }],
        ]);
        let calls = 0;
        const tools: ToolServer = {
            listTools: async () => ({
                tools: [{ name: "get_my_reports", description: "", parametersJsonSchema: {} }],
                instructions: "",
            }),
            callTool: async () => {
                calls += 1;
                return calls === 1
                    ? { isError: true, speech: "Input validation error: status: Invalid option", forModel: true }
                    : { isError: false, speech: "You have one report.", data: {} };
            },
        };

        const result = await runTurn({ model, tools }, [], "What's happening with my reports?");

        expect(result.speech).toBe("You have one report.");
        expect(result.speech).not.toContain("Input validation");
    });

    test("never says the validation message, even when the model repeats it", async () => {
        const rejection = "Input validation error: user_confirmed: expected boolean, received string";
        const model = scriptedModel([
            [{ functionCall: { name: "submit_report", args: { user_confirmed: "yes" } } }],
            [{ text: rejection }],
        ]);
        const tools = fakeTools({ submit_report: { isError: true, speech: rejection, forModel: true } });

        const result = await runTurn({ model, tools }, [], "Yes, send it.");

        expect(result.speech).toBe(FALLBACK_SPEECH);
    });
});

describe("runTurn with a made-up answer", () => {
    test("asks the server when the model answers about the resident's reports from memory", async () => {
        const model = scriptedModel([[{ text: "You filed three reports. The first is a pothole on 14th Street." }]]);
        const tools = fakeTools({
            get_my_reports: { isError: false, speech: "You don't have any reports right now.", data: {} },
        });

        const result = await runTurn({ model, tools }, [], "What's happening with my reports?");

        expect(tools.called).toEqual(["get_my_reports"]);
        expect(result.speech).toBe("You don't have any reports right now.");
    });

    test("catches made-up report facts even when the question was not recognized", async () => {
        const model = scriptedModel([[{ text: "You have three reports open. The first is still open." }]]);
        const tools = fakeTools({
            get_my_reports: { isError: false, speech: "You have one report.", data: {} },
        });

        const result = await runTurn({ model, tools }, [], "hey, anything from the city lately?");

        expect(tools.called).toEqual(["get_my_reports"]);
        expect(result.speech).toBe("You have one report.");
    });

    test("lets the model answer small talk on its own", async () => {
        const model = scriptedModel([[{ text: "You're welcome!" }]]);
        const tools = fakeTools({ get_my_reports: { isError: false, speech: "unused", data: {} } });

        const result = await runTurn({ model, tools }, [], "Thank you");

        expect(tools.called).toEqual([]);
        expect(result.speech).toBe("You're welcome!");
    });
});

describe("runTurn with an emergency", () => {
    test("lets the server answer when the model only says to call 911", async () => {
        const model = scriptedModel([[{ text: "Call 911." }]]);
        const tools = fakeTools({
            start_report: {
                isError: true,
                speech: "That could be an emergency. Please leave the building and call 911 now. I haven't filed anything.",
            },
        });

        const result = await runTurn({ model, tools }, [], "There's a gas smell on my street");

        expect(tools.called).toEqual(["start_report"]);
        expect(result.trace[0]?.args).toEqual({ problem_description: "There's a gas smell on my street" });
        expect(result.speech).toBe(
            "That could be an emergency. Please leave the building and call 911 now. I haven't filed anything.",
        );
    });

    test("keeps the model's words when it mentions 911 later in a turn", async () => {
        const model = scriptedModel([
            [{ functionCall: { name: "resolve_location", args: {} } }],
            [{ text: "If anyone is hurt, call 911." }],
        ]);
        const tools = fakeTools({ resolve_location: { isError: false, speech: "Found it.", data: {} } });

        const result = await runTurn({ model, tools }, [], "Where is that?");

        expect(tools.called).toEqual(["resolve_location"]);
        expect(result.speech).toBe("If anyone is hurt, call 911.");
    });
});

describe("runTurn context", () => {
    test("tells the page which app comes with a tool, and says the map's sentence directly", async () => {
        const model = scriptedModel([[{ functionCall: { name: "show_report_map", args: {} } }]]);
        const tools: ToolServer = {
            listTools: async () => ({
                tools: [
                    {
                        name: "show_report_map",
                        description: "",
                        parametersJsonSchema: {},
                        uiResourceUri: "ui://cityvoice/report-map.abc.html",
                    },
                ],
                instructions: "",
            }),
            callTool: async () => ({ isError: false, speech: "Here's the map around your home.", data: {} }),
        };

        const result = await runTurn({ model, tools }, [], "Show me the map");

        expect(result.speech).toBe("Here's the map around your home.");
        expect(result.steps).toHaveLength(1);
        expect(result.trace[0]?.uiResourceUri).toBe("ui://cityvoice/report-map.abc.html");
    });

    test("sends the model tool data without what only the screen uses", async () => {
        const model = scriptedModel([
            [{ functionCall: { name: "resolve_location", args: {} } }],
            [{ text: "Got it." }],
        ]);
        const tools = fakeTools({
            resolve_location: {
                isError: false,
                speech: "I found it.",
                data: { location_id: "loc-1", lat: 38.9, lng: -77.0, nearby: [{ id: "r-1", distance_m: 40 }] },
            },
        });

        const result = await runTurn({ model, tools }, [], "14th and U");

        const response = model.calls[1]?.at(-1)?.parts[0]?.functionResponse?.response;
        expect(response).toEqual({ speech: "I found it.", data: { location_id: "loc-1", nearby: [{ id: "r-1" }] } });
        // The screen still gets everything.
        expect(result.trace[0]?.data).toEqual({
            location_id: "loc-1",
            lat: 38.9,
            lng: -77.0,
            nearby: [{ id: "r-1", distance_m: 40 }],
        });
    });
});
