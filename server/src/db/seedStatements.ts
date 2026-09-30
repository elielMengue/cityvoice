import type { DemoSeed } from "../demo/dcDemo";
import { REQUEST_COUNTER } from "../open311/sqlSandboxOpen311";
import type { SqlValue } from "./sqlDatabase";

export interface RawStatement {
    readonly sql: string;
    readonly values: readonly SqlValue[];
}

/**
 * Every statement needed to reset the database to the demo seed: empty the
 * tables, then insert residents, reports and links. The counter is set so the
 * first report filed gets `firstRequestNumber`.
 */
export function seedStatements(seed: DemoSeed, firstRequestNumber: number): RawStatement[] {
    const statements: RawStatement[] = ["drafts", "my_reports", "service_requests", "residents", "counters"].map(
        (table) => ({ sql: `DELETE FROM ${table}`, values: [] }),
    );

    for (const resident of seed.residents) {
        statements.push({
            sql: "INSERT INTO residents (id, name, home_address, home_lat, home_lng) VALUES (?, ?, ?, ?, ?)",
            values: [resident.id, resident.name, resident.homeAddress, resident.homePoint.lat, resident.homePoint.lng],
        });
    }

    for (const request of seed.requests) {
        statements.push({
            sql: `INSERT INTO service_requests (service_request_id, status, status_notes, service_name, service_code,
                    description, requested_datetime, updated_datetime, expected_datetime, address, lat, long, supporters)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            values: [
                request.service_request_id,
                request.status,
                request.status_notes ?? null,
                request.service_name,
                request.service_code,
                request.description ?? null,
                request.requested_datetime,
                request.updated_datetime ?? null,
                request.expected_datetime ?? null,
                request.address ?? null,
                request.lat,
                request.long,
                request.supporters,
            ],
        });
    }

    for (const report of seed.myReports) {
        statements.push({
            sql: "INSERT INTO my_reports (resident_id, request_id, role, created_at) VALUES (?, ?, ?, ?)",
            values: [report.residentId, report.requestId, report.role, report.createdAt],
        });
    }

    statements.push({
        sql: "INSERT INTO counters (name, value) VALUES (?, ?)",
        values: [REQUEST_COUNTER, firstRequestNumber - 1],
    });
    return statements;
}

function literal(value: SqlValue): string {
    if (value === null) {
        return "NULL";
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`Cannot write ${value} as SQL`);
        }
        return String(value);
    }
    return `'${value.replaceAll("'", "''")}'`;
}

/** Renders statements as a plain SQL script, for `wrangler d1 execute --file`. */
export function renderSql(statements: readonly RawStatement[]): string {
    return statements
        .map(({ sql, values }) => {
            let index = 0;
            const rendered = sql.replace(/\?/g, () => {
                const value = values[index];
                index += 1;
                if (value === undefined) {
                    throw new Error(`Missing value for placeholder ${index} in: ${sql}`);
                }
                return literal(value);
            });
            if (index !== values.length) {
                throw new Error(`Expected ${index} values, got ${values.length} in: ${sql}`);
            }
            return `${rendered.replace(/\s+/g, " ").trim()};`;
        })
        .join("\n");
}
