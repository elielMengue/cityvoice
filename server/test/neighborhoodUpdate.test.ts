import { describe, expect, test } from "bun:test";

import { NEIGHBORHOOD_UPDATE_QUESTION } from "../src/prompts/neighborhoodUpdate";
import { createTestApp } from "./support/testApp";

describe("neighborhood_update", () => {
    test("asks the resident's question in their words", async () => {
        const app = createTestApp();

        const { result } = await app.rpc("prompts/get", { name: "neighborhood_update" });

        expect(result?.["messages"]).toEqual([
            { role: "user", content: { type: "text", text: NEIGHBORHOOD_UPDATE_QUESTION } },
        ]);
    });

    test("is answered by the map, with what changed this week", async () => {
        const app = createTestApp();

        const outcome = await app.callTool("show_report_map", { recent_days: 7 }, "aisha");

        expect(outcome.speech).toBe(
            "This week around your home, two reports were filed: " +
                "a missed trash pickup report and a streetlight out report.",
        );
    });

    test("counts what was fixed, not only what was filed", async () => {
        const app = createTestApp();

        const outcome = await app.callTool(
            "show_report_map",
            { recent_days: 7, spoken_place: "1100 11th Street Northwest" },
            "aisha",
        );

        expect(outcome.speech).toEndWith("One report was fixed: a graffiti report.");
    });
});
