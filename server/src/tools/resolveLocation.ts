import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { isInside } from "../geo/geo";
import type { ResolvedLocation } from "../geo/locationId";
import { encodeLocationId } from "../geo/locationId";
import { joinWithAnd } from "../speech/speech";
import type { Caller, ToolDeps } from "./toolContext";
import { resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

export const RESOLVE_LOCATION_TOOL = "resolve_location";

/** Below this, we ask the resident to pick rather than guess. */
export const MIN_CONFIDENCE = 0.7;
const MAX_CANDIDATES = 3;

// "my house", "in front of my home", "our building", or just "home".
const HOME_PATTERN = /\b(my|our)\s+(house|home|place|building|apartment|door)\b|^\s*(at\s+)?home\s*$/i;

const candidateSchema = z.object({
    location_id: z.string(),
    address: z.string(),
    lat: z.number(),
    lng: z.number(),
});

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        location_id: z.string().optional(),
        address: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        confidence: z.number(),
        candidates: z.array(candidateSchema),
    }),
});

function toCandidate(location: ResolvedLocation): z.infer<typeof candidateSchema> {
    return {
        location_id: encodeLocationId(location),
        address: location.address,
        lat: location.point.lat,
        lng: location.point.lng,
    };
}

export function registerResolveLocationTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    server.registerTool(
        RESOLVE_LOCATION_TOOL,
        {
            title: "Resolve location",
            description:
                "Turns the place the user mentions into a confirmed location for a city report. " +
                "Call it first whenever the user reports a problem, and again if they correct the place. " +
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
            if (HOME_PATTERN.test(spokenPlace)) {
                const found = await resolveResident(deps, caller);
                if ("failure" in found) {
                    return found.failure;
                }
                const home = { address: found.resident.homeAddress, point: found.resident.homePoint, isHome: true };
                return toolSuccess({
                    speech: `I'll use your home address, ${home.address}.`,
                    data: { ...toCandidate(home), confidence: 1, candidates: [] },
                });
            }

            const matches = (await deps.geocoder.geocode(spokenPlace)).filter((candidate) =>
                isInside(candidate.point, deps.serviceArea),
            );
            const [best, runnerUp] = matches;
            if (best === undefined) {
                return toolFailure(
                    "I couldn't find that place in the area CityVoice covers. " +
                        "Could you give me a street address or the nearest intersection?",
                );
            }

            const isClearWinner = runnerUp === undefined || runnerUp.relevance < best.relevance;
            if (best.relevance >= MIN_CONFIDENCE && isClearWinner) {
                const location = { address: best.address, point: best.point, isHome: false };
                return toolSuccess({
                    speech: `I found ${location.address}.`,
                    data: { ...toCandidate(location), confidence: best.relevance, candidates: [] },
                });
            }

            const candidates = matches
                .slice(0, MAX_CANDIDATES)
                .map((match) => toCandidate({ address: match.address, point: match.point, isHome: false }));
            return toolSuccess({
                speech: `A few places could match: ${joinWithAnd(
                    candidates.map((candidate) => candidate.address),
                    "or",
                )}. Which one is it?`,
                data: { confidence: best.relevance, candidates },
            });
        },
    );
}
