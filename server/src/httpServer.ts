import type { Authenticator } from "./auth/authenticator";
import type { Logger } from "./logger";
import type { TileCache } from "./map/tileProxy";
import { serveTile, TILES_PATH } from "./map/tileProxy";
import { createMcpFetch } from "./mcpServer";
import type { ToolDeps } from "./tools/toolContext";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";

export interface HttpServerDeps {
    readonly logger: Logger;
    readonly tools: ToolDeps;
    readonly authenticate: Authenticator;
    /** Where map tiles are kept once fetched. The edge cache on Workers; none locally. */
    readonly tileCache?: TileCache | undefined;
    readonly tileFetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Returns the fetch handler for Bun.serve. It routes, and it writes exactly
 * one log line per request with the status and the latency, which is the
 * number Alexa+ holds us to.
 */
export function createFetchHandler({
    logger,
    tools,
    authenticate,
    tileCache,
    tileFetch,
}: HttpServerDeps): (request: Request) => Promise<Response> {
    const mcpFetch = createMcpFetch(logger, tools);

    return async (request) => {
        const startedAt = performance.now();
        const { pathname } = new URL(request.url);
        let response: Response;

        try {
            if (pathname === HEALTH_PATH && request.method === "GET") {
                response = Response.json({ status: "ok" });
            } else if (pathname.startsWith(`${TILES_PATH}/`)) {
                response = await serveTile(request, {
                    area: tools.serviceArea,
                    cache: tileCache,
                    ...(tileFetch === undefined ? {} : { fetch: tileFetch }),
                });
            } else if (pathname === MCP_PATH) {
                response = await mcpFetch(request, await authenticate(request));
            } else {
                response = new Response("Not found", { status: 404 });
            }
        } catch (error) {
            logger.error("unhandled error", { path: pathname, error: String(error) });
            response = Response.json(
                { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
                { status: 500 },
            );
        }

        // On Cloudflare Workers the clock is frozen during a request, so
        // latencyMs reads 0 there; use the platform's wallTime instead.
        logger.info("request", {
            method: request.method,
            path: pathname,
            status: response.status,
            latencyMs: Math.round(performance.now() - startedAt),
        });
        return response;
    };
}
