/**
 * CityVoice files routine city requests. Anything that could put someone in
 * danger goes to 911 instead, and nothing is filed. We would rather send a
 * few non-emergencies to 911 than miss a real one, so the lists are broad.
 */

interface EmergencyRule {
    readonly phrases: readonly string[];
    readonly speech: string;
}

const LEAVE_AND_CALL =
    "That could be an emergency. Please leave the building and call 911 now. I haven't filed anything.";

const RULES: readonly EmergencyRule[] = [
    {
        phrases: [
            "gas",
            "gas leak",
            "gas smell",
            "smell gas",
            "smells like gas",
            "carbon monoxide",
            "fire",
            "on fire",
            "smoke",
            "burning",
            "explosion",
        ],
        speech: LEAVE_AND_CALL,
    },
    {
        phrases: [
            "power line",
            "power lines",
            "downed line",
            "live wire",
            "sparking",
            "electrical wire",
            "wire is down",
        ],
        speech: "That could be dangerous. Please stay well away from it and call 911 now. I haven't filed anything.",
    },
    {
        phrases: [
            "hurt",
            "injured",
            "bleeding",
            "unconscious",
            "not breathing",
            "heart attack",
            "trapped",
            "gun",
            "shooting",
            "shot",
            "stabbing",
            "stabbed",
            "assault",
            "attacked",
            "break in",
            "breaking in",
            "robbery",
            "crash",
            "car accident",
        ],
        speech: "That sounds like an emergency. Please call 911 now. I haven't filed anything.",
    },
];

// Everyday phrases that contain an emergency word but are routine reports,
// like a leaking fire hydrant.
const HARMLESS_PHRASES: readonly string[] = ["fire hydrant", "fire lane", "gas station", "smoke shop"];

function words(text: string): string {
    return ` ${text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `;
}

/** Returns what Alexa should say if the description sounds like an emergency, otherwise undefined. */
export function detectEmergency(description: string): string | undefined {
    const text = HARMLESS_PHRASES.reduce(
        (current, phrase) => current.replaceAll(words(phrase), " "),
        words(description),
    );
    const rule = RULES.find(({ phrases }) => phrases.some((phrase) => text.includes(words(phrase))));
    return rule?.speech;
}
