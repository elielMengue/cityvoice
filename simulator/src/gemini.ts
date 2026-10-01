import type { Content, Model, ToolDeclaration } from "./orchestrator";
import type { FetchLike } from "./boundFetch";
import { boundFetch } from "./boundFetch";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Past this, a model is treated as unavailable and the next one is tried. */
const REQUEST_TIMEOUT_MS = 15_000;

export class ModelUnavailableError extends Error {}

export interface GeminiOptions {
    readonly apiKey: string;
    /** Tried in order. The free tier is often overloaded, so a busy model falls through to the next. */
    readonly models: readonly string[];
    readonly fetch?: FetchLike;
    readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface GenerateResponse {
    readonly candidates?: readonly { readonly content?: Content }[];
    readonly error?: { readonly code: number; readonly message: string };
}

/**
 * Gemini 3 refuses a history holding function calls without its thought
 * signature, which is the case when another model started the conversation.
 * Google documents this placeholder for calls it did not produce.
 */
const FOREIGN_CALL_SIGNATURE = "skip_thought_signature_validator";

function withSignatures(contents: readonly Content[]): Content[] {
    return contents.map((content) =>
        content.role !== "model"
            ? content
            : {
                  ...content,
                  parts: content.parts.map((part) =>
                      part.functionCall !== undefined && part["thoughtSignature"] === undefined
                          ? { ...part, thoughtSignature: FOREIGN_CALL_SIGNATURE }
                          : part,
                  ),
              },
    );
}

/** Busy or failing on Google's side: worth trying another model. Anything else is our bug. */
function isRetryable(status: number): boolean {
    return status === 429 || status === 404 || status >= 500;
}

/**
 * Gemini over its REST API. Following the Builders' Library, retries happen
 * in this one place, each attempt has a timeout, and the pause between
 * attempts is jittered so many clients do not retry in step.
 */
export class Gemini implements Model {
    private readonly fetch: FetchLike;
    private readonly sleep: (milliseconds: number) => Promise<void>;

    constructor(private readonly options: GeminiOptions) {
        this.fetch = options.fetch ?? boundFetch;
        this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    }

    async generate(request: {
        readonly systemInstruction: string;
        readonly contents: readonly Content[];
        readonly tools: readonly ToolDeclaration[];
    }): Promise<{ readonly content: Content; readonly model: string }> {
        const body = JSON.stringify({
            systemInstruction: { parts: [{ text: request.systemInstruction }] },
            contents: withSignatures(request.contents),
            // Only what Gemini knows: it rejects any other field.
            tools: [
                {
                    functionDeclarations: request.tools.map(({ name, description, parametersJsonSchema }) => ({
                        name,
                        description,
                        parametersJsonSchema,
                    })),
                },
            ],
            generationConfig: { temperature: 0.2 },
        });
        const failures: string[] = [];

        for (const [index, model] of this.options.models.entries()) {
            if (index > 0) {
                await this.sleep(200 + Math.random() * 300);
            }
            let response: Response;
            try {
                response = await this.fetch(`${API_BASE}/${model}:generateContent`, {
                    method: "POST",
                    headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
                    body,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
            } catch (error) {
                failures.push(`${model}: ${error instanceof Error ? error.name : "network error"}`);
                continue;
            }
            const json = (await response.json()) as GenerateResponse;
            if (!response.ok) {
                const reason = `${model}: ${response.status} ${json.error?.message ?? ""}`.trim();
                if (isRetryable(response.status)) {
                    failures.push(reason);
                    continue;
                }
                throw new Error(reason);
            }
            const content = json.candidates?.[0]?.content;
            if (content === undefined) {
                failures.push(`${model}: empty answer`);
                continue;
            }
            return { content: { role: "model", parts: content.parts }, model };
        }
        throw new ModelUnavailableError(`No model answered. ${failures.join("; ")}`);
    }
}
