import type { ServiceAttribute, ServiceType } from "../catalog/serviceCatalog";
import { findServiceType, SERVICE_TYPES } from "../catalog/serviceCatalog";
import type { Open311Client, ServiceRequest } from "./types";

/**
 * The CityVoice sandbox seen from the outside, as an Open311 GeoReport v2
 * server, read-only. It is what a city's 311 system would receive from
 * CityVoice, in the exact format cities publish, so anyone can check a report
 * filed by voice without an account. Requests mirrored from a real city are
 * left out: they are the city's, not ours.
 *
 * See https://wiki.open311.org/GeoReport_v2/
 */

export const OPEN311_PATH = "/open311/v2";

const AGENCY = "CityVoice sandbox";
/** The standard's default window when no dates are given, and its cap on results. */
const DEFAULT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 1000;

export interface FeedDeps {
    readonly open311: Open311Client;
    readonly now: () => Date;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: {
            // Public data, meant to be read from anywhere, like a city's own feed.
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
        },
    });
}

/** GeoReport v2 reports errors as a list of code and description. */
function error(status: number, description: string): Response {
    return json([{ code: status, description }], status);
}

function describeService(service: ServiceType) {
    return {
        service_code: service.code,
        service_name: service.name,
        description: `Report ${service.pluralName}. The city usually handles them within ${service.typicalBusinessDays} business days.`,
        metadata: service.attributes.length > 0,
        type: "realtime",
        keywords: service.synonyms.join(","),
        group: "Streets",
    };
}

function describeAttribute(attribute: ServiceAttribute, order: number) {
    return {
        variable: true,
        code: attribute.code,
        datatype: attribute.options === undefined ? "string" : "singlevaluelist",
        required: attribute.required,
        datatype_description: attribute.question,
        order: order + 1,
        description: attribute.question,
        ...(attribute.options === undefined
            ? {}
            : { values: attribute.options.map((option) => ({ key: option.key, name: option.phrase })) }),
    };
}

/** A request with exactly the standard's fields, and nothing CityVoice keeps for itself. */
function describeRequest(request: ServiceRequest) {
    return {
        service_request_id: request.service_request_id,
        status: request.status,
        ...(request.status_notes === undefined ? {} : { status_notes: request.status_notes }),
        service_name: request.service_name,
        service_code: request.service_code,
        ...(request.description?.trim() ? { description: request.description } : {}),
        agency_responsible: AGENCY,
        requested_datetime: request.requested_datetime,
        ...(request.updated_datetime === undefined ? {} : { updated_datetime: request.updated_datetime }),
        ...(request.expected_datetime === undefined ? {} : { expected_datetime: request.expected_datetime }),
        ...(request.address === undefined ? {} : { address: request.address }),
        lat: request.lat,
        long: request.long,
    };
}

function parseDate(value: string | null): Date | undefined | "invalid" {
    if (value === null) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "invalid" : date;
}

async function listRequests(url: URL, deps: FeedDeps): Promise<Response> {
    const params = url.searchParams;
    const ids = params.get("service_request_id");
    if (ids !== null) {
        const wanted = ids
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0);
        return json((await deps.open311.findRequests({ ids: wanted, filedHere: true })).map(describeRequest));
    }

    const status = params.get("status");
    if (status !== null && status !== "open" && status !== "closed") {
        return error(400, "status must be open or closed");
    }
    const start = parseDate(params.get("start_date"));
    const end = parseDate(params.get("end_date"));
    if (start === "invalid" || end === "invalid") {
        return error(400, "start_date and end_date must be ISO 8601 dates");
    }
    const until = end ?? deps.now();
    const since = start ?? new Date(until.getTime() - DEFAULT_WINDOW_MS);
    const serviceCode = params.get("service_code");

    const requests = await deps.open311.findRequests({
        filedHere: true,
        ...(status === null ? {} : { status }),
        ...(serviceCode === null ? {} : { service_code: serviceCode }),
    });
    const inWindow = requests
        .filter((request) => {
            const requested = new Date(request.requested_datetime).getTime();
            return requested >= since.getTime() && requested <= until.getTime();
        })
        .sort((a, b) => b.requested_datetime.localeCompare(a.requested_datetime))
        .slice(0, MAX_RESULTS);
    return json(inWindow.map(describeRequest));
}

/**
 * Answers a GeoReport v2 read under /open311/v2, or returns undefined for
 * any other path. Only JSON is served, and only GET.
 */
export async function serveOpen311Feed(request: Request, deps: FeedDeps): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${OPEN311_PATH}/`)) {
        return undefined;
    }
    if (request.method !== "GET") {
        return error(405, "This Open311 server is read-only");
    }
    const path = url.pathname.slice(OPEN311_PATH.length);
    if (!path.endsWith(".json")) {
        return error(404, "Only the JSON format is served");
    }
    const resource = path.slice(0, -".json".length);

    if (resource === "/services") {
        return json(SERVICE_TYPES.map(describeService));
    }
    if (resource.startsWith("/services/")) {
        const service = findServiceType(decodeURIComponent(resource.slice("/services/".length)));
        return service === undefined
            ? error(404, "No such service")
            : json({ service_code: service.code, attributes: service.attributes.map(describeAttribute) });
    }
    if (resource === "/requests") {
        return listRequests(url, deps);
    }
    if (resource.startsWith("/requests/")) {
        const id = decodeURIComponent(resource.slice("/requests/".length));
        const [ours] = await deps.open311.findRequests({ ids: [id], filedHere: true });
        // The standard answers a single request as a list of one.
        return ours === undefined ? error(404, "No such request") : json([describeRequest(ours)]);
    }
    return error(404, "No such resource");
}
