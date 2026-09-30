import { describe, expect, test } from "bun:test";

import { BunSqliteDatabase } from "../src/db/bunSqliteDatabase";
import { budgetExhaustedResponse, takeDailyUnit, usesDailyBudget } from "../src/dailyBudget";
import { readMigrations } from "./support/testApp";

function database(): BunSqliteDatabase {
    const db = new BunSqliteDatabase();
    db.migrate(readMigrations());
    return db;
}

const monday = new Date("2026-10-12T09:00:00Z");
const tuesday = new Date("2026-10-13T00:00:01Z");

describe("takeDailyUnit", () => {
    test("allows exactly the limit, then refuses", async () => {
        const db = database();
        const results = [];
        for (let i = 0; i < 4; i += 1) {
            results.push(await takeDailyUnit(db, "oauth", 3, monday));
        }

        expect(results).toEqual([true, true, true, false]);
    });

    test("starts again at midnight UTC", async () => {
        const db = database();
        await takeDailyUnit(db, "oauth", 1, monday);

        expect(await takeDailyUnit(db, "oauth", 1, monday)).toBe(false);
        expect(await takeDailyUnit(db, "oauth", 1, tuesday)).toBe(true);
    });

    test("keeps separate budgets apart", async () => {
        const db = database();
        await takeDailyUnit(db, "oauth", 1, monday);

        expect(await takeDailyUnit(db, "other", 1, monday)).toBe(true);
    });
});

describe("usesDailyBudget", () => {
    test("counts the routes that write to KV, and nothing else", () => {
        const at = (path: string) => new Request(`https://cityvoice.example${path}`);

        expect(usesDailyBudget(at("/authorize?client_id=x"))).toBe(true);
        expect(usesDailyBudget(at("/oauth/token"))).toBe(true);
        expect(usesDailyBudget(at("/mcp"))).toBe(false);
        expect(usesDailyBudget(at("/.well-known/oauth-authorization-server"))).toBe(false);
    });
});

describe("budgetExhaustedResponse", () => {
    test("shows a readable page to a person and an OAuth error to a client", async () => {
        const page = budgetExhaustedResponse(new Request("https://cityvoice.example/authorize"));
        const token = budgetExhaustedResponse(new Request("https://cityvoice.example/oauth/token", { method: "POST" }));

        expect(page.status).toBe(503);
        expect(await page.text()).toContain("try again tomorrow");
        expect(((await token.json()) as { error: string }).error).toBe("temporarily_unavailable");
    });
});
