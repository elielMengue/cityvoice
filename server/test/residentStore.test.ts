import { describe, expect, test } from "bun:test";

import { MemoryResidentStore } from "../src/residents/memoryResidentStore";
import type { Draft } from "../src/residents/residentStore";
import { SUBMISSION_CLAIM_TIMEOUT_MS } from "../src/residents/residentStore";

const now = new Date("2026-10-15T14:00:00Z");
const later = (milliseconds: number) => new Date(now.getTime() + milliseconds);

const draft: Draft = {
    id: "draft-1",
    residentId: "daniel",
    location: {
        address: "14th Street and U Street Northwest",
        point: { lat: 38.91705, lng: -77.03196 },
        isHome: false,
    },
    serviceCode: "POTHOLE",
    description: "",
    answers: { position: "road" },
    expiresAt: later(15 * 60 * 1000).toISOString(),
};

async function storeWithDraft(): Promise<MemoryResidentStore> {
    const store = new MemoryResidentStore([]);
    await store.saveDraft(draft);
    return store;
}

describe("submission claims", () => {
    test("only one caller gets the claim", async () => {
        const store = await storeWithDraft();

        expect(await store.claimSubmission("daniel", "draft-1", now)).toBe(true);
        expect(await store.claimSubmission("daniel", "draft-1", later(1000))).toBe(false);
    });

    test("a claim left by a call that died can be taken over", async () => {
        const store = await storeWithDraft();
        await store.claimSubmission("daniel", "draft-1", now);

        expect(await store.claimSubmission("daniel", "draft-1", later(SUBMISSION_CLAIM_TIMEOUT_MS))).toBe(true);
    });

    test("a released claim can be taken again at once", async () => {
        const store = await storeWithDraft();
        await store.claimSubmission("daniel", "draft-1", now);
        await store.releaseSubmission("daniel", "draft-1");

        expect(await store.claimSubmission("daniel", "draft-1", later(1000))).toBe(true);
    });

    test("a submitted draft is never claimed again", async () => {
        const store = await storeWithDraft();
        await store.saveDraft({ ...draft, submittedRequestId: "26-00484821" });

        expect(await store.claimSubmission("daniel", "draft-1", later(SUBMISSION_CLAIM_TIMEOUT_MS * 2))).toBe(false);
    });

    test("nobody can claim another resident's draft", async () => {
        const store = await storeWithDraft();

        expect(await store.claimSubmission("maria", "draft-1", now)).toBe(false);
    });
});

describe("report links", () => {
    test("a resident is linked to a report once", async () => {
        const store = new MemoryResidentStore([]);
        const link = { residentId: "maria", requestId: "26-00481907", role: "supporter" as const, createdAt: "" };

        expect(await store.addReport(link)).toBe(true);
        expect(await store.addReport(link)).toBe(false);
    });
});
