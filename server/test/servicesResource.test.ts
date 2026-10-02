import { describe, expect, test } from "bun:test";

import { SERVICE_TYPES } from "../src/catalog/serviceCatalog";
import { createTestApp } from "./support/testApp";

describe("cityvoice://services/{city}", () => {
    test("is offered as a template, and Washington DC is listed", async () => {
        const app = createTestApp();

        const templates = (await app.rpc("resources/templates/list")).result?.["resourceTemplates"] as {
            uriTemplate: string;
        }[];
        const resources = (await app.rpc("resources/list")).result?.["resources"] as { uri: string }[];

        expect(templates.map((template) => template.uriTemplate)).toContain("cityvoice://services/{city}");
        expect(resources.map((resource) => resource.uri)).toContain("cityvoice://services/washington-dc");
    });

    test("gives the same catalog the tools use, with questions and usual delays", async () => {
        const app = createTestApp();

        const { result } = await app.rpc("resources/read", { uri: "cityvoice://services/washington-dc" });
        const [content] = result?.["contents"] as { mimeType: string; text: string }[];
        const catalog = JSON.parse(content?.text ?? "{}") as {
            city: string;
            services: { service_code: string; typical_business_days: number; questions: unknown[] }[];
        };

        expect(content?.mimeType).toBe("application/json");
        expect(catalog.city).toBe("Washington, DC");
        expect(catalog.services.map((service) => service.service_code)).toEqual(
            SERVICE_TYPES.map((service) => service.code),
        );
        expect(catalog.services[0]).toMatchObject({ service_code: "POTHOLE", typical_business_days: 3 });
    });

    test("says plainly when a city is not served", async () => {
        const app = createTestApp();

        const { error } = await app.rpc("resources/read", { uri: "cityvoice://services/paris" });

        expect(error?.message).toBe("CityVoice does not serve paris yet.");
    });
});
