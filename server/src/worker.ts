import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { Authenticator } from "./auth/authenticator";
import { createDemoAuthenticator } from "./auth/authenticator";
import { handleAuthorize, REPORTS_SCOPE } from "./auth/authorizeHandler";
import type { Config } from "./config";
import { loadConfig } from "./config";
import type { SqlDatabase } from "./db/sqlDatabase";
import { DEMO_RESIDENTS } from "./demo/dcDemo";
import { createSqlDemoDeps } from "./demo/demoDeps";
import { createFetchHandler, HEALTH_PATH, MCP_PATH } from "./httpServer";
import { createLogger } from "./logger";
import { SqlResidentStore } from "./residents/sqlResidentStore";

// Only the default export may be a value here: Workers treats every named
// export of the main module as an entry point.

/** Bindings and variables from wrangler.jsonc. D1 fits SqlDatabase as it is. */
export interface WorkerEnv {
    readonly DB: SqlDatabase;
    /** Key-value store the OAuth library keeps clients, grants and tokens in (hashed). */
    readonly OAUTH_KV?: unknown;
    /** Injected by the OAuth library for the /authorize page. */
    readonly OAUTH_PROVIDER?: OAuthHelpers;
    readonly AUTH_MODE?: string;
    readonly DEMO_RESIDENT?: string;
    readonly PUBLIC_URL?: string;
    readonly LOG_LEVEL?: string;
    readonly NODE_ENV?: string;
}

type FetchHandler = (request: Request) => Promise<Response>;
type WorkerFetch = (request: Request, env: WorkerEnv, ctx: unknown) => Promise<Response>;

const AUTHORIZE_PATH = "/authorize";
const TOKEN_PATH = "/oauth/token";
const REGISTER_PATH = "/oauth/register";

const tokenPropsSchema = z.object({ residentId: z.string().min(1) });

function readConfig(env: WorkerEnv): Config {
    return loadConfig({
        AUTH_MODE: env.AUTH_MODE,
        DEMO_RESIDENT: env.DEMO_RESIDENT,
        PUBLIC_URL: env.PUBLIC_URL,
        LOG_LEVEL: env.LOG_LEVEL,
        NODE_ENV: env.NODE_ENV,
    });
}

/**
 * Local development: the demo authenticator picks the resident from a header.
 * loadConfig refuses this mode in production.
 */
function buildDemoWorker(env: WorkerEnv, config: Config): WorkerFetch {
    const authenticate = createDemoAuthenticator(
        DEMO_RESIDENTS.map((resident) => resident.id),
        config.demoResident,
    );
    const handler = createFetchHandler({
        logger: createLogger(config.logLevel),
        tools: createSqlDemoDeps(env.DB),
        authenticate,
    });
    return (request) => handler(request);
}

/**
 * Production: OAuth 2.1 with PKCE, as the Alexa+ MCP Toolkit requires. The
 * library serves the metadata, token and registration endpoints, and answers
 * a request without a valid token with a 401 challenge. Our code serves the
 * consent page and the MCP endpoint.
 */
function buildOAuthWorker(config: Config): WorkerFetch {
    const publicUrl = config.publicUrl ?? "";
    const logger = createLogger(config.logLevel);

    // The library hands the verified token's props to the API handler through
    // its context. Our HTTP layer asks an Authenticator, so the props are
    // parked on the request object for the length of the call.
    const authByRequest = new WeakMap<Request, AuthInfo>();
    const authenticate: Authenticator = async (request) => authByRequest.get(request);
    let mcpHandler: { readonly env: WorkerEnv; readonly handler: FetchHandler } | undefined;

    const handlerFor = (env: WorkerEnv): FetchHandler => {
        if (mcpHandler?.env !== env) {
            mcpHandler = {
                env,
                handler: createFetchHandler({ logger, tools: createSqlDemoDeps(env.DB), authenticate }),
            };
        }
        return mcpHandler.handler;
    };

    const serveMcp = async (request: Request, env: WorkerEnv, ctx: unknown): Promise<Response> => {
        const parsed = tokenPropsSchema.safeParse((ctx as { props?: unknown }).props);
        if (!parsed.success) {
            logger.error("token without a resident", { issues: parsed.error.issues.length });
            return new Response("Forbidden", { status: 403 });
        }
        authByRequest.set(request, {
            token: "oauth",
            clientId: "alexa",
            scopes: [REPORTS_SCOPE],
            extra: { residentId: parsed.data.residentId },
        });
        return handlerFor(env)(request);
    };

    const serveOther = async (request: Request, env: WorkerEnv): Promise<Response> => {
        const { pathname } = new URL(request.url);
        if (pathname === HEALTH_PATH && request.method === "GET") {
            return Response.json({ status: "ok" });
        }
        if (pathname === AUTHORIZE_PATH && env.OAUTH_PROVIDER !== undefined) {
            return handleAuthorize(
                { oauth: env.OAUTH_PROVIDER, residents: new SqlResidentStore(env.DB), accounts: DEMO_RESIDENTS },
                request,
            );
        }
        return new Response("Not found", { status: 404 });
    };

    const provider = new OAuthProvider<WorkerEnv>({
        apiRoute: MCP_PATH,
        apiHandler: { fetch: serveMcp },
        defaultHandler: { fetch: serveOther },
        authorizeEndpoint: AUTHORIZE_PATH,
        tokenEndpoint: TOKEN_PATH,
        // Dynamic registration lets MCP Inspector and the simulator link
        // themselves. Alexa+ uses a client registered once, ahead of time.
        clientRegistrationEndpoint: REGISTER_PATH,
        scopesSupported: [REPORTS_SCOPE],
        requiredScopes: [REPORTS_SCOPE],
        resourceMetadata: {
            resource: `${publicUrl}${MCP_PATH}`,
            authorization_servers: [publicUrl],
        },
    });
    return (request, env, ctx) => provider.fetch(request, env as never, ctx as never);
}

let cached: { readonly env: WorkerEnv; readonly fetch: WorkerFetch } | undefined;

/**
 * Cloudflare Workers entry point. Built once per isolate, on the first
 * request, because the configuration comes from the environment. All state
 * lives in D1 and KV, so any isolate can answer any call.
 */
export default {
    fetch(request: Request, env: WorkerEnv, ctx: unknown): Promise<Response> {
        if (cached?.env !== env) {
            const config = readConfig(env);
            cached = {
                env,
                fetch: config.authMode === "oauth" ? buildOAuthWorker(config) : buildDemoWorker(env, config),
            };
        }
        return cached.fetch(request, env, ctx);
    },
};
