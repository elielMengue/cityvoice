import type { Content, Model, Part, ToolDeclaration } from "./orchestrator";

/** The Workers AI binding, reduced to the one call we make. */
export interface AiBinding {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export class WorkersAiUnavailableError extends Error {}

interface ChatMessage {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly content: string;
    readonly tool_calls?: readonly {
        readonly id: string;
        readonly type: "function";
        readonly function: { readonly name: string; readonly arguments: string };
    }[];
    readonly tool_call_id?: string;
    readonly name?: string;
}

interface RawToolCall {
    readonly id?: string;
    readonly name?: string;
    readonly arguments?: unknown;
    readonly function?: { readonly name?: string; readonly arguments?: unknown };
}

interface RawOutput {
    readonly response?: unknown;
    readonly tool_calls?: readonly RawToolCall[];
    readonly choices?: readonly {
        readonly message?: { readonly content?: unknown; readonly tool_calls?: readonly RawToolCall[] };
    }[];
}

/**
 * The conversation is kept in Gemini's shape (parts with functionCall and
 * functionResponse). Workers AI speaks the OpenAI chat shape, so the history
 * is translated on the way in and the answer on the way out.
 */
export function toChatMessages(systemInstruction: string, contents: readonly Content[]): ChatMessage[] {
    const messages: ChatMessage[] = [{ role: "system", content: systemInstruction }];
    for (const content of contents) {
        const text = content.parts
            .map((part) => part.text ?? "")
            .join(" ")
            .trim();
        const calls = content.parts.flatMap((part) => (part.functionCall === undefined ? [] : [part.functionCall]));
        const responses = content.parts.flatMap((part) =>
            part.functionResponse === undefined ? [] : [part.functionResponse],
        );
        if (content.role === "model") {
            messages.push({
                role: "assistant",
                content: text,
                ...(calls.length === 0
                    ? {}
                    : {
                          tool_calls: calls.map((call, index) => ({
                              id: call.id ?? `call_${index}`,
                              type: "function" as const,
                              function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
                          })),
                      }),
            });
        } else if (responses.length > 0) {
            for (const [index, response] of responses.entries()) {
                messages.push({
                    role: "tool",
                    tool_call_id: response.id ?? `call_${index}`,
                    name: response.name,
                    content: JSON.stringify(response.response),
                });
            }
        } else {
            messages.push({ role: "user", content: text });
        }
    }
    return messages;
}

function parseArguments(raw: unknown): Record<string, unknown> {
    if (typeof raw === "string") {
        try {
            const parsed: unknown = JSON.parse(raw);
            return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
}

/** Models answer either in the older Workers AI shape or in the OpenAI shape; both become one message. */
export function toContent(output: RawOutput, step: number): Content {
    const message = output.choices?.[0]?.message;
    const rawCalls = output.tool_calls ?? message?.tool_calls ?? [];
    const text = output.response ?? message?.content;
    const parts: Part[] = rawCalls.map((call, index) => ({
        functionCall: {
            // The loop sends this id back with the result, so the model can pair them.
            id: call.id ?? `call_${step}_${index}`,
            name: call.name ?? call.function?.name ?? "",
            args: parseArguments(call.arguments ?? call.function?.arguments),
        },
    }));
    if (typeof text === "string" && text.trim().length > 0) {
        parts.push({ text });
    }
    return { role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] };
}

/**
 * Open models on Cloudflare Workers AI. Several answer in about a second per
 * step, against several seconds for Gemini's free tier. Models are tried in
 * order; the free plan has a daily allowance, and its errors move on to the
 * next model like any other failure.
 */
export class WorkersAi implements Model {
    private step = 0;

    constructor(
        private readonly ai: AiBinding,
        private readonly models: readonly string[],
    ) {}

    async generate(request: {
        readonly systemInstruction: string;
        readonly contents: readonly Content[];
        readonly tools: readonly ToolDeclaration[];
    }): Promise<{ readonly content: Content; readonly model: string }> {
        const messages = toChatMessages(request.systemInstruction, request.contents);
        const tools = request.tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parametersJsonSchema },
        }));
        const failures: string[] = [];
        for (const model of this.models) {
            try {
                const output = (await this.ai.run(model, {
                    messages,
                    tools,
                    max_tokens: 600,
                    temperature: 0.2,
                })) as RawOutput;
                this.step += 1;
                return { content: toContent(output, this.step), model };
            } catch (error) {
                failures.push(`${model}: ${error instanceof Error ? error.message.slice(0, 120) : "failed"}`);
            }
        }
        throw new WorkersAiUnavailableError(`No Workers AI model answered. ${failures.join("; ")}`);
    }
}

/** Tries each model host in order: fast first, then the fallbacks. */
export class ModelChain implements Model {
    constructor(
        private readonly chain: readonly Model[],
        /** Errors that only mean "busy, try later", as opposed to a bug. */
        private readonly isUnavailable: (error: unknown) => boolean = () => false,
    ) {}

    async generate(request: Parameters<Model["generate"]>[0]): ReturnType<Model["generate"]> {
        const errors: unknown[] = [];
        for (const model of this.chain) {
            try {
                return await model.generate(request);
            } catch (error) {
                errors.push(error);
            }
        }
        throw new ModelChainError(errors, errors.length > 0 && errors.every(this.isUnavailable));
    }
}

/** Every host failed. Keeps each reason, so logs show why the first choice failed too. */
export class ModelChainError extends Error {
    constructor(
        readonly errors: readonly unknown[],
        readonly allUnavailable: boolean,
    ) {
        super(`All model hosts failed. ${errors.map((error) => String(error)).join(" | ")}`);
    }
}
