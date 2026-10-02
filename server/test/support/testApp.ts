import { expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createDemoAuthenticator, DEMO_RESIDENT_HEADER } from "../../src/auth/authenticator";
import { BunSqliteDatabase } from "../../src/db/bunSqliteDatabase";
import { seedStatements } from "../../src/db/seedStatements";
import { ALL_RESIDENTS } from "../../src/cities/cities";
import { buildDemoSeed, FIRST_DEMO_REQUEST_NUMBER } from "../../src/demo/dcDemo";
import { createDemoDeps, createSqlDemoDeps } from "../../src/demo/demoDeps";
import { createFetchHandler, MCP_PATH } from "../../src/httpServer";
import { SILENT_LOGGER } from "../../src/logger";
import type { ToolDeps } from "../../src/tools/toolContext";

/** Alexa+ speaks this revision of the spec, so every test uses it. */
export const ALEXA_PROTOCOL_VERSION = "2025-11-25";

/** A Thursday afternoon in Washington DC. Fixed so ages and expiry are predictable. */
export const TEST_NOW = new Date("2026-10-15T14:00:00Z");

export interface JsonRpcResponse {
    readonly jsonrpc: "2.0";
    readonly id: number;
    readonly result?: Record<string, unknown>;
    readonly error?: { readonly code: number; readonly message: string };
}

export interface ToolOutcome {
    readonly isError: boolean;
    readonly speech: string;
    readonly data: Record<string, unknown>;
}

/**
 * A 2025-era call may be answered as plain JSON or as an SSE stream. Both are
 * valid, so the harness reads either and returns the one JSON-RPC message.
 */
export async function readJsonRpcResult(response: Response): Promise<JsonRpcResponse> {
    const body = await response.text();
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
        return JSON.parse(body) as JsonRpcResponse;
    }
    const dataLine = body.split("\n").find((line) => line.startsWith("data: {"));
    if (dataLine === undefined) {
        throw new Error(`No JSON-RPC message in stream: ${body}`);
    }
    return JSON.parse(dataLine.slice("data: ".length)) as JsonRpcResponse;
}

export interface TestApp {
    readonly deps: ToolDeps;
    readonly handle: (request: Request) => Promise<Response>;
    /** Moves the fixed clock forward. */
    advance(milliseconds: number): void;
    rpc(method: string, params?: Record<string, unknown>, resident?: string): Promise<JsonRpcResponse>;
    callTool(name: string, args: Record<string, unknown>, resident?: string): Promise<ToolOutcome>;
    /** Every sentence the server has said so far, for the speech rules test. */
    readonly spoken: string[];
    /** The database behind the SQL backend, for tests that write to it directly. */
    readonly db: BunSqliteDatabase | undefined;
}

/**
 * Where resident data and the sandbox live. The scenarios run against both,
 * so the SQL adapters that D1 uses in production pass the same tests as the
 * in-memory ones.
 */
export type TestBackend = "memory" | "sql";
export const TEST_BACKENDS: readonly TestBackend[] = ["memory", "sql"];

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "migrations");

/** Every migration, in the order wrangler applies them. */
export function readMigrations(): string[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith(".sql"))
        .sort()
        .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

/** A fresh SQLite database with the real migrations and the demo seed. */
export function createSeededDatabase(now: Date): BunSqliteDatabase {
    const db = new BunSqliteDatabase();
    db.migrate(readMigrations());
    const statements = seedStatements(buildDemoSeed(now), FIRST_DEMO_REQUEST_NUMBER);
    // bun:sqlite runs the batch synchronously, so the seed is in place on return.
    void db.batch(statements.map(({ sql, values }) => db.prepare(sql).bind(...values)));
    return db;
}

export function createTestApp(backend: TestBackend = "memory"): TestApp {
    let now = TEST_NOW.getTime();
    let draftCounter = 0;
    const clock = () => new Date(now);
    const newId = () => {
        draftCounter += 1;
        return `draft-${draftCounter}`;
    };
    const db = backend === "sql" ? createSeededDatabase(TEST_NOW) : undefined;
    const deps = db === undefined ? createDemoDeps(clock, newId) : createSqlDemoDeps(db, clock, newId);
    const handle = createFetchHandler({
        logger: SILENT_LOGGER,
        tools: deps,
        authenticate: createDemoAuthenticator(ALL_RESIDENTS.map((resident) => resident.id)),
    });
    const spoken: string[] = [];

    const rpc = async (method: string, params: Record<string, unknown> = {}, resident?: string) => {
        const headers: Record<string, string> = {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": ALEXA_PROTOCOL_VERSION,
        };
        if (resident !== undefined) {
            headers[DEMO_RESIDENT_HEADER] = resident;
        }
        const response = await handle(
            new Request(`http://localhost${MCP_PATH}`, {
                method: "POST",
                headers,
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            }),
        );
        expect(response.status).toBe(200);
        return readJsonRpcResult(response);
    };

    return {
        deps,
        db,
        handle,
        spoken,
        advance: (milliseconds) => {
            now += milliseconds;
        },
        rpc,
        callTool: async (name, args, resident) => {
            const { result, error } = await rpc("tools/call", { name, arguments: args }, resident);
            if (error !== undefined || result === undefined) {
                throw new Error(`tools/call ${name} failed: ${JSON.stringify(error)}`);
            }
            const content = result["content"] as { type: string; text: string }[];
            const speech = content[0]?.text ?? "";
            spoken.push(speech);
            const structured = result["structuredContent"] as { data?: Record<string, unknown> } | undefined;
            return { isError: result["isError"] === true, speech, data: structured?.data ?? {} };
        },
    };
}
