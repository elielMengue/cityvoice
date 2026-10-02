import type { DemoAccount } from "../auth/consentPage";
import { DC_BOUNDS, DC_PLACES, DEMO_RESIDENTS } from "../demo/dcDemo";
import { GazetteerGeocoder } from "../geo/gazetteerGeocoder";
import type { BoundingBox } from "../geo/geo";
import type { Resident } from "../residents/residentStore";
import type { ToolDeps } from "../tools/toolContext";
import type { City, CityId } from "./city";
import { SAN_FRANCISCO, SF_RESIDENTS } from "./sanFrancisco";

export const WASHINGTON_DC: City = {
    id: "washington-dc",
    name: "Washington, DC",
    serviceArea: DC_BOUNDS,
    places: DC_PLACES,
};

export const CITIES: Readonly<Record<CityId, City>> = {
    "washington-dc": WASHINGTON_DC,
    "san-francisco": SAN_FRANCISCO,
};

/** Every city's area, for what serves them all, like the map tiles. */
export const ALL_SERVICE_AREAS: readonly BoundingBox[] = Object.values(CITIES).map((city) => city.serviceArea);

/** The demo residents of every city. */
export const ALL_RESIDENTS: readonly Resident[] = [...DEMO_RESIDENTS, ...SF_RESIDENTS];

/** The same residents as the consent page offers them, with their city's name. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = ALL_RESIDENTS.map((resident) => ({
    id: resident.id,
    name: resident.name,
    homeAddress: resident.homeAddress,
    cityName: CITIES[resident.city].name,
}));

const geocoders = new Map<CityId, GazetteerGeocoder>();

/** The tool dependencies for one city: its places and its area, with everything else shared. */
export function forCity(deps: ToolDeps, cityId: CityId): ToolDeps {
    const city = CITIES[cityId];
    let geocoder = geocoders.get(cityId);
    if (geocoder === undefined) {
        geocoder = new GazetteerGeocoder(city.places);
        geocoders.set(cityId, geocoder);
    }
    return { ...deps, geocoder, serviceArea: city.serviceArea };
}
