import { describe, expect, test } from "bun:test";

import type { RateLimiter } from "../src/limits";
import { checkLimits, limitFor } from "../src/limits";

/** Allows `allowed` calls per key, like the binding within one period. */
function countingLimiter(allowed: number): RateLimiter & { keys: string[] } {
    const counts = new Map<string, number>();
    const keys: string[] = [];
    return {
        keys,
        async limit({ key }) {
            keys.push(key);
            const count = (counts.get(key) ?? 0) + 1;
            counts.set(key, count);
            return { success: count <= allowed };
        },
    };
}

const request = (path: string, headers: Record<string, string> = {}) =>
    new Request(`https://cityvoice.example${path}`, { method: "POST", headers });

describe("limitFor", () => {
    test("counts MCP calls per link, so a refresh does not reset the count", () => {
        const first = limitFor(request("/mcp", { authorization: "Bearer maria:grant1:secretA" }));
        const refreshed = limitFor(request("/mcp", { authorization: "Bearer maria:grant1:secretB" }));

        expect(first).toEqual({ limiter: "mcp", key: "link:maria:grant1" });
        expect(refreshed).toEqual(first);
    });

    test("counts calls without a token per address", () => {
        expect(limitFor(request("/mcp", { "cf-connecting-ip": "203.0.113.7" }))).toEqual({
            limiter: "mcp",
            key: "ip:203.0.113.7",
        });
    });

    test("counts sign-in pages per client and address", () => {
        expect(limitFor(request("/authorize?client_id=abc", { "cf-connecting-ip": "203.0.113.7" }))).toEqual({
            limiter: "auth",
            key: "/authorize:abc:203.0.113.7",
        });
    });

    test("leaves the health check and discovery documents alone", () => {
        expect(limitFor(request("/health"))).toBeUndefined();
        expect(limitFor(request("/.well-known/oauth-authorization-server"))).toBeUndefined();
    });
});

describe("checkLimits", () => {
    test("answers 429 with Retry-After once the limit is reached", async () => {
        const mcp = countingLimiter(2);
        const call = () => checkLimits(request("/mcp", { authorization: "Bearer daniel:g:s" }), { mcp });

        expect(await call()).toBeUndefined();
        expect(await call()).toBeUndefined();
        const refused = await call();

        expect(refused?.status).toBe(429);
        expect(refused?.headers.get("retry-after")).toBe("60");
    });

    test("does nothing when the binding is missing, as in tests and local runs", async () => {
        expect(await checkLimits(request("/mcp"), {})).toBeUndefined();
    });
});
