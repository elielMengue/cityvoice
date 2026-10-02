import { describe, expect, test } from "bun:test";

import { ageInWords, countOf, joinWithAnd, spokenRequestNumber, withArticle } from "../src/speech/speech";

describe("speech helpers", () => {
    test("request numbers keep the last four digits, read one by one", () => {
        expect(spokenRequestNumber("26-00484821")).toBe("4 8 2 1");
    });

    test("small counts are spelled out", () => {
        expect(countOf(1, "neighbor")).toBe("one neighbor");
        expect(countOf(3, "neighbor")).toBe("three neighbors");
        expect(countOf(12, "neighbor")).toBe("12 neighbors");
    });

    test("lists read naturally", () => {
        expect(joinWithAnd(["A"])).toBe("A");
        expect(joinWithAnd(["A", "B"], "or")).toBe("A or B");
        expect(joinWithAnd(["A", "B", "C"])).toBe("A, B, and C");
    });

    test("articles follow the sound of the noun", () => {
        expect(withArticle("pothole")).toBe("a pothole");
        expect(withArticle("abandoned vehicle")).toBe("an abandoned vehicle");
    });

    test("things that are not counted take no article", () => {
        expect(withArticle("graffiti")).toBe("graffiti");
        expect(withArticle("graffiti report")).toBe("a graffiti report");
        expect(withArticle("illegal dumping report")).toBe("an illegal dumping report");
    });

    test("ages are rounded the way people talk", () => {
        const now = new Date("2026-10-15T14:00:00Z");
        const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        expect(ageInWords(daysAgo(0), now)).toBe("today");
        expect(ageInWords(daysAgo(1), now)).toBe("yesterday");
        expect(ageInWords(daysAgo(4), now)).toBe("4 days ago");
        expect(ageInWords(daysAgo(20), now)).toBe("2 weeks ago");
    });
});
