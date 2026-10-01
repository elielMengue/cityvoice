import { CONFIRMED_TOOLS, groundedAnswers, isClearYes, NOT_CONFIRMED_MESSAGE } from "./guards";
import { dataForModel, recentHistory } from "./modelView";
import { cleanSpeech, extractTextToolCalls } from "./textToolCalls";

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
    /** The text is meant for the model, for example a rejected argument, and is never spoken. */
    readonly forModel?: boolean;
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
    /** One entry per model step, so slow steps are visible. */
    readonly steps: readonly ModelStep[];
}

export interface ModelStep {
    readonly model: string;
    readonly ms: number;
}

/** A turn that needs more model steps than this is stuck in a loop. */
export const MAX_STEPS = 8;

export const FALLBACK_SPEECH = "Sorry, I lost my train of thought. Could you say that again?";

/** Tools whose speech is the answer to the resident: a question, a readback, or the outcome. */
const SPEAKS_TO_RESIDENT: ReadonlySet<string> = new Set([
    "start_report",
    "draft_report",
    "submit_report",
    "support_report",
    "get_my_reports",
]);

const PERSONA = `You are Alexa+, speaking to a resident of Washington DC through an Echo Show.
You help them report non-emergency problems to the city and follow their reports, using the CityVoice tools.

How to talk:
- Your answer is spoken aloud. Keep it short, plain and friendly. No lists, markdown, emojis or URLs.
- Every tool result has a "speech" field. Say it exactly as it is. When you called several tools in one turn,
  join their speech in order. Do not add facts that no tool gave you.
- If a tool result is an error, say its text as it is and follow what it asks.
- If a tool says to call 911, say only that sentence. Do not add anything before or after it.
- Ask one question at a time.
- Never say what you are about to do, never name a tool, and never write a tool call in your answer.
  Call tools silently; the resident only hears the result.
- Never read out codes or identifiers such as service codes, request ids or location ids.

How to act:
- The tools already know who the resident is and where they live. Never ask for their name or address;
  for "my house" or "home", pass those words as the place.
- Follow the server instructions below: start with start_report, then its next_step. Call start_report for
  every problem the resident describes, emergencies included: it gives the right safety advice.
- Never answer a question for the resident. If the city needs an answer, ask the resident and wait.
- Call submit_report with user_confirmed true only if the resident's latest message is a clear yes
  to sending the report. Otherwise read the report back and ask them.
- If the resident corrects something, update the same draft with its draft_id.`;

function systemInstruction(serverInstructions: string): string {
    return `${PERSONA}\n\nServer instructions:\n${serverInstructions}`;
}

function rawText(content: Content): string {
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
    const toolNames = new Set(tools.map((tool) => tool.name));
    const contents: Content[] = [...recentHistory(history), { role: "user", parts: [{ text: utterance }] }];
    const residentSaid = contents
        .filter((content) => content.role === "user")
        .flatMap((content) => content.parts.flatMap((part) => (part.text === undefined ? [] : [part.text])));
    const trace: TraceEntry[] = [];
    const steps: ModelStep[] = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
        const stepStarted = now();
        const { content, model } = await deps.model.generate({
            systemInstruction: systemInstruction(instructions),
            contents,
            tools,
        });
        steps.push({ model, ms: Math.round(now() - stepStarted) });
        // The model's message goes back unchanged: Gemini needs its own
        // thought signatures in the history to keep calling tools.
        contents.push(content);

        let calls = content.parts.flatMap((part) => (part.functionCall === undefined ? [] : [part.functionCall]));
        if (calls.length === 0) {
            // A call written as text is made for real, and its text is never spoken.
            const written = extractTextToolCalls(rawText(content), toolNames);
            if (written.length > 0) {
                calls = written.map((call, index) => ({ id: `text_${step}_${index}`, ...call }));
                contents[contents.length - 1] = {
                    role: "model",
                    parts: calls.map((call) => ({ functionCall: call })),
                };
            }
        }
        if (calls.length === 0) {
            const speech = cleanSpeech(rawText(content), toolNames);
            return { speech: speech.length > 0 ? speech : FALLBACK_SPEECH, history: contents, trace, steps };
        }

        const responses: Part[] = [];
        const results: { readonly name: string; readonly result: ToolResult; readonly blocked: boolean }[] = [];
        for (const call of calls) {
            let args = call.args ?? {};
            if (call.name === "draft_report" && typeof args["answers"] === "object" && args["answers"] !== null) {
                args = { ...args, answers: groundedAnswers(args["answers"] as Record<string, unknown>, residentSaid) };
            }
            const started = now();
            const blocked = CONFIRMED_TOOLS.has(call.name) && !isClearYes(utterance);
            const result: ToolResult = blocked
                ? { isError: true, speech: NOT_CONFIRMED_MESSAGE }
                : await deps.tools.callTool(call.name, args);
            trace.push({ tool: call.name, args, ...result, ms: Math.round(now() - started) });
            results.push({ name: call.name, result, blocked });
            responses.push({
                functionResponse: {
                    ...(call.id === undefined ? {} : { id: call.id }),
                    name: call.name,
                    response: result.isError
                        ? { error: result.speech }
                        : { speech: result.speech, data: dataForModel(result.data ?? {}) },
                },
            });
        }
        contents.push({ role: "user", parts: responses });

        // When the tools already said what the resident should hear, say it
        // now instead of asking the model to repeat it: one model step fewer,
        // and the wording stays exactly the server's.
        const finished = results.every(
            ({ name, result, blocked }) =>
                !blocked && result.forModel !== true && (SPEAKS_TO_RESIDENT.has(name) || result.isError),
        );
        if (finished) {
            const speech = [...new Set(results.map(({ result }) => result.speech))].join(" ");
            contents.push({ role: "model", parts: [{ text: speech }] });
            return { speech, history: contents, trace, steps };
        }
    }

    return { speech: FALLBACK_SPEECH, history: contents, trace, steps };
}
