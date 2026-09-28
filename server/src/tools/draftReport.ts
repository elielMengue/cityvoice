import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ServiceAttribute, ServiceType } from "../catalog/serviceCatalog";
import { findServiceType, matchAttributeAnswer } from "../catalog/serviceCatalog";
import { isInside } from "../geo/geo";
import { decodeLocationId } from "../geo/locationId";
import type { Draft } from "../residents/residentStore";
import { withArticle } from "../speech/speech";
import { describeQuestions, questionSchema } from "./listServiceTypes";
import type { Caller, ToolDeps } from "./toolContext";
import { resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

export const DRAFT_REPORT_TOOL = "draft_report";

export const DRAFT_TTL_MS = 15 * 60 * 1000;

export const EXPIRED_DRAFT_SPEECH =
    "That report timed out before it was sent. Let's start again: what's the problem, and where is it?";

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        draft_id: z.string(),
        ready: z.boolean(),
        readback: z.string(),
        missing_fields: z.array(questionSchema),
        expires_at: z.string(),
    }),
});

export function missingAttributes(service: ServiceType, answers: Readonly<Record<string, string>>): ServiceAttribute[] {
    return service.attributes.filter((attribute) => attribute.required && answers[attribute.code] === undefined);
}

/** The sentence Alexa reads before asking for confirmation. Built from the draft only. */
export function buildReadback(draft: Draft, service: ServiceType): string {
    const answerPhrases = service.attributes.flatMap((attribute) => {
        const answer = draft.answers[attribute.code];
        if (answer === undefined) {
            return [];
        }
        const option = attribute.options?.find((candidate) => candidate.key === answer);
        return [option?.phrase ?? answer];
    });
    const summary = [withArticle(service.name), ...answerPhrases].join(", ");
    const details = draft.description.trim().length > 0 ? ` Details: ${draft.description.trim()}.` : "";
    return `${summary}, at ${draft.location.address}.${details}`;
}

/** Maps each answer to an option key. Answers that fit no option are dropped so the question is asked again. */
function normalizeAnswers(
    service: ServiceType,
    answers: Readonly<Record<string, string>>,
): { readonly accepted: Record<string, string>; readonly rejected: ServiceAttribute[] } {
    const accepted: Record<string, string> = {};
    const rejected: ServiceAttribute[] = [];
    for (const [code, answer] of Object.entries(answers)) {
        const attribute = service.attributes.find((candidate) => candidate.code === code);
        if (attribute === undefined) {
            continue;
        }
        const key = matchAttributeAnswer(attribute, answer);
        if (key === undefined) {
            rejected.push(attribute);
        } else {
            accepted[code] = key;
        }
    }
    return { accepted, rejected };
}

export function registerDraftReportTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        DRAFT_REPORT_TOOL,
        {
            title: "Draft report",
            description:
                "Creates or updates a report draft. It never sends anything to the city. " +
                "Call it after find_nearby_reports when the user wants a new report. If missing_fields is not empty, " +
                "ask the user the first question and call draft_report again with the same draft_id and their answer. " +
                'When the user corrects something ("no, it\'s on 15th Street"), call it again with the draft_id and ' +
                "only the changed field; nothing else is lost. When ready is true, read the readback and ask the user " +
                "to confirm before calling submit_report. Drafts expire after 15 minutes.",
            inputSchema: z.object({
                draft_id: z.string().optional().describe("The draft to update. Leave out to start a new draft."),
                location_id: z
                    .string()
                    .optional()
                    .describe("The location_id from resolve_location. Required for a new draft."),
                service_code: z
                    .string()
                    .optional()
                    .describe("The service_code from list_service_types. Required for a new draft."),
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
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }
            const { resident } = found;
            const now = deps.now();

            let previous: Draft | undefined;
            if (args.draft_id !== undefined) {
                previous = await deps.residents.getDraft(resident.id, args.draft_id);
                if (previous === undefined || new Date(previous.expiresAt) <= now) {
                    return toolFailure(EXPIRED_DRAFT_SPEECH);
                }
                if (previous.submittedRequestId !== undefined) {
                    return toolFailure(
                        "That report was already sent to the city. I can start a new one if something else is wrong.",
                    );
                }
            }

            const location = args.location_id === undefined ? previous?.location : decodeLocationId(args.location_id);
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

            // Answers only carry over when the service stays the same, since
            // each service asks its own questions.
            const carriedAnswers = previous?.serviceCode === service.code ? previous.answers : {};
            const { accepted, rejected } = normalizeAnswers(service, args.answers ?? {});
            const draft: Draft = {
                id: previous?.id ?? deps.newId(),
                residentId: resident.id,
                location,
                serviceCode: service.code,
                description: args.description ?? previous?.description ?? "",
                answers: { ...carriedAnswers, ...accepted },
                expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
            };
            await deps.residents.saveDraft(draft);

            const missing = missingAttributes(service, draft.answers);
            const readback = buildReadback(draft, service);
            const [next] = missing;
            let speech: string;
            if (next === undefined) {
                speech = `Here's your report: ${readback} Should I send it to the city?`;
            } else if (rejected.some((attribute) => attribute.code === next.code)) {
                speech = `Sorry, I didn't catch that. ${next.question}`;
            } else {
                speech = next.question;
            }

            return toolSuccess({
                speech,
                data: {
                    draft_id: draft.id,
                    ready: next === undefined,
                    readback,
                    missing_fields: describeQuestions({ ...service, attributes: missing }),
                    expires_at: draft.expiresAt,
                },
            });
        },
    );
}
