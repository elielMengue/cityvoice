import type { Content } from "./orchestrator";

/**
 * What the model needs to see, and nothing more. Every token of history is
 * sent again on every step, and steps got slower as a conversation grew, so
 * the data passed back to the model leaves out what only the screen uses.
 */

// Coordinates and timestamps are for the screen; questions repeat what the
// draft's missing_fields already says.
const SCREEN_ONLY_KEYS = new Set([
    "lat",
    "lng",
    "expires_at",
    "requested_datetime",
    "updated_datetime",
    "expected_datetime",
    "distance_m",
    "typical_business_days",
    "questions",
]);

function strip(value: object): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !SCREEN_ONLY_KEYS.has(key))
            .map(([key, entry]) => [key, forModel(entry)]),
    );
}

function forModel(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(forModel);
    }
    if (typeof value === "object" && value !== null) {
        return strip(value);
    }
    return value;
}

/** A tool's data as the model sees it: ids, names and statuses, without what only the screen uses. */
export function dataForModel(data: Record<string, unknown>): Record<string, unknown> {
    return strip(data);
}

/** How many messages of past conversation go back to the model. A report rarely needs more than four turns. */
export const MAX_HISTORY = 24;

/**
 * The most recent part of the conversation, cut at the start of a turn so a
 * tool result never arrives without the call it answers.
 */
export function recentHistory(history: readonly Content[], max = MAX_HISTORY): Content[] {
    if (history.length <= max) {
        return [...history];
    }
    const recent = history.slice(-max);
    const start = recent.findIndex(
        (content) => content.role === "user" && content.parts.some((part) => part.text !== undefined),
    );
    return start === -1 ? [] : recent.slice(start);
}
