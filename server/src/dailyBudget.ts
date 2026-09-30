import type { SqlDatabase } from "./db/sqlDatabase";

/**
 * An exact daily cap, counted in D1. Cloudflare's rate limiting binding is
 * approximate by design and let through three times its limit in our tests,
 * which cannot protect a hard daily quota. This can: every OAuth request that
 * writes to KV takes one unit, and once the day's units are gone the answer
 * is a polite "try again tomorrow" until midnight UTC.
 */

/** Requests to these routes write to KV: consent records, grants, codes and tokens. */
const KV_WRITING_PATHS = new Set(["/authorize", "/oauth/token", "/oauth/register"]);

/**
 * Units per day. Each unit writes one to three KV keys, so 250 keeps the
 * total under the 1,000 writes the free plan allows.
 */
export const OAUTH_DAILY_UNITS = 250;

export const BUDGET_NAME = "oauth";

export function usesDailyBudget(request: Request): boolean {
    return KV_WRITING_PATHS.has(new URL(request.url).pathname);
}

/** Takes one unit for today and says whether it was still available. */
export async function takeDailyUnit(db: SqlDatabase, name: string, limit: number, now: Date): Promise<boolean> {
    const day = now.toISOString().slice(0, 10);
    const row = await db
        .prepare(
            `INSERT INTO daily_usage (day, name, count) VALUES (?, ?, 1)
             ON CONFLICT (day, name) DO UPDATE SET count = count + 1
             RETURNING count`,
        )
        .bind(day, name)
        .first<{ count: number }>();
    return row !== null && row.count <= limit;
}

export function budgetExhaustedResponse(request: Request): Response {
    const message = "CityVoice has reached today's limit for account linking. Please try again tomorrow.";
    if (new URL(request.url).pathname === "/authorize" && request.method === "GET") {
        return new Response(message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return Response.json(
        { error: "temporarily_unavailable", error_description: message },
        { status: 503, headers: { "retry-after": "3600" } },
    );
}
