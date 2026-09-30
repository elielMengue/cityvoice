import { findServiceType } from "../catalog/serviceCatalog";
import type { SqlDatabase, SqlValue } from "../db/sqlDatabase";
import { placeholders } from "../db/sqlDatabase";
import { addBusinessDays } from "./sandboxOpen311";
import type {
    CreatedServiceRequest,
    NewServiceRequest,
    Open311Client,
    ServiceRequest,
    ServiceRequestQuery,
} from "./types";

export const REQUEST_COUNTER = "service_request";

interface ServiceRequestRow {
    service_request_id: string;
    status: "open" | "closed";
    status_notes: string | null;
    service_name: string;
    service_code: string;
    description: string | null;
    requested_datetime: string;
    updated_datetime: string | null;
    expected_datetime: string | null;
    address: string | null;
    lat: number;
    long: number;
    supporters: number;
}

/** Drops SQL NULLs so the objects look exactly like the in-memory sandbox's. */
export function toServiceRequest(row: ServiceRequestRow): ServiceRequest {
    return {
        service_request_id: row.service_request_id,
        status: row.status,
        service_name: row.service_name,
        service_code: row.service_code,
        requested_datetime: row.requested_datetime,
        lat: row.lat,
        long: row.long,
        supporters: row.supporters,
        ...(row.status_notes === null ? {} : { status_notes: row.status_notes }),
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.updated_datetime === null ? {} : { updated_datetime: row.updated_datetime }),
        ...(row.expected_datetime === null ? {} : { expected_datetime: row.expected_datetime }),
        ...(row.address === null ? {} : { address: row.address }),
    };
}

export interface SqlSandboxOptions {
    readonly now: () => Date;
    /** Turns the counter value into a request number, for example 484821 into "26-00484821". */
    readonly formatRequestId: (sequence: number) => string;
}

/**
 * The Open311 sandbox stored in SQLite, so every Worker instance sees the
 * same reports. Like the in-memory sandbox, it never reaches a real city.
 */
export class SqlSandboxOpen311 implements Open311Client {
    constructor(
        private readonly db: SqlDatabase,
        private readonly options: SqlSandboxOptions,
    ) {}

    async findRequests(query: ServiceRequestQuery): Promise<readonly ServiceRequest[]> {
        const conditions: string[] = [];
        const values: SqlValue[] = [];
        if (query.service_code !== undefined) {
            conditions.push("service_code = ?");
            values.push(query.service_code);
        }
        if (query.status !== undefined) {
            conditions.push("status = ?");
            values.push(query.status);
        }
        const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
        const { results } = await this.db
            .prepare(`SELECT * FROM service_requests ${where} ORDER BY service_request_id`)
            .bind(...values)
            .all<ServiceRequestRow>();
        return results.map(toServiceRequest);
    }

    async getRequests(ids: readonly string[]): Promise<readonly ServiceRequest[]> {
        if (ids.length === 0) {
            return [];
        }
        const { results } = await this.db
            .prepare(`SELECT * FROM service_requests WHERE service_request_id IN (${placeholders(ids.length)})`)
            .bind(...ids)
            .all<ServiceRequestRow>();
        const byId = new Map(results.map((row) => [row.service_request_id, toServiceRequest(row)]));
        return ids.flatMap((id) => {
            const request = byId.get(id);
            return request === undefined ? [] : [request];
        });
    }

    async createRequest(request: NewServiceRequest): Promise<CreatedServiceRequest> {
        const service = findServiceType(request.service_code);
        if (service === undefined) {
            throw new Error(`Unknown service code ${request.service_code}`);
        }
        const counter = await this.db
            .prepare("UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value")
            .bind(REQUEST_COUNTER)
            .first<{ value: number }>();
        if (counter === null) {
            throw new Error(`Counter ${REQUEST_COUNTER} is missing; seed the database first`);
        }
        // The counter holds the last number handed out, so the next one is value.
        const id = this.options.formatRequestId(counter.value);
        const now = this.options.now();
        const expected = addBusinessDays(now, service.typicalBusinessDays).toISOString();
        await this.db
            .prepare(
                `INSERT INTO service_requests (service_request_id, status, service_name, service_code, description,
                    requested_datetime, updated_datetime, expected_datetime, address, lat, long, supporters)
                 VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            )
            .bind(
                id,
                service.name,
                service.code,
                request.description,
                now.toISOString(),
                now.toISOString(),
                expected,
                request.address_string,
                request.lat,
                request.long,
            )
            .run();
        return { service_request_id: id, expected_datetime: expected };
    }

    async addSupporter(serviceRequestId: string): Promise<number> {
        const row = await this.db
            .prepare(
                "UPDATE service_requests SET supporters = supporters + 1 WHERE service_request_id = ? RETURNING supporters",
            )
            .bind(serviceRequestId)
            .first<{ supporters: number }>();
        if (row === null) {
            throw new Error(`Unknown service request ${serviceRequestId}`);
        }
        return row.supporters;
    }
}
