import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ServiceType } from "../catalog/serviceCatalog";
import { findServiceType } from "../catalog/serviceCatalog";
import { isInside } from "../geo/geo";
import { decodeLocationId } from "../geo/locationId";
import type { Draft } from "../residents/residentStore";
import type { SavedDraft } from "../reports/drafts";
import { EXPIRED_DRAFT_SPEECH, saveDraft } from "../reports/drafts";
import { describeQuestions, questionSchema } from "./schemas";
import type { Caller, ToolDeps } from "./toolContext";
import { resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const DRAFT_REPORT_TOOL = "draft_report";

export const draftOutputSchema = z.object({
    draft_id: z.string(),
    ready: z.boolean(),
    readback: z.string(),
    missing_fields: z.array(questionSchema),
    expires_at: z.string(),
});

const outputSchema = z.object({ speech: z.string(), data: draftOutputSchema });

export function describeDraft(saved: SavedDraft, service: ServiceType): z.infer<typeof draftOutputSchema> {
    return {
        draft_id: saved.draft.id,
        ready: saved.missing.length === 0,
        readback: saved.readback,
        missing_fields: describeQuestions({ ...service, attributes: [...saved.missing] }),
        expires_at: saved.draft.expiresAt,
    };
}

export function registerDraftReportTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        DRAFT_REPORT_TOOL,
        {
            title: "Draft report",
            description:
                "Updates a report draft, or starts one. It never sends anything to the city. " +
                "start_report usually starts the draft; call this tool with its draft_id to pass on the user's " +
                "answers. If missing_fields is not empty, ask the first question and call again with the answer. " +
                'When the user corrects something ("no, it\'s on 15th Street"), call it with the draft_id and only ' +
                "the changed field; nothing else is lost. When ready is true, read the readback and ask the user " +
                "to confirm before calling submit_report. Drafts expire after 15 minutes.",
            inputSchema: z.object({
                draft_id: z.string().optional().describe("The draft to update. Leave out to start a new draft."),
                location_id: z.string().optional().describe("The location_id. Required for a new draft."),
                service_code: z.string().optional().describe("The service_code. Required for a new draft."),
                description: z
                    .string()
                    .max(500)
                    .optional()
                    .describe('Extra details in the user\'s words, for example "huge, in the right lane".'),
                answers: z
                    .record(z.string(), z.string().max(200))
                    .optional()
                    .describe(
                        "Answers to the questions, keyed by question code, in the user's words. " +
                            'For example {"position": "in the road"} or {"condition": "it\'s flickering"}.',
                    ),
            }),
            outputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
        },
        async (args) => {
            const draftId = args.draft_id;
            const locationId = args.location_id;
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }
            const { resident } = found;

            let previous: Draft | undefined;
            if (draftId !== undefined) {
                previous = await deps.residents.getDraft(resident.id, draftId);
                if (previous === undefined || new Date(previous.expiresAt) <= deps.now()) {
                    return toolFailure(EXPIRED_DRAFT_SPEECH);
                }
                if (previous.submittedRequestId !== undefined) {
                    return toolFailure(
                        "That report was already sent to the city. I can start a new one if something else is wrong.",
                    );
                }
            }

            const location = locationId === undefined ? previous?.location : decodeLocationId(locationId);
            if (location === undefined) {
                return toolFailure(
                    "I need to know where the problem is. What's the address or the nearest intersection?",
                );
            }
            if (!isInside(location.point, deps.serviceArea)) {
                return toolFailure("CityVoice doesn't cover that area yet, so I can't file a report there.");
            }
            const service = findServiceType(args.service_code ?? previous?.serviceCode ?? "");
            if (service === undefined) {
                return toolFailure("I'm not sure which kind of problem this is. Could you describe it again?");
            }

            const saved = await saveDraft(deps, {
                residentId: resident.id,
                previous,
                location,
                service,
                description: args.description,
                answers: args.answers,
            });
            return toolSuccess({ speech: saved.speech, data: describeDraft(saved, service) });
        },
    );
}
