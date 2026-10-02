import { z } from "zod";

import { CITY_IDS } from "../cities/city";
import type { SqlDatabase } from "../db/sqlDatabase";
import type { ResolvedLocation } from "../geo/locationId";
import type { Draft, MyReport, Resident, ResidentStore } from "./residentStore";
import { SUBMISSION_CLAIM_TIMEOUT_MS } from "./residentStore";

/** Expired drafts are kept a day for troubleshooting, then removed. */
const DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

interface ResidentRow {
    id: string;
    name: string;
    home_address: string;
    home_lat: number;
    home_lng: number;
    city: string;
}

interface DraftRow {
    id: string;
    resident_id: string;
    location_json: string;
    service_code: string;
    description: string;
    answers_json: string;
    expires_at: string;
    submitted_request_id: string | null;
    submission_claimed_at: string | null;
}

interface ReportRow {
    resident_id: string;
    request_id: string;
    role: "author" | "supporter";
    created_at: string;
}

// Rows are read back through a schema: a bad row fails loudly here instead
// of reaching a resident as nonsense.
const locationSchema = z.object({
    address: z.string(),
    point: z.object({ lat: z.number(), lng: z.number() }),
    isHome: z.boolean(),
});
const answersSchema = z.record(z.string(), z.string());

function toDraft(row: DraftRow): Draft {
    const location: ResolvedLocation = locationSchema.parse(JSON.parse(row.location_json));
    return {
        id: row.id,
        residentId: row.resident_id,
        location,
        serviceCode: row.service_code,
        description: row.description,
        answers: answersSchema.parse(JSON.parse(row.answers_json)),
        expiresAt: row.expires_at,
        ...(row.submitted_request_id === null ? {} : { submittedRequestId: row.submitted_request_id }),
        ...(row.submission_claimed_at === null ? {} : { submissionClaimedAt: row.submission_claimed_at }),
    };
}

function toReport(row: ReportRow): MyReport {
    return { residentId: row.resident_id, requestId: row.request_id, role: row.role, createdAt: row.created_at };
}

/** Resident data in SQLite, on Cloudflare D1 in production. */
export class SqlResidentStore implements ResidentStore {
    constructor(private readonly db: SqlDatabase) {}

    async getResident(residentId: string): Promise<Resident | undefined> {
        const row = await this.db.prepare("SELECT * FROM residents WHERE id = ?").bind(residentId).first<ResidentRow>();
        return row === null
            ? undefined
            : {
                  id: row.id,
                  name: row.name,
                  // A city this build does not know falls back to the pilot rather than failing.
                  city: CITY_IDS.find((id) => id === row.city) ?? "washington-dc",
                  homeAddress: row.home_address,
                  homePoint: { lat: row.home_lat, lng: row.home_lng },
              };
    }

    async getDraft(residentId: string, draftId: string): Promise<Draft | undefined> {
        const row = await this.db
            .prepare("SELECT * FROM drafts WHERE id = ? AND resident_id = ?")
            .bind(draftId, residentId)
            .first<DraftRow>();
        return row === null ? undefined : toDraft(row);
    }

    async saveDraft(draft: Draft): Promise<void> {
        const cutoff = new Date(new Date(draft.expiresAt).getTime() - DRAFT_RETENTION_MS).toISOString();
        await this.db.batch([
            this.db
                .prepare(
                    `INSERT INTO drafts (id, resident_id, location_json, service_code, description, answers_json,
                        expires_at, submitted_request_id, submission_claimed_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (id) DO UPDATE SET
                        location_json = excluded.location_json,
                        service_code = excluded.service_code,
                        description = excluded.description,
                        answers_json = excluded.answers_json,
                        expires_at = excluded.expires_at,
                        submitted_request_id = excluded.submitted_request_id,
                        submission_claimed_at = excluded.submission_claimed_at
                     WHERE drafts.resident_id = excluded.resident_id`,
                )
                .bind(
                    draft.id,
                    draft.residentId,
                    JSON.stringify(draft.location),
                    draft.serviceCode,
                    draft.description,
                    JSON.stringify(draft.answers),
                    draft.expiresAt,
                    draft.submittedRequestId ?? null,
                    draft.submissionClaimedAt ?? null,
                ),
            // Housekeeping rides along with writes, so no scheduled job is needed.
            this.db.prepare("DELETE FROM drafts WHERE expires_at < ?").bind(cutoff),
        ]);
    }

    async claimSubmission(residentId: string, draftId: string, now: Date): Promise<boolean> {
        const staleBefore = new Date(now.getTime() - SUBMISSION_CLAIM_TIMEOUT_MS).toISOString();
        const result = await this.db
            .prepare(
                `UPDATE drafts SET submission_claimed_at = ?
                 WHERE id = ? AND resident_id = ? AND submitted_request_id IS NULL
                   AND (submission_claimed_at IS NULL OR submission_claimed_at <= ?)`,
            )
            .bind(now.toISOString(), draftId, residentId, staleBefore)
            .run();
        return result.meta.changes === 1;
    }

    async releaseSubmission(residentId: string, draftId: string): Promise<void> {
        await this.db
            .prepare("UPDATE drafts SET submission_claimed_at = NULL WHERE id = ? AND resident_id = ?")
            .bind(draftId, residentId)
            .run();
    }

    async addReport(report: MyReport): Promise<boolean> {
        const result = await this.db
            .prepare(
                `INSERT INTO my_reports (resident_id, request_id, role, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT DO NOTHING`,
            )
            .bind(report.residentId, report.requestId, report.role, report.createdAt)
            .run();
        return result.meta.changes === 1;
    }

    async getReport(residentId: string, requestId: string): Promise<MyReport | undefined> {
        const row = await this.db
            .prepare("SELECT * FROM my_reports WHERE resident_id = ? AND request_id = ?")
            .bind(residentId, requestId)
            .first<ReportRow>();
        return row === null ? undefined : toReport(row);
    }

    async listReports(residentId: string): Promise<readonly MyReport[]> {
        const { results } = await this.db
            .prepare("SELECT * FROM my_reports WHERE resident_id = ? ORDER BY created_at DESC, request_id ASC")
            .bind(residentId)
            .all<ReportRow>();
        return results.map(toReport);
    }
}
