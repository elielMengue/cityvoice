import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { candidatesSpeech, foundPlaceSpeech, PLACE_NOT_FOUND_SPEECH, resolvePlace } from "../reports/place";
import { describePlace, placeSchema } from "./schemas";
import type { Caller, ToolDeps } from "./toolContext";
import { NOT_LINKED_SPEECH } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const RESOLVE_LOCATION_TOOL = "resolve_location";

const outputSchema = z.object({
    speech: z.string(),
    data: placeSchema.partial().extend({
        confidence: z.number(),
        candidates: z.array(placeSchema),
    }),
});

export function registerResolveLocationTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        RESOLVE_LOCATION_TOOL,
        {
            title: "Resolve location",
            description:
                "Turns the place the user mentions into a confirmed location. start_report already does this; " +
                "use this tool when the user corrects the place or picks one of several candidates. " +
                "Returns a location_id to pass to the other tools. If several places could match, it returns " +
                "up to three candidates and no location_id: read them to the user and call again with their choice.",
            inputSchema: z.object({
                spoken_place: z
                    .string()
                    .min(1)
                    .max(200)
                    .describe(
                        'The place exactly as the user said it: an intersection ("14th and U", "U Street and 14th"), ' +
                            'a street address ("1421 Columbia Road"), or a reference to their home ' +
                            '("my house", "in front of my home", "home", "my building").',
                    ),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        async ({ spoken_place: spokenPlace }) => {
            const outcome = await resolvePlace(deps, caller, spokenPlace);
            switch (outcome.kind) {
                case "not_linked":
                    return toolFailure(NOT_LINKED_SPEECH);
                case "not_found":
                    return toolFailure(PLACE_NOT_FOUND_SPEECH);
                case "ambiguous":
                    return toolSuccess({
                        speech: candidatesSpeech(outcome.candidates),
                        data: { confidence: outcome.confidence, candidates: outcome.candidates.map(describePlace) },
                    });
                case "found":
                    return toolSuccess({
                        speech: foundPlaceSpeech(outcome.location),
                        data: { ...describePlace(outcome.location), confidence: outcome.confidence, candidates: [] },
                    });
            }
        },
    );
}
