import type { CityId } from "../cities/city";
import type { SqlDatabase } from "../db/sqlDatabase";
import type { ServiceRequest } from "./types";

/**
 * Mirrors a city's real Open311 requests into the sandbox table. Reading the
 * city's feed takes seconds, far too slow for a voice turn, so a scheduled
 * job copies the recent requests and the tools read them from the database
 * like any other. Only reads ever reach the city: nothing is sent to it.
 */

/** Pages of the most recent requests read on each run. San Francisco gets a few hundred a day. */
export const MIRROR_PAGES = 2;
const PAGE_SIZE = 200;

/**
 * Mirrored requests older than this are removed, unless a resident supports
 * them. A request that left the feed's recent pages is no longer refreshed,
 * so its status could be stale; two weeks keeps that window short.
 */
export const MIRROR_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const FEED_TIMEOUT_MS = 20_000;
const USER_AGENT = "CityVoice/0.2 (+https://github.com/elielMengue/cityvoice)";

export type FeedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The newest requests from a GeoReport v2 feed, every status, as the city sends them. */
export async function readRecentRequests(
    feedUrl: string,
    fetchFeed: FeedFetch = (url, init) => fetch(url, init),
): Promise<unknown[]> {
    const requests: unknown[] = [];
    for (let page = 1; page <= MIRROR_PAGES; page += 1) {
        const response = await fetchFeed(`${feedUrl}/requests.json?page_size=${PAGE_SIZE}&page=${page}`, {
            headers: { accept: "application/json", "user-agent": USER_AGENT },
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`Open311 feed answered ${response.status} for page ${page}`);
        }
        const body: unknown = await response.json();
        if (!Array.isArray(body)) {
            throw new Error("Open311 feed did not send a list of requests");
        }
        requests.push(...body);
        if (body.length < PAGE_SIZE) {
            break;
        }
    }
    return requests;
}

export interface MirrorOutcome {
    readonly mirrored: number;
    readonly removed: number;
}

/**
 * Inserts the city's requests, or refreshes them if already mirrored. What
 * CityVoice adds to a request, its supporters, is kept. A request filed
 * through CityVoice is never overwritten, even if a city used the same id.
 * A request that has not changed is not written again: D1's free plan counts
 * every row written, and most of the feed is the same from one run to the next.
 */
export async function mirrorRequests(
    db: SqlDatabase,
    city: CityId,
    requests: readonly ServiceRequest[],
    now: Date,
): Promise<MirrorOutcome> {
    const upsert = db.prepare(
        `INSERT INTO service_requests (service_request_id, status, status_notes, service_name, service_code,
            description, requested_datetime, updated_datetime, address, lat, long, supporters, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT (service_request_id) DO UPDATE SET
            status = excluded.status, status_notes = excluded.status_notes,
            service_name = excluded.service_name, service_code = excluded.service_code,
            description = excluded.description, updated_datetime = excluded.updated_datetime,
            address = excluded.address, lat = excluded.lat, long = excluded.long
         WHERE service_requests.source = excluded.source
           AND (service_requests.status IS NOT excluded.status
             OR service_requests.status_notes IS NOT excluded.status_notes
             OR service_requests.updated_datetime IS NOT excluded.updated_datetime
             OR service_requests.service_code IS NOT excluded.service_code)`,
    );
    const cutoff = new Date(now.getTime() - MIRROR_RETENTION_MS).toISOString();
    // Too old to keep: inserting it would only have the cleanup below delete it again.
    const recent = requests.filter((request) => request.requested_datetime >= cutoff);
    const statements = recent.map((request) =>
        upsert.bind(
            request.service_request_id,
            request.status,
            request.status_notes ?? null,
            request.service_name,
            request.service_code,
            request.description ?? null,
            request.requested_datetime,
            request.updated_datetime ?? null,
            request.address ?? null,
            request.lat,
            request.long,
            city,
        ),
    );
    if (statements.length > 0) {
        await db.batch(statements);
    }

    const removed = await db
        .prepare(
            `DELETE FROM service_requests
             WHERE source = ? AND requested_datetime < ?
               AND service_request_id NOT IN (SELECT request_id FROM my_reports)`,
        )
        .bind(city, cutoff)
        .run();
    return { mirrored: statements.length, removed: removed.meta.changes };
}
