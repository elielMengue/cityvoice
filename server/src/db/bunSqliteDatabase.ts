import { Database } from "bun:sqlite";

import type { SqlDatabase, SqlStatement, SqlValue } from "./sqlDatabase";

class BunStatement implements SqlStatement {
    constructor(
        private readonly db: Database,
        private readonly sql: string,
        private readonly values: SqlValue[] = [],
    ) {}

    bind(...values: SqlValue[]): SqlStatement {
        return new BunStatement(this.db, this.sql, values);
    }

    async first<T>(): Promise<T | null> {
        return (this.db.query(this.sql).get(...this.values) as T | undefined) ?? null;
    }

    async all<T>(): Promise<{ results: T[] }> {
        return { results: this.db.query(this.sql).all(...this.values) as T[] };
    }

    async run(): Promise<{ meta: { changes: number } }> {
        return { meta: { changes: this.db.query(this.sql).run(...this.values).changes } };
    }

    runNow(): void {
        this.db.query(this.sql).run(...this.values);
    }
}

/**
 * SQLite through bun:sqlite, shaped like D1. Used by the tests and by the
 * local Bun server, so both run the same SQL as production.
 */
export class BunSqliteDatabase implements SqlDatabase {
    readonly db: Database;

    constructor(path = ":memory:") {
        this.db = new Database(path, { strict: true });
        this.db.exec("PRAGMA journal_mode = WAL;");
    }

    /** Applies the migration files in order. */
    migrate(migrations: readonly string[]): void {
        for (const sql of migrations) {
            this.db.exec(sql);
        }
    }

    prepare(sql: string): SqlStatement {
        return new BunStatement(this.db, sql);
    }

    async batch(statements: SqlStatement[]): Promise<unknown> {
        this.db.transaction(() => {
            for (const statement of statements) {
                (statement as BunStatement).runNow();
            }
        })();
        return [];
    }
}
