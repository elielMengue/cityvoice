import type { Draft, MyReport, Resident, ResidentStore } from "./residentStore";
import { SUBMISSION_CLAIM_TIMEOUT_MS } from "./residentStore";

export class MemoryResidentStore implements ResidentStore {
    private readonly residents = new Map<string, Resident>();
    private readonly drafts = new Map<string, Draft>();
    private readonly reports = new Map<string, MyReport>();

    constructor(residents: readonly Resident[], reports: readonly MyReport[] = []) {
        for (const resident of residents) {
            this.residents.set(resident.id, resident);
        }
        for (const report of reports) {
            this.reports.set(reportKey(report.residentId, report.requestId), report);
        }
    }

    async getResident(residentId: string): Promise<Resident | undefined> {
        return this.residents.get(residentId);
    }

    async getDraft(residentId: string, draftId: string): Promise<Draft | undefined> {
        const draft = this.drafts.get(draftId);
        return draft?.residentId === residentId ? draft : undefined;
    }

    async saveDraft(draft: Draft): Promise<void> {
        this.drafts.set(draft.id, draft);
    }

    async claimSubmission(residentId: string, draftId: string, now: Date): Promise<boolean> {
        // No await between the check and the write, so on one thread this is atomic.
        const draft = this.drafts.get(draftId);
        if (draft?.residentId !== residentId || draft.submittedRequestId !== undefined) {
            return false;
        }
        const claimedAt = draft.submissionClaimedAt === undefined ? undefined : new Date(draft.submissionClaimedAt);
        if (claimedAt !== undefined && now.getTime() - claimedAt.getTime() < SUBMISSION_CLAIM_TIMEOUT_MS) {
            return false;
        }
        this.drafts.set(draftId, { ...draft, submissionClaimedAt: now.toISOString() });
        return true;
    }

    async releaseSubmission(residentId: string, draftId: string): Promise<void> {
        const draft = this.drafts.get(draftId);
        if (draft?.residentId === residentId) {
            this.drafts.set(draftId, { ...draft, submissionClaimedAt: undefined });
        }
    }

    async addReport(report: MyReport): Promise<boolean> {
        const key = reportKey(report.residentId, report.requestId);
        if (this.reports.has(key)) {
            return false;
        }
        this.reports.set(key, report);
        return true;
    }

    async getReport(residentId: string, requestId: string): Promise<MyReport | undefined> {
        return this.reports.get(reportKey(residentId, requestId));
    }
}

function reportKey(residentId: string, requestId: string): string {
    return `${residentId}#${requestId}`;
}
