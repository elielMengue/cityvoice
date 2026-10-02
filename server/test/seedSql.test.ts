import { describe, expect, test } from "bun:test";

import { BunSqliteDatabase } from "../src/db/bunSqliteDatabase";
import { renderSql, seedStatements } from "../src/db/seedStatements";
import { buildDemoSeed, FIRST_DEMO_REQUEST_NUMBER } from "../src/demo/dcDemo";
import { SqlSandboxOpen311 } from "../src/open311/sqlSandboxOpen311";
import { readMigrations, TEST_NOW } from "./support/testApp";

describe("the SQL seed script", () => {
    test("rebuilds exactly the demo seed when run as plain SQL", async () => {
        const seed = buildDemoSeed(TEST_NOW);
        const db = new BunSqliteDatabase();
        db.migrate(readMigrations());

        db.db.exec(renderSql(seedStatements(seed, FIRST_DEMO_REQUEST_NUMBER)));

        const sandbox = new SqlSandboxOpen311(db, { now: () => TEST_NOW, formatRequestId: String });
        const stored = await sandbox.getRequests(seed.requests.map((request) => request.service_request_id));
        expect(stored).toEqual(seed.requests);
        expect(db.db.query("SELECT COUNT(*) AS n FROM residents").get()).toEqual({ n: seed.residents.length });
        expect(db.db.query("SELECT COUNT(*) AS n FROM my_reports").get()).toEqual({ n: 3 });
    });

    test("can be run twice, so the demo can be reset between takes", () => {
        const db = new BunSqliteDatabase();
        db.migrate(readMigrations());
        const script = renderSql(seedStatements(buildDemoSeed(TEST_NOW), FIRST_DEMO_REQUEST_NUMBER));

        db.db.exec(script);
        db.db.exec(script);

        expect(db.db.query("SELECT COUNT(*) AS n FROM service_requests").get()).toEqual({ n: 40 });
    });

    test("escapes quotes and refuses mismatched values", () => {
        expect(renderSql([{ sql: "SELECT ?, ?, ?", values: ["O'Brien", 1.5, null] }])).toBe(
            "SELECT 'O''Brien', 1.5, NULL;",
        );
        expect(() => renderSql([{ sql: "SELECT ?, ?", values: ["one"] }])).toThrow();
        expect(() => renderSql([{ sql: "SELECT ?", values: ["one", "two"] }])).toThrow();
    });
});
