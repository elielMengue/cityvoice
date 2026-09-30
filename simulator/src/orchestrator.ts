/**
 * The simulated Alexa+ "brain". It takes what the resident said, lets the
 * model pick CityVoice tools, runs them over MCP, and returns what Alexa says.
 *
 * It keeps no state: the browser sends the whole conversation with each turn.
 * Model and MCP server are passed in, so the loop is tested without a network.
 */

/** One part of a Gemini message. Unknown fields, like thought signatures, are kept as they are. */
export interface Part {
    readonly text?: string;
    readonly functionCall?: { readonly id?: string; readonly name: string; readonly args?: Record<string, unknown> };
    readonly functionResponse?: {
        readonly id?: string;
        readonly name: string;
        readonly response: Record<string, unknown>;
    };
    readonly [key: string]: unknown;
}

export interface Content {
    readonly role: "user" | "model";
    readonly parts: readonly Part[];
}

export interface ToolDeclaration {
    readonly name: string;
    readonly description: string;
    readonly parametersJsonSchema: Record<string, unknown>;
}

export interface Model {
    generate(request: {
        readonly systemInstruction: string;
        readonly contents: readonly Content[];
        readonly tools: readonly ToolDeclaration[];
    }): Promise<{ readonly content: Content; readonly model: string }>;
}

export interface ToolResult {
    readonly isError: boolean;
    readonly speech: string;
    readonly data?: Record<string, unknown>;
}

export interface ToolServer {
    listTools(): Promise<{ readonly tools: readonly ToolDeclaration[]; readonly instructions: string }>;
    callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

/** What the "behind the scenes" panel shows for each tool call. */
export interface TraceEntry {
    readonly tool: string;
    readonly args: Record<string, unknown>;
    readonly isError: boolean;
    readonly speech: string;
    readonly data?: Record<string, unknown>;
    readonly ms: number;
}

export interface TurnResult {
    readonly speech: string;
    readonly history: readonly Content[];
    readonly trace: readonly TraceEntry[];
    readonly models: readonly string[];
}

/** A turn that needs more model steps than this is stuck in a loop. */
export const MAX_STEPS = 8;

export const FALLBACK_SPEECH = "Sorry, I lost my train of thought. Could you say that again?";

const PERSONA = `You are Alexa+, speaking to a resident of Washington DC through an Echo Show.
You help them report non-emergency problems to the city and follow their reports, using the CityVoice tools.

How to talk:
- Your answer is spoken aloud. Keep it short, plain and friendly. No lists, markdown, emojis or URLs.
- Every tool result has a "speech" field. Say it exactly as it is. When you called several tools in one turn,
  join their speech in order. Do not add facts that no tool gave you.
- If a tool result is an error, say its text as it is and follow what it asks.
- Ask one question at a time.

How to act:
- The tools already know who the resident is and where they live. Never ask for their name or address;
  for "my house" or "home", pass those words to resolve_location.
- Follow the order in the server instructions below. Always check for nearby reports before drafting.
- Call submit_report with user_confirmed true only if the resident's latest message is a clear yes
  to sending the report. Otherwise ask them.
- If the resident corrects something, update the same draft with its draft_id.`;

function systemInstruction(serverInstructions: string): string {
    return `${PERSONA}\n\nServer instructions:\n${serverInstructions}`;
}

function spokenText(content: Content): string {
    return content.parts
        .map((part) => part.text ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

export async function runTurn(
    deps: { readonly model: Model; readonly tools: ToolServer; readonly now?: () => number },
    history: readonly Content[],
    utterance: string,
): Promise<TurnResult> {
    const now = deps.now ?? (() => Date.now());
    const { tools, instructions } = await deps.tools.listTools();
    const contents: Content[] = [...history, { role: "user", parts: [{ text: utterance }] }];
    const trace: TraceEntry[] = [];
    const models: string[] = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
        const { content, model } = await deps.model.generate({
            systemInstruction: systemInstruction(instructions),
            contents,
            tools,
        });
        models.push(model);
        // The model's message goes back unchanged: Gemini needs its own
        // thought signatures in the history to keep calling tools.
        contents.push(content);

        const calls = content.parts.flatMap((part) => (part.functionCall === undefined ? [] : [part.functionCall]));
        if (calls.length === 0) {
            const speech = spokenText(content);
            return { speech: speech.length > 0 ? speech : FALLBACK_SPEECH, history: contents, trace, models };
        }

        const responses: Part[] = [];
        for (const call of calls) {
            const args = call.args ?? {};
            const started = now();
            const result = await deps.tools.callTool(call.name, args);
            trace.push({ tool: call.name, args, ...result, ms: Math.round(now() - started) });
            responses.push({
                functionResponse: {
                    ...(call.id === undefined ? {} : { id: call.id }),
                    name: call.name,
                    response: result.isError
                        ? { error: result.speech }
                        : { speech: result.speech, data: result.data ?? {} },
                },
            });
        }
        contents.push({ role: "user", parts: responses });
    }

    return { speech: FALLBACK_SPEECH, history: contents, trace, models };
}
