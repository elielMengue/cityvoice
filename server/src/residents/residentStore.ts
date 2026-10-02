import type { CityId } from "../cities/city";
import type { GeoPoint } from "../geo/geo";
import type { ResolvedLocation } from "../geo/locationId";

export interface Resident {
    readonly id: string;
    readonly name: string;
    /** The city the resident lives in, which decides the places and requests they hear about. */
    readonly city: CityId;
    readonly homeAddress: string;
    readonly homePoint: GeoPoint;
}

/** A report being put together over several turns of conversation. Nothing is sent until submit. */
export interface Draft {
    readonly id: string;
    readonly residentId: string;
    readonly location: ResolvedLocation;
    readonly serviceCode: string;
    readonly description: string;
    /** Answers keyed by attribute code, already mapped to option keys. */
    readonly answers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
    /** Set once the report is filed, so a retried submit returns the same request. */
    readonly submittedRequestId?: string;
    /** Set while one call is filing the report, so a parallel call does not file it again. */
    readonly submissionClaimedAt?: string;
}

/** A claim older than this belongs to a call that died; another call may take over. */
export const SUBMISSION_CLAIM_TIMEOUT_MS = 30_000;

export type ReportRole = "author" | "supporter";

/** Links a resident to a request they filed or support. */
export interface MyReport {
    readonly residentId: string;
    readonly requestId: string;
    readonly role: ReportRole;
    readonly createdAt: string;
}

/**
 * Everything CityVoice remembers about a resident. The demo keeps it in
 * memory; production keeps it in one DynamoDB table.
 */
export interface ResidentStore {
    getResident(residentId: string): Promise<Resident | undefined>;
    getDraft(residentId: string, draftId: string): Promise<Draft | undefined>;
    saveDraft(draft: Draft): Promise<void>;
    /**
     * Atomically marks the draft as being submitted. Returns false when it is
     * already submitted, or when another call holds a claim younger than
     * SUBMISSION_CLAIM_TIMEOUT_MS. Backed by a conditional write in a database.
     */
    claimSubmission(residentId: string, draftId: string, now: Date): Promise<boolean>;
    /** Gives the claim back after a failed attempt, so the resident can retry right away. */
    releaseSubmission(residentId: string, draftId: string): Promise<void>;
    /** Returns false, and changes nothing, when the resident is already linked to the request. */
    addReport(report: MyReport): Promise<boolean>;
    getReport(residentId: string, requestId: string): Promise<MyReport | undefined>;
    /** Every report the resident filed or supports, newest link first. Bounded per person, so not paginated. */
    listReports(residentId: string): Promise<readonly MyReport[]>;
}
