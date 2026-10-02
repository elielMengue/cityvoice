import { describe, expect, test } from "bun:test";

import { endsConversation } from "../web/voice/goodbyes";

describe("endsConversation", () => {
    test.each(["Stop", "that's all", "Thanks, that's all", "OK, goodbye.", "No thanks", "no, that's it", "I'm done"])(
        "ends on: %s",
        (utterance) => {
            expect(endsConversation(utterance)).toBe(true);
        },
    );

    test.each([
        "There's a pothole at 14th and U",
        "Yes, send it",
        "No, it's on 15th Street",
        "the bus stop sign is broken",
        "What's happening with my reports?",
    ])("keeps listening after: %s", (utterance) => {
        expect(endsConversation(utterance)).toBe(false);
    });
});
