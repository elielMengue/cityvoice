/**
 * Rules the simulator enforces in code rather than trusting the prompt: a
 * report is only sent after the resident's clear yes, and only with answers
 * the resident gave. Alexa+ confirms actions with the customer itself; the
 * simulator has to do the same on its own.
 */

/** Tools that change something for the resident, and so need their clear yes. */
export const CONFIRMED_TOOLS: ReadonlySet<string> = new Set(["submit_report", "support_report"]);

const YES_PHRASES = [
    "yes",
    "yeah",
    "yep",
    "yup",
    "sure",
    "ok",
    "okay",
    "please do",
    "go ahead",
    "do it",
    "send it",
    "send",
    "submit",
    "confirm",
    "correct",
    "that's right",
    "that is right",
    "sounds good",
    "add my support",
    "support it",
    "me too",
];

const NO_PHRASES = ["no", "nope", "not", "don't", "do not", "wait", "cancel", "stop", "wrong"];

function words(text: string): string {
    return ` ${text
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;
}

/** A clear yes: a yes phrase, and no word that takes it back. */
export function isClearYes(utterance: string): boolean {
    const text = words(utterance);
    const has = (phrase: string) => text.includes(` ${phrase} `);
    return YES_PHRASES.some(has) && !NO_PHRASES.some(has);
}

export const NOT_CONFIRMED_MESSAGE =
    "The resident has not confirmed in their latest message. Do not call this tool yet: read the report back " +
    "and ask them whether to send it, then wait for their answer.";

const STOP_WORDS = new Set(["the", "and", "for", "with", "it's", "its", "that", "this", "there", "was", "are", "is"]);

function contentWords(text: string): string[] {
    return words(text)
        .trim()
        .split(" ")
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/**
 * Keeps only the draft answers the resident actually gave: each needs at
 * least one of its words in something the resident said. Anything else is
 * dropped, so the server asks the question instead of the model guessing.
 */
export function groundedAnswers(
    answers: Record<string, unknown>,
    residentSaid: readonly string[],
): Record<string, unknown> {
    const said = words(residentSaid.join(" "));
    return Object.fromEntries(
        Object.entries(answers).filter(
            ([, value]) => typeof value === "string" && contentWords(value).some((word) => said.includes(` ${word} `)),
        ),
    );
}

// Questions only the resident's own data can answer: "my reports", "do I
// have any reports", "the one I filed", "did they fix it", "any news".
const OWN_REPORTS =
    /\b(?:my|our)\s+(?:reports?|requests?|complaints?|tickets?)\b|\b(?:do|did|have)\s+i\s+(?:have\s+)?(?:any\s+)?(?:open\s+)?(?:reports?|requests?)\b|\bi\s+(?:reported|filed)\b|\bany\s+(?:news|updates?)\b|\bdid\s+they\s+fix\b/i;

/** True when the resident asks about their own reports, which no model may answer from memory. */
export function asksAboutOwnReports(utterance: string): boolean {
    return OWN_REPORTS.test(utterance);
}

// Counts and statuses of reports. Said without a tool in the turn, they were made up.
const REPORT_FACTS =
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:open\s+)?(?:reports?|requests?)\b|\bstill open\b|\bwas closed\b|\bin progress\b|\bhas been fixed\b/i;

/** True when a sentence states facts about reports: how many, open, closed, in progress. */
export function soundsLikeReportFacts(text: string): boolean {
    return REPORT_FACTS.test(text);
}
