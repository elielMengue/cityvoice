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

    test("passes tool errors to the model as errors", async () => {
        const model = scriptedModel([
            [{ functionCall: { name: "list_service_types", args: { problem_description: "gas smell" } } }],
            [{ text: "Please leave the building and call 911 now." }],
        ]);
        const tools = fakeTools({ list_service_types: { isError: true, speech: "Call 911 now." } });

        await runTurn({ model, tools }, [], "gas smell");

        expect(model.calls[1]?.[2]?.parts[0]?.functionResponse?.response).toEqual({ error: "Call 911 now." });
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
