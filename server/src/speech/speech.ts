/**
 * Small helpers that turn data into sentences a person would say out loud.
 * Alexa reads these as they are, so they avoid symbols, codes and long numbers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest a spoken answer may be. About 30 seconds at Alexa's speaking rate. */
export const MAX_SPEECH_WORDS = 60;

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "two neighbors", "one neighbor", "12 neighbors". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
    const number = NUMBER_WORDS[count] ?? String(count);
    return `${number} ${count === 1 ? singular : plural}`;
}

/** Same as countOf, but starting a sentence: "Two neighbors". */
export function capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a pothole", "an abandoned vehicle". */
export function withArticle(noun: string): string {
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/** "a", "a and b", "a, b, and c". */
export function joinWithAnd(items: readonly string[], conjunction = "and"): string {
    if (items.length <= 2) {
        return items.join(` ${conjunction} `);
    }
    return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1) ?? ""}`;
}

/**
 * Request numbers are long. People only need the last four digits, read one
 * by one: "4 8 2 1".
 */
export function spokenRequestNumber(requestId: string): string {
    const digits = requestId.replace(/\D/g, "");
    return digits.slice(-4).split("").join(" ");
}

/** "today", "yesterday", "4 days ago", "2 weeks ago". */
export function ageInWords(since: Date, now: Date): string {
    const days = Math.floor((now.getTime() - since.getTime()) / DAY_MS);
    if (days <= 0) {
        return "today";
    }
    if (days === 1) {
        return "yesterday";
    }
    if (days < 14) {
        return `${days} days ago`;
    }
    return `${Math.floor(days / 7)} weeks ago`;
}

export function wordCount(speech: string): number {
    return speech.split(/\s+/).filter((word) => word.length > 0).length;
}
