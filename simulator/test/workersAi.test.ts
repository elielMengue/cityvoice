import { describe, expect, test } from "bun:test";

import type { Content, Model } from "../src/orchestrator";
import { ModelChain, toChatMessages, toContent, WorkersAi, WorkersAiUnavailableError } from "../src/workersAi";

const request = { systemInstruction: "Be Alexa.", contents: [] as Content[], tools: [] };

describe("toChatMessages", () => {
    test("turns a tool round trip into assistant and tool messages the model can pair", () => {
        const history: Content[] = [
            { role: "user", parts: [{ text: "pothole at 14th and U" }] },
            {
                role: "model",
                parts: [
                    {
                        functionCall: {
                            id: "call_1_0",
                            name: "list_service_types",
                            args: { problem_description: "pothole" },
                        },
                    },
                ],
            },
            {
                role: "user",
                parts: [
                    {
                        functionResponse: {
                            id: "call_1_0",
                            name: "list_service_types",
                            response: { speech: "That sounds like a pothole report." },
                        },
                    },
                ],
            },
        ];

        const messages = toChatMessages("Be Alexa.", history);

        expect(messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
        expect(messages[2]?.tool_calls?.[0]).toEqual({
            id: "call_1_0",
            type: "function",
            function: { name: "list_service_types", arguments: '{"problem_description":"pothole"}' },
        });
        expect(messages[3]).toMatchObject({ tool_call_id: "call_1_0", name: "list_service_types" });
    });
});

describe("toContent", () => {
    test("reads the Workers AI shape, with arguments as an object", () => {
        const content = toContent(
            { tool_calls: [{ name: "resolve_location", arguments: { spoken_place: "home" } }] },
            3,
        );

        expect(content.parts[0]?.functionCall).toEqual({
            id: "call_3_0",
            name: "resolve_location",
            args: { spoken_place: "home" },
        });
    });

    test("reads the OpenAI shape, with arguments as a JSON string", () => {
        const content = toContent(
            {
                choices: [
                    {
                        message: {
                            content: "",
                            tool_calls: [
                                { id: "abc", function: { name: "get_my_reports", arguments: '{"status":"open"}' } },
                            ],
                        },
                    },
                ],
            },
            1,
        );

        expect(content.parts[0]?.functionCall).toEqual({ id: "abc", name: "get_my_reports", args: { status: "open" } });
    });

    test("keeps a plain answer as text", () => {
        expect(toContent({ response: "Done." }, 1).parts).toEqual([{ text: "Done." }]);
    });

    test("never returns an empty message, so the loop can end cleanly", () => {
        expect(toContent({}, 1).parts).toEqual([{ text: "" }]);
    });
});

describe("WorkersAi", () => {
    test("moves to the next model when one fails, and says which answered", async () => {
        const tried: string[] = [];
        const ai = {
            run: async (model: string) => {
                tried.push(model);
                if (model === "busy") {
                    throw new Error("5035: not available on the free plan");
                }
                return { response: "Hello." };
            },
        };

        const result = await new WorkersAi(ai, ["busy", "good"]).generate(request);

        expect(result.model).toBe("good");
        expect(tried).toEqual(["busy", "good"]);
    });

    test("reports when no model answered", async () => {
        const ai = {
            run: async () => {
                throw new Error("daily limit reached");
            },
        };

        await expect(new WorkersAi(ai, ["a"]).generate(request)).rejects.toBeInstanceOf(WorkersAiUnavailableError);
    });
});

describe("ModelChain", () => {
    const answering = (name: string): Model => ({
        generate: async () => ({ content: { role: "model", parts: [{ text: name }] }, model: name }),
    });
    const failing: Model = {
        generate: async () => {
            throw new Error("down");
        },
    };

    test("falls back to the next host", async () => {
        const result = await new ModelChain([failing, answering("backup")]).generate(request);

        expect(result.model).toBe("backup");
    });

    test("says why it fell back, once per skipped host", async () => {
        const reasons: string[] = [];
        const chain = new ModelChain(
            [failing, answering("backup")],
            () => true,
            (error) => reasons.push(String(error)),
        );

        await chain.generate(request);

        expect(reasons).toEqual(["Error: down"]);
    });

    test("uses the first host when it works", async () => {
        const result = await new ModelChain([answering("first"), answering("second")]).generate(request);

        expect(result.model).toBe("first");
    });

    test("passes the last error on when every host fails", async () => {
        await expect(new ModelChain([failing, failing]).generate(request)).rejects.toThrow("down");
    });
});
