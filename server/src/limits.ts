/**
 * Per-minute request limits, through Cloudflare's rate limiting binding.
 * Counters are per location and approximate, so these slow a flood down but
 * cannot hold an exact number; the hard daily cap on KV writes lives in
 * dailyBudget.ts.
 */

/** The Workers rate limiting binding, reduced to the one call we make. */
export interface RateLimiter {
    limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

export interface Limiters {
    /** OAuth routes: sign-in pages, token exchange and registration. */
    readonly auth?: RateLimiter | undefined;
    /** MCP calls. */
    readonly mcp?: RateLimiter | undefined;
}

const AUTH_PATHS = new Set(["/authorize", "/oauth/token", "/oauth/register"]);

function clientAddress(request: Request): string {
    return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * The link a token belongs to. The library's tokens start with the user and
 * grant ids, so every token of one link shares a key and a refresh does not
 * reset the count.
 */
function linkOf(request: Request): string | undefined {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (token === undefined || token.length === 0) {
        return undefined;
    }
    return token.split(":").slice(0, 2).join(":");
}

/** Which limiter a request counts against, and under which key. */
export function limitFor(request: Request): { readonly limiter: keyof Limiters; readonly key: string } | undefined {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
        const link = linkOf(request);
        return { limiter: "mcp", key: link === undefined ? `ip:${clientAddress(request)}` : `link:${link}` };
    }
    if (AUTH_PATHS.has(url.pathname)) {
        // Registration is closed in production, so a client id is one of
        // ours; the address still separates one visitor from another.
        const client = url.searchParams.get("client_id") ?? "none";
        return { limiter: "auth", key: `${url.pathname}:${client}:${clientAddress(request)}` };
    }
    return undefined;
}

/** Returns a 429 answer when the request is over its limit, otherwise undefined. */
export async function checkLimits(request: Request, limiters: Limiters): Promise<Response | undefined> {
    const rule = limitFor(request);
    const limiter = rule === undefined ? undefined : limiters[rule.limiter];
    if (rule === undefined || limiter === undefined) {
        return undefined;
    }
    const { success } = await limiter.limit({ key: rule.key });
    if (success) {
        return undefined;
    }
    return Response.json(
        { error: "rate_limited", error_description: "Too many requests. Try again in a minute." },
        { status: 429, headers: { "retry-after": "60" } },
    );
}
