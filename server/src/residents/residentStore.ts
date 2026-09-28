import type { GeoPoint } from "../geo/geo";
import type { ResolvedLocation } from "../geo/locationId";

export interface Resident {
    readonly id: string;
    readonly name: string;
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
}

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
    /** Returns false, and changes nothing, when the resident is already linked to the request. */
    addReport(report: MyReport): Promise<boolean>;
    getReport(residentId: string, requestId: string): Promise<MyReport | undefined>;
}
