/**
 * CityVoice files routine city requests. Anything that could put someone in
 * danger goes to 911 instead, and nothing is filed. When in doubt we still
 * send people to 911, but a false alarm has a cost too: the resident cannot
 * file their report at all. So we match phrases that describe danger, not
 * single words that often mean something harmless ("the light is shot",
 * "a gas can was dumped", "the lamp is burning all day").
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
            "gas leak",
            "gas leaking",
            "leaking gas",
            "gas smell",
            "smell of gas",
            "smell gas",
            "smells like gas",
            "gas odor",
            "rotten egg",
            "rotten eggs",
            "carbon monoxide",
            "fire",
            "on fire",
            "flames",
            "smoke",
            "burning smell",
            "smells like burning",
            "something burning",
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
            "is hurt",
            "are hurt",
            "someone hurt",
            "badly hurt",
            "injured",
            "bleeding",
            "unconscious",
            "not breathing",
            "heart attack",
            "trapped",
            "gun",
            "shooting",
            "was shot",
            "been shot",
            "shots fired",
            "gunshot",
            "stabbing",
            "stabbed",
            "assault",
            "attacked",
            "break in",
            "breaking in",
            "robbery",
            "car crash",
            "car accident",
            "hit by a car",
        ],
        speech: "That sounds like an emergency. Please call 911 now. I haven't filed anything.",
    },
];

// Everyday phrases that contain an emergency word but are routine reports,
// like a leaking fire hydrant.
const HARMLESS_PHRASES: readonly string[] = [
    "fire hydrant",
    "fire lane",
    "fire escape",
    "gas station",
    "smoke shop",
    "smoke detector",
];

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
