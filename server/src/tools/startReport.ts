import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { detectEmergency } from "../catalog/emergency";
import { hasClearWinner, rankServiceTypes } from "../catalog/serviceCatalog";
import { saveDraft } from "../reports/drafts";
import { findNearbyReports, nearbySpeech } from "../reports/nearby";
import { candidatesSpeech, foundPlaceSpeech, PLACE_NOT_FOUND_SPEECH, resolvePlace } from "../reports/place";
import { serviceMatchSpeech } from "../reports/services";
import { describeDraft, draftOutputSchema } from "./draftReport";
import { describePlace, describeService, nearbyReportSchema, placeSchema, serviceSchema } from "./schemas";
import type { Caller, ToolDeps } from "./toolContext";
import { NOT_LINKED_SPEECH, resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const START_REPORT_TOOL = "start_report";

/** What the model should do once it has said the speech. */
const nextStepSchema = z.enum([
    "describe_problem",
    "choose_service",
    "say_place",
    "choose_place",
    "support_or_new_report",
    "answer_question",
    "confirm",
]);

const dataSchema = z.object({
    next_step: nextStepSchema,
    services: z.array(serviceSchema),
    place: placeSchema.optional(),
    candidates: z.array(placeSchema),
    reports: z.array(nearbyReportSchema),
    draft: draftOutputSchema.optional(),
});

const outputSchema = z.object({ speech: z.string(), data: dataSchema });

type StartData = z.infer<typeof dataSchema>;

const WHERE_SPEECH = 'Where is it? You can say an intersection, like 14th and U, or "in front of my house".';

export function registerStartReportTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        START_REPORT_TOOL,
        {
            title: "Start report",
            description:
                "Start here whenever the user reports a problem. In one call it screens for emergencies, finds " +
                "the city service and the place, checks whether neighbors already reported it, and starts a draft. " +
                "Say the speech, then follow next_step: choose_place or choose_service means ask the user and call " +
                "start_report again with their answer; support_or_new_report means call support_report with the " +
                "report's request_id if the user wants to add support, or draft_report with the draft_id for a " +
                "separate report; answer_question means pass the user's answer to draft_report with the draft_id; confirm " +
                "means wait for a clear yes before submit_report. If it returns an error telling the user to call " +
                "911, say only that and do not file anything.",
            inputSchema: z.object({
                problem_description: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe(
                        "What the user said about the problem, word for word and whole, for example " +
                            '"there\'s a huge pothole" or "I called 911, someone is hurt". Do not shorten it: ' +
                            "what the user already did matters.",
                    ),
                spoken_place: z
                    .string()
                    .min(1)
                    .max(200)
                    .nullish()
                    .describe(
                        'The place exactly as the user said it: "14th and U", "1421 Columbia Road", ' +
                            '"in front of my house". Leave out if the user did not say where.',
                    ),
            }),
            outputSchema,
            annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
        },
        async ({ problem_description: description, spoken_place: spokenPlace }) => {
            const emergency = detectEmergency(description);
            if (emergency !== undefined) {
                return toolFailure(emergency);
            }
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }

            const ranked = rankServiceTypes(description);
            const service = hasClearWinner(ranked) ? ranked[0]?.service : undefined;
            const answer = (speech: string, data: Partial<StartData> & Pick<StartData, "next_step">) =>
                toolSuccess({
                    speech,
                    data: {
                        services: ranked.map((match) => describeService(match.service)),
                        candidates: [],
                        reports: [],
                        ...data,
                    },
                });

            if (ranked.length === 0) {
                return answer(serviceMatchSpeech(ranked), { next_step: "describe_problem" });
            }
            if (spokenPlace === undefined || spokenPlace === null) {
                return service === undefined
                    ? answer(serviceMatchSpeech(ranked), { next_step: "choose_service" })
                    : answer(`${serviceMatchSpeech(ranked)} ${WHERE_SPEECH}`, { next_step: "say_place" });
            }

            const outcome = await resolvePlace(deps, caller, spokenPlace);
            if (outcome.kind === "not_linked") {
                return toolFailure(NOT_LINKED_SPEECH);
            }
            if (outcome.kind === "not_found") {
                return toolFailure(PLACE_NOT_FOUND_SPEECH);
            }
            if (outcome.kind === "ambiguous") {
                return answer(candidatesSpeech(outcome.candidates), {
                    next_step: "choose_place",
                    candidates: outcome.candidates.map(describePlace),
                });
            }

            const { location } = outcome;
            const place = describePlace(location);
            const placeSpeech = foundPlaceSpeech(location);
            if (service === undefined) {
                return answer(`${placeSpeech} ${serviceMatchSpeech(ranked)}`, { next_step: "choose_service", place });
            }

            // The draft is started even when neighbors already reported it, so
            // "a separate report" goes straight on with its draft_id.
            const saved = await saveDraft(deps, { residentId: found.resident.id, location, service, description });
            const draft = describeDraft(saved, service);
            const reports = await findNearbyReports(deps, caller, location, service);
            const reportsSpeech = nearbySpeech(reports, service, location);
            if (reports.length > 0) {
                return answer(`${placeSpeech} ${reportsSpeech}`, {
                    next_step: "support_or_new_report",
                    place,
                    reports,
                    draft,
                });
            }

            return answer(`${placeSpeech} ${reportsSpeech} ${saved.speech}`, {
                next_step: draft.ready ? "confirm" : "answer_question",
                place,
                draft,
            });
        },
    );
}
