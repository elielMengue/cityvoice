import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";

import { SERVICE_TYPES } from "../catalog/serviceCatalog";
import { CITIES } from "../cities/cities";
import { describeService } from "../tools/schemas";

/**
 * The catalog of service types a city accepts, as JSON: what can be
 * reported, the questions the city asks, and how long it usually takes.
 * Built from the same catalog the tools use, so the two never disagree.
 */

const SERVICES_TEMPLATE = "cityvoice://services/{city}";

/** Cities CityVoice serves, by the slug used in the URI, with their names. */
const CITY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
    Object.values(CITIES).map((city) => [city.id, city.name]),
);

function servicesUri(city: string): string {
    return `cityvoice://services/${city}`;
}

export function registerServicesResource(server: McpServer): void {
    server.registerResource(
        "City services",
        new ResourceTemplate(SERVICES_TEMPLATE, {
            list: () => ({
                resources: Object.entries(CITY_NAMES).map(([slug, name]) => ({
                    uri: servicesUri(slug),
                    name: `${name} services`,
                    mimeType: "application/json",
                })),
            }),
        }),
        {
            description:
                "What residents can report in a city, the questions the city asks for each kind of problem, " +
                "and how many business days it usually takes.",
            mimeType: "application/json",
        },
        (uri, variables) => {
            const city = String(variables["city"] ?? "");
            const name = CITY_NAMES[city];
            if (name === undefined) {
                throw new ResourceNotFoundError(uri.href, `CityVoice does not serve ${city || "that city"} yet.`);
            }
            const catalog = {
                city: name,
                services: SERVICE_TYPES.map((service) => ({
                    ...describeService(service),
                    also_called: service.synonyms,
                })),
            };
            return {
                contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(catalog, null, 2) }],
            };
        },
    );
}
