/**
 * Open models sometimes write a tool call as text instead of making it:
 * "I'll look that up. [resolve_location(spoken_place="U Street")]". Spoken
 * aloud, that is nonsense to a resident. These helpers find such calls so
 * they can be run for real, and clean whatever text is left before Alexa
 * says it.
 */

export interface TextToolCall {
    readonly name: string;
    readonly args: Record<string, unknown>;
}

// key="value", key='value', key=12, key=true
const PYTHON_ARG = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false|True|False|null|None)/g;

function pythonValue(raw: string): unknown {
    if (raw.startsWith('"') || raw.startsWith("'")) {
        return raw.slice(1, -1).replace(/\\(["'\\])/g, "$1");
    }
    if (/^(true|True)$/.test(raw)) {
        return true;
    }
    if (/^(false|False)$/.test(raw)) {
        return false;
    }
    if (/^(null|None)$/.test(raw)) {
        return null;
    }
    return Number(raw);
}

function parsePythonArgs(body: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const match of body.matchAll(PYTHON_ARG)) {
        const [, key, value] = match;
        if (key !== undefined && value !== undefined) {
            args[key] = pythonValue(value);
        }
    }
    return args;
}

/** Every balanced {...} block in the text, outermost only. */
function jsonBlocks(text: string): string[] {
    const blocks: string[] = [];
    let depth = 0;
    let start = -1;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char === "{") {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
        } else if (char === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0) {
                blocks.push(text.slice(start, index + 1));
            }
        }
    }
    return blocks;
}

function fromJson(block: string, toolNames: ReadonlySet<string>): TextToolCall | undefined {
    try {
        const parsed = JSON.parse(block) as Record<string, unknown>;
        const inner = (parsed["function"] as Record<string, unknown> | undefined) ?? parsed;
        const name = inner["name"];
        if (typeof name !== "string" || !toolNames.has(name)) {
            return undefined;
        }
        let args: unknown = inner["arguments"] ?? inner["parameters"] ?? inner["args"] ?? {};
        if (typeof args === "string") {
            args = JSON.parse(args) as unknown;
        }
        return { name, args: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {} };
    } catch {
        return undefined;
    }
}

/** Finds tool calls written as text, for tools that really exist. */
export function extractTextToolCalls(text: string, toolNames: ReadonlySet<string>): TextToolCall[] {
    const calls: TextToolCall[] = [];
    const names = [...toolNames].map((name) => name.replace(/[^\w]/g, "")).join("|");
    if (names.length > 0) {
        const pythonCall = new RegExp(`\\b(${names})\\s*\\(([^)]*)\\)`, "g");
        for (const match of text.matchAll(pythonCall)) {
            const [, name, body] = match;
            if (name !== undefined) {
                calls.push({ name, args: parsePythonArgs(body ?? "") });
            }
        }
    }
    for (const block of jsonBlocks(text)) {
        const call = fromJson(block, toolNames);
        if (call !== undefined) {
            calls.push(call);
        }
    }
    return calls;
}

/**
 * Removes what must never be read aloud: bracketed or braced fragments, tags,
 * code marks, tool names, and snake_case identifiers. What is left is
 * whitespace-normalised.
 */
export function cleanSpeech(text: string, toolNames: ReadonlySet<string>): string {
    let cleaned = text
        .replace(/<[^>]{1,40}>/g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/`[^`]*`/g, " ");
    for (const block of jsonBlocks(cleaned)) {
        cleaned = cleaned.replace(block, " ");
    }
    for (const name of toolNames) {
        cleaned = cleaned.replaceAll(name, " ");
    }
    return (
        cleaned
            .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, " ")
            // Service codes like POTHOLE or MISSED_TRASH become words again.
            .replace(/\b[A-Z][A-Z_]{3,}\b/g, (code) => code.toLowerCase().replace(/_/g, " "))
            .replace(/[*#_{}]/g, " ")
            .replace(/\s+([.,!?;:])/g, "$1")
            .replace(/\s+/g, " ")
            .trim()
    );
}
