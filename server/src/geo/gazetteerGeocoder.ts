import type { GeoPoint } from "./geo";
import type { GeocodeCandidate, Geocoder } from "./geocoder";

export interface GazetteerEntry {
    readonly address: string;
    readonly point: GeoPoint;
}

// Words that say nothing about which place is meant.
const FILLER_WORDS = new Set([
    "street",
    "st",
    "avenue",
    "ave",
    "road",
    "rd",
    "place",
    "pl",
    "northwest",
    "nw",
    "northeast",
    "ne",
    "southwest",
    "sw",
    "southeast",
    "se",
    "and",
    "at",
    "the",
    "of",
    "on",
    "near",
    "by",
    "corner",
    "intersection",
    "in",
    "front",
    "a",
]);

const ORDINAL_WORDS: Record<string, string> = {
    first: "1st",
    second: "2nd",
    third: "3rd",
    fourth: "4th",
    fifth: "5th",
    sixth: "6th",
    seventh: "7th",
    eighth: "8th",
    ninth: "9th",
    tenth: "10th",
    eleventh: "11th",
    twelfth: "12th",
    thirteenth: "13th",
    fourteenth: "14th",
    fifteenth: "15th",
    sixteenth: "16th",
    seventeenth: "17th",
    eighteenth: "18th",
    nineteenth: "19th",
    twentieth: "20th",
};

/** Reduces a spoken or written place to the tokens that identify it. */
export function placeTokens(text: string): Set<string> {
    const words = text
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => ORDINAL_WORDS[word] ?? word)
        .filter((word) => !FILLER_WORDS.has(word));
    return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
        return 0;
    }
    let shared = 0;
    for (const token of a) {
        if (b.has(token)) {
            shared += 1;
        }
    }
    return shared / (a.size + b.size - shared);
}

/**
 * Matches spoken places against a fixed list of addresses and intersections.
 * Word order does not matter, so "U and 14th" finds "14th Street and U Street
 * Northwest". Good enough for a demo city; real traffic goes to Amazon
 * Location Service.
 */
export class GazetteerGeocoder implements Geocoder {
    private readonly entries: readonly { readonly entry: GazetteerEntry; readonly tokens: Set<string> }[];

    constructor(entries: readonly GazetteerEntry[]) {
        this.entries = entries.map((entry) => ({ entry, tokens: placeTokens(entry.address) }));
    }

    async geocode(text: string): Promise<readonly GeocodeCandidate[]> {
        const query = placeTokens(text);
        return this.entries
            .map(({ entry, tokens }) => ({
                address: entry.address,
                point: entry.point,
                relevance: jaccard(query, tokens),
            }))
            .filter((candidate) => candidate.relevance > 0)
            .sort((a, b) => b.relevance - a.relevance);
    }
}
