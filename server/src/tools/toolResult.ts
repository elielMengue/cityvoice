import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Every CityVoice tool answers with two things: a sentence Alexa can say as
 * is, and structured data for the orchestrator and the screen. Keeping both
 * in one place means what is said and what is shown can never drift apart.
 */
export interface ToolPayload<T extends Record<string, unknown>> {
    readonly speech: string;
    readonly data: T;
}

export function toolSuccess<T extends Record<string, unknown>>(payload: ToolPayload<T>): CallToolResult {
    return {
        content: [{ type: "text", text: payload.speech }],
        structuredContent: { speech: payload.speech, data: payload.data },
    };
}

/**
 * A failure the user can act on. The speech must say what to do next and must
 * never contain an error code, an identifier or raw JSON.
 */
export function toolFailure(speech: string): CallToolResult {
    return {
        isError: true,
        content: [{ type: "text", text: speech }],
    };
}
