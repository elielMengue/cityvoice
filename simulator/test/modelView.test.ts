import { describe, expect, test } from "bun:test";

import { recentHistory } from "../src/modelView";
import type { Content } from "../src/orchestrator";

const said = (text: string): Content => ({ role: "user", parts: [{ text }] });
const answered = (text: string): Content => ({ role: "model", parts: [{ text }] });
const called = (name: string): Content => ({ role: "model", parts: [{ functionCall: { name } }] });
const result = (name: string): Content => ({
    role: "user",
    parts: [{ functionResponse: { name, response: {} } }],
});

describe("recentHistory", () => {
    test("keeps a short conversation as it is", () => {
        const history = [said("hi"), answered("Hello.")];
        expect(recentHistory(history, 4)).toEqual(history);
    });

    test("starts at what the resident said, never at a lone tool result", () => {
        const history = [
            said("pothole at 14th and U"),
            called("start_report"),
            result("start_report"),
            answered("Is it in the road?"),
            said("yes"),
            called("draft_report"),
            result("draft_report"),
            answered("Should I send it?"),
        ];

        const recent = recentHistory(history, 5);

        expect(recent[0]).toEqual(said("yes"));
        expect(recent).toHaveLength(4);
    });

    test("drops everything when no turn starts inside the window", () => {
        const history = [said("hi"), called("ping"), result("ping"), called("ping"), result("ping")];
        expect(recentHistory(history, 3)).toEqual([]);
    });
});
