import { z } from "zod";

import type { ServiceType } from "../catalog/serviceCatalog";
import type { ResolvedLocation } from "../geo/locationId";
import { encodeLocationId } from "../geo/locationId";

/** Output shapes shared by several tools, so the same thing is always described the same way. */

export const questionSchema = z.object({
    code: z.string(),
    question: z.string(),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
});

export const serviceSchema = z.object({
    service_code: z.string(),
    name: z.string(),
    typical_business_days: z.number(),
    questions: z.array(questionSchema),
});

export const placeSchema = z.object({
    location_id: z.string(),
    address: z.string(),
    lat: z.number(),
    lng: z.number(),
});

export const nearbyReportSchema = z.object({
    request_id: z.string(),
    service_name: z.string(),
    address: z.string(),
    distance_m: z.number(),
    requested_datetime: z.string(),
    age: z.string(),
    supporters: z.number(),
    status_notes: z.string().optional(),
    my_role: z.enum(["author", "supporter", "none"]),
});

export function describeQuestions(service: ServiceType): z.infer<typeof questionSchema>[] {
    return service.attributes.map((attribute) => ({
        code: attribute.code,
        question: attribute.question,
        required: attribute.required,
        ...(attribute.options === undefined ? {} : { options: attribute.options.map((option) => option.key) }),
    }));
}

export function describeService(service: ServiceType): z.infer<typeof serviceSchema> {
    return {
        service_code: service.code,
        name: service.name,
        typical_business_days: service.typicalBusinessDays,
        questions: describeQuestions(service),
    };
}

export function describePlace(location: ResolvedLocation): z.infer<typeof placeSchema> {
    return {
        location_id: encodeLocationId(location),
        address: location.address,
        lat: location.point.lat,
        lng: location.point.lng,
    };
}
