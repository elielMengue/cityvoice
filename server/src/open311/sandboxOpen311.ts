import { findServiceType } from "../catalog/serviceCatalog";
import type {
    CreatedServiceRequest,
    NewServiceRequest,
    Open311Client,
    ServiceRequest,
    ServiceRequestQuery,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Skips Saturdays and Sundays. Public holidays are ignored in the sandbox. */
export function addBusinessDays(start: Date, businessDays: number): Date {
    let date = new Date(start.getTime());
    let remaining = businessDays;
    while (remaining > 0) {
        date = new Date(date.getTime() + DAY_MS);
        const weekday = date.getUTCDay();
        if (weekday !== 0 && weekday !== 6) {
            remaining -= 1;
        }
    }
    return date;
}

export interface SandboxOptions {
    readonly now: () => Date;
    /** Produces the next request number. Deterministic in the demo so the video can be rehearsed. */
    readonly nextRequestId: () => string;
}

/**
 * An in-memory 311 system that behaves like a GeoReport v2 server. Reports
 * filed during the demo land here and never reach a real city.
 */
export class SandboxOpen311 implements Open311Client {
    private readonly requests = new Map<string, ServiceRequest>();

    constructor(
        seed: readonly ServiceRequest[],
        private readonly options: SandboxOptions,
    ) {
        for (const request of seed) {
            this.requests.set(request.service_request_id, request);
        }
    }

    async findRequests(query: ServiceRequestQuery): Promise<readonly ServiceRequest[]> {
        return [...this.requests.values()].filter(
            (request) =>
                (query.service_code === undefined || request.service_code === query.service_code) &&
                (query.status === undefined || request.status === query.status),
        );
    }

    async getRequests(ids: readonly string[]): Promise<readonly ServiceRequest[]> {
        return ids.flatMap((id) => {
            const request = this.requests.get(id);
            return request === undefined ? [] : [request];
        });
    }

    async createRequest(request: NewServiceRequest): Promise<CreatedServiceRequest> {
        const service = findServiceType(request.service_code);
        if (service === undefined) {
            throw new Error(`Unknown service code ${request.service_code}`);
        }
        const now = this.options.now();
        const created: ServiceRequest = {
            service_request_id: this.options.nextRequestId(),
            status: "open",
            service_name: service.name,
            service_code: service.code,
            description: request.description,
            requested_datetime: now.toISOString(),
            updated_datetime: now.toISOString(),
            expected_datetime: addBusinessDays(now, service.typicalBusinessDays).toISOString(),
            address: request.address_string,
            lat: request.lat,
            long: request.long,
            supporters: 1,
        };
        this.requests.set(created.service_request_id, created);
        return {
            service_request_id: created.service_request_id,
            ...(created.expected_datetime === undefined ? {} : { expected_datetime: created.expected_datetime }),
        };
    }

    async addSupporter(serviceRequestId: string): Promise<number> {
        const request = this.requests.get(serviceRequestId);
        if (request === undefined) {
            throw new Error(`Unknown service request ${serviceRequestId}`);
        }
        const updated = { ...request, supporters: request.supporters + 1 };
        this.requests.set(serviceRequestId, updated);
        return updated.supporters;
    }
}
