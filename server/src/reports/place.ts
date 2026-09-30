import { isInside } from "../geo/geo";
import type { ResolvedLocation } from "../geo/locationId";
import { joinWithAnd } from "../speech/speech";
import type { Caller, ToolDeps } from "../tools/toolContext";

/** Below this, we ask the resident to pick rather than guess. */
const MIN_CONFIDENCE = 0.7;
const MAX_CANDIDATES = 3;

// "my house", "in front of my home", "our building", or just "home".
const HOME_PATTERN = /\b(my|our)\s+(house|home|place|building|apartment|door)\b|^\s*(at\s+)?home\s*$/i;

export type PlaceOutcome =
    | { readonly kind: "found"; readonly location: ResolvedLocation; readonly confidence: number }
    | { readonly kind: "ambiguous"; readonly candidates: readonly ResolvedLocation[]; readonly confidence: number }
    | { readonly kind: "not_found" }
    | { readonly kind: "not_linked" };

export async function resolvePlace(deps: ToolDeps, caller: Caller, spokenPlace: string): Promise<PlaceOutcome> {
    if (HOME_PATTERN.test(spokenPlace)) {
        const resident =
            caller.residentId === undefined ? undefined : await deps.residents.getResident(caller.residentId);
        if (resident === undefined) {
            return { kind: "not_linked" };
        }
        return {
            kind: "found",
            location: { address: resident.homeAddress, point: resident.homePoint, isHome: true },
            confidence: 1,
        };
    }

    const matches = (await deps.geocoder.geocode(spokenPlace)).filter((match) =>
        isInside(match.point, deps.serviceArea),
    );
    const [best, runnerUp] = matches;
    if (best === undefined) {
        return { kind: "not_found" };
    }
    const toLocation = (match: typeof best): ResolvedLocation => ({
        address: match.address,
        point: match.point,
        isHome: false,
    });
    const clearWinner = runnerUp === undefined || runnerUp.relevance < best.relevance;
    if (best.relevance >= MIN_CONFIDENCE && clearWinner) {
        return { kind: "found", location: toLocation(best), confidence: best.relevance };
    }
    return {
        kind: "ambiguous",
        candidates: matches.slice(0, MAX_CANDIDATES).map(toLocation),
        confidence: best.relevance,
    };
}

export const PLACE_NOT_FOUND_SPEECH =
    "I couldn't find that place in the area CityVoice covers. " +
    "Could you tell me the nearest intersection, like 14th and U?";

export function foundPlaceSpeech(location: ResolvedLocation): string {
    return location.isHome ? `I'll use your home address, ${location.address}.` : `I found ${location.address}.`;
}

export function candidatesSpeech(candidates: readonly ResolvedLocation[]): string {
    const addresses = candidates.map((candidate) => candidate.address);
    return `A few places could match: ${joinWithAnd(addresses, "or")}. Which one is it?`;
}
