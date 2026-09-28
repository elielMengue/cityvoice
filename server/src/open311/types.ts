/**
 * Open311 GeoReport v2 shapes, with the field names of the standard so the
 * same client can talk to any compliant city.
 * See https://wiki.open311.org/GeoReport_v2/
 */

export type ServiceRequestStatus = "open" | "closed";

export interface ServiceRequest {
    readonly service_request_id: string;
    readonly status: ServiceRequestStatus;
    readonly status_notes?: string;
    readonly service_name: string;
    readonly service_code: string;
    readonly description?: string;
    readonly agency_responsible?: string;
    readonly requested_datetime: string;
    readonly updated_datetime?: string;
    readonly expected_datetime?: string;
    readonly address?: string;
    readonly lat: number;
    readonly long: number;
    /**
     * CityVoice extension: how many residents stand behind the request,
     * the original reporter included. Not part of GeoReport v2.
     */
    readonly supporters: number;
}

export interface NewServiceRequest {
    readonly service_code: string;
    readonly lat: number;
    readonly long: number;
    readonly address_string: string;
    readonly description: string;
    /** GeoReport v2 sends these as attribute[code]=value. */
    readonly attributes: Readonly<Record<string, string>>;
}

export interface CreatedServiceRequest {
    readonly service_request_id: string;
    readonly expected_datetime?: string;
}

export interface ServiceRequestQuery {
    readonly service_code?: string;
    readonly status?: ServiceRequestStatus;
}

/**
 * What CityVoice needs from a city's 311 system. GeoReport v2 has no search
 * by distance, so callers query by service and status and filter by distance
 * themselves.
 */
export interface Open311Client {
    findRequests(query: ServiceRequestQuery): Promise<readonly ServiceRequest[]>;
    getRequests(ids: readonly string[]): Promise<readonly ServiceRequest[]>;
    createRequest(request: NewServiceRequest): Promise<CreatedServiceRequest>;
    /** CityVoice extension. Returns the new number of supporters. */
    addSupporter(serviceRequestId: string): Promise<number>;
}
