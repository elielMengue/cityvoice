/**
 * Turn limits. Each turn spends the free model allowance (Workers AI neurons,
 * Gemini requests), so one visitor must not be able to use it up for all.
 * Counters come from Cloudflare's rate limiting binding: per location and
 * approximate, which is enough to stop a script.
 */

export interface RateLimiter {
    limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export const SLOW_DOWN_SPEECH = "You're going a bit fast for me. Give me a few seconds, then try again.";

/**
 * A linked visitor is counted per link: CityVoice tokens start with the user
 * and grant ids. Anyone else is counted per address.
 */
export function visitorKey(accessToken: string | undefined, request: Request): string {
    if (accessToken !== undefined) {
        return `link:${accessToken.split(":").slice(0, 2).join(":")}`;
    }
    return `ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
}

/** True when the visitor may go on. A missing binding, as in tests, never blocks. */
export async function allowed(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
    if (limiter === undefined) {
        return true;
    }
    return (await limiter.limit({ key })).success;
}
