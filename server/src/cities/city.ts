import type { BoundingBox } from "../geo/geo";
import type { GazetteerEntry } from "../geo/gazetteerGeocoder";

/**
 * A city CityVoice serves. Each resident belongs to one, and the tools work
 * with that city's places and area. Reports always go to the CityVoice
 * sandbox; a city with a live Open311 feed also has its real requests
 * mirrored there, so residents hear about them and can support them.
 */

export const CITY_IDS = ["washington-dc", "san-francisco"] as const;
export type CityId = (typeof CITY_IDS)[number];

export interface City {
    readonly id: CityId;
    /** As spoken and shown: "Washington, DC". */
    readonly name: string;
    /** Places outside it are refused. */
    readonly serviceArea: BoundingBox;
    /** The places the geocoder knows, with their exact coordinates. */
    readonly places: readonly GazetteerEntry[];
}
