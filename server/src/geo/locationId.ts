import { z } from "zod";

import type { GeoPoint } from "./geo";

/** A place the resident confirmed, ready to attach to a report. */
export interface ResolvedLocation {
    readonly address: string;
    readonly point: GeoPoint;
    /** True when the place is the resident's saved home, so speech can say "near your home". */
    readonly isHome: boolean;
}

const PREFIX = "loc_";

const payloadSchema = z.tuple([
    z.string().min(1).max(200),
    z.number(),
    z.number(),
    z.union([z.literal(0), z.literal(1)]),
]);

/**
 * Packs a resolved place into an opaque identifier. The identifier carries
 * everything the next tool needs, so the server keeps no lookup table and any
 * task can serve the follow-up call. It is not a secret: a resident can only
 * describe a place, which they could do anyway.
 */
export function encodeLocationId(location: ResolvedLocation): string {
    const payload = [
        location.address,
        Number(location.point.lat.toFixed(6)),
        Number(location.point.lng.toFixed(6)),
        location.isHome ? 1 : 0,
    ];
    return PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Returns undefined for anything that was not produced by encodeLocationId. */
export function decodeLocationId(locationId: string): ResolvedLocation | undefined {
    if (!locationId.startsWith(PREFIX)) {
        return undefined;
    }
    try {
        const json: unknown = JSON.parse(Buffer.from(locationId.slice(PREFIX.length), "base64url").toString("utf8"));
        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
            return undefined;
        }
        const [address, lat, lng, isHome] = parsed.data;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return undefined;
        }
        return { address, point: { lat, lng }, isHome: isHome === 1 };
    } catch {
        return undefined;
    }
}
