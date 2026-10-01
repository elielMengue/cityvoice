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
        // First: someone who already called 911 should not be told to call
        // it again. They hear that they did the right thing.
        phrases: [
            "called 911",
            "calling 911",
            "dialed 911",
            "phoned 911",
            "on the phone with 911",
            "911 is coming",
            "911 is on the way",
            "911 are coming",
            "911 are on the way",
            "called the police",
            "called the cops",
            "called an ambulance",
            "called the fire department",
            "help is on the way",
        ],
        speech:
            "You did the right thing calling 911. Stay safe and follow what they tell you. " +
            "When it's over, I can help you report anything the city should fix.",
    },
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
            "in danger",
            "being followed",
            "following me",
            "threatening me",
            "threatened",
        ],
        speech: "That sounds like an emergency. Please call 911 now. I haven't filed anything.",
    },
    {
        // The resident says it is an emergency without saying what. They may
        // be in danger, or they may be calling a fallen tree an emergency, so
        // Alexa sends them to 911 and leaves the door open for a report.
        phrases: ["emergency", "an emergency", "call 911", "need an ambulance", "call an ambulance", "call the police"],
        speech:
            "If anyone is in danger, please call 911 now. If it's a problem in the street, like a fallen tree " +
            "or a broken streetlight, tell me what you see and I'll report it.",
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
    "not an emergency",
    "no emergency",
    "non emergency",
    "emergency vehicle",
    "emergency lane",
];

/**
 * Lower case, words only, with a space at each end so phrases match whole
 * words. Speech recognition writes 911 in several ways, and people say "the
 * 911", so all of them become plain "911".
 */
function words(text: string): string {
    return ` ${text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()} `
        .replaceAll(" nine one one ", " 911 ")
        .replaceAll(" 9 1 1 ", " 911 ")
        .replaceAll(" the 911 ", " 911 ");
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
