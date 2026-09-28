import type { GeoPoint } from "./geo";

export interface GeocodeCandidate {
    /** A full address or intersection, written the way Alexa should say it. */
    readonly address: string;
    readonly point: GeoPoint;
    /** How well the candidate matches what was said, from 0 to 1. */
    readonly relevance: number;
}

/**
 * Turns a spoken place into coordinates. The demo uses a local gazetteer;
 * production swaps in Amazon Location Service behind the same interface.
 */
export interface Geocoder {
    /** Best candidates first. An empty list means nothing matched. */
    geocode(text: string): Promise<readonly GeocodeCandidate[]>;
}
