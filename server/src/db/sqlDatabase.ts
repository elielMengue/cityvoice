/**
 * The small slice of Cloudflare D1's API that CityVoice uses. D1 satisfies it
 * as it is, and a thin wrapper over bun:sqlite satisfies it in tests. Both
 * run SQLite, so the tests exercise the real SQL.
 */

export type SqlValue = string | number | null;

export interface SqlStatement {
    bind(...values: SqlValue[]): SqlStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase {
    prepare(sql: string): SqlStatement;
    /** Runs every statement in one transaction. */
    batch(statements: SqlStatement[]): Promise<unknown>;
}

/** "?, ?, ?" for an IN clause with the given number of values. */
export function placeholders(count: number): string {
    return Array.from({ length: count }, () => "?").join(", ");
}
