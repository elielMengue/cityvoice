import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { findServiceType } from "../catalog/serviceCatalog";
import { spokenRequestNumber } from "../speech/speech";
import { EXPIRED_DRAFT_SPEECH, missingAttributes } from "../reports/drafts";
import type { Caller, ToolDeps } from "./toolContext";
import { resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const SUBMIT_REPORT_TOOL = "submit_report";

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        request_id: z.string(),
        service_code: z.string(),
        typical_business_days: z.number(),
        expected_datetime: z.string().optional(),
    }),
});

export function registerSubmitReportTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        SUBMIT_REPORT_TOOL,
        {
            title: "Submit report",
            description:
                "Sends a finished draft to the city. Only call it after reading the draft's readback to the user and " +
                "hearing a clear yes. Set user_confirmed to true only in that case. Calling it again with the same " +
                "draft_id is safe: it returns the same request instead of filing a duplicate.",
            inputSchema: z.object({
                draft_id: z.string().describe("The draft_id returned by draft_report."),
                user_confirmed: z
                    .boolean()
                    .describe("True only if the user explicitly said yes, send it, go ahead or confirm."),
            }),
            outputSchema,
            annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true, destructiveHint: false },
        },
        async ({ draft_id: draftId, user_confirmed: userConfirmed }) => {
            if (userConfirmed !== true) {
                return toolFailure("I haven't sent anything. Just say yes when you want me to send the report.");
            }
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }
            const { resident } = found;

            const draft = await deps.residents.getDraft(resident.id, draftId);
            const service = findServiceType(draft?.serviceCode ?? "");
            if (draft === undefined || service === undefined) {
                return toolFailure(EXPIRED_DRAFT_SPEECH);
            }

            const done = (requestId: string, expectedDatetime?: string) =>
                toolSuccess({
                    speech:
                        `Done. Your request number ends in ${spokenRequestNumber(requestId)}. ` +
                        `The city usually handles ${service.pluralName} within ${service.typicalBusinessDays} business days. ` +
                        "Ask me anytime for an update.",
                    data: {
                        request_id: requestId,
                        service_code: service.code,
                        typical_business_days: service.typicalBusinessDays,
                        ...(expectedDatetime === undefined ? {} : { expected_datetime: expectedDatetime }),
                    },
                });

            // A retry after a lost response must not file the report twice.
            if (draft.submittedRequestId !== undefined) {
                return done(draft.submittedRequestId);
            }
            if (new Date(draft.expiresAt) <= deps.now()) {
                return toolFailure(EXPIRED_DRAFT_SPEECH);
            }
            const [missing] = missingAttributes(service, draft.answers);
            if (missing !== undefined) {
                return toolFailure(`I still need one thing before I can send it. ${missing.question}`);
            }

            // Alexa may retry while the first call is still running. Only the
            // call that holds the claim files the report.
            if (!(await deps.residents.claimSubmission(resident.id, draft.id, deps.now()))) {
                const latest = await deps.residents.getDraft(resident.id, draft.id);
                if (latest?.submittedRequestId !== undefined) {
                    return done(latest.submittedRequestId);
                }
                return toolFailure("I'm sending that report right now. Ask me again in a moment for its number.");
            }

            let created: Awaited<ReturnType<typeof deps.open311.createRequest>>;
            try {
                created = await deps.open311.createRequest({
                    service_code: service.code,
                    lat: draft.location.point.lat,
                    long: draft.location.point.lng,
                    address_string: draft.location.address,
                    description: draft.description,
                    attributes: draft.answers,
                });
            } catch (error) {
                await deps.residents.releaseSubmission(resident.id, draft.id);
                throw error;
            }
            await deps.residents.saveDraft({ ...draft, submittedRequestId: created.service_request_id });
            await deps.residents.addReport({
                residentId: resident.id,
                requestId: created.service_request_id,
                role: "author",
                createdAt: deps.now().toISOString(),
            });
            return done(created.service_request_id, created.expected_datetime);
        },
    );
}
