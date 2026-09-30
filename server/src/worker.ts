import { createDemoAuthenticator } from "./auth/authenticator";
import { loadConfig } from "./config";
import type { SqlDatabase } from "./db/sqlDatabase";
import { DEMO_RESIDENTS } from "./demo/dcDemo";
import { createSqlDemoDeps } from "./demo/demoDeps";
import { createFetchHandler } from "./httpServer";
import { createLogger } from "./logger";

// Only the default export may be a value here: Workers treats every named
// export of the main module as an entry point.

/** Bindings and variables from wrangler.jsonc. D1 fits SqlDatabase as it is. */
export interface WorkerEnv {
    readonly DB: SqlDatabase;
    readonly AUTH_MODE?: string;
    readonly DEMO_RESIDENT?: string;
    readonly LOG_LEVEL?: string;
    readonly NODE_ENV?: string;
}

type FetchHandler = (request: Request) => Promise<Response>;

let cached: { readonly env: WorkerEnv; readonly handler: FetchHandler } | undefined;

function buildHandler(env: WorkerEnv): FetchHandler {
    // Fails fast, before any traffic, if the configuration is unsafe.
    const config = loadConfig({
        AUTH_MODE: env.AUTH_MODE,
        DEMO_RESIDENT: env.DEMO_RESIDENT,
        LOG_LEVEL: env.LOG_LEVEL,
        NODE_ENV: env.NODE_ENV,
    });
    return createFetchHandler({
        logger: createLogger(config.logLevel),
        tools: createSqlDemoDeps(env.DB),
        authenticate: createDemoAuthenticator(
            DEMO_RESIDENTS.map((resident) => resident.id),
            config.demoResident,
        ),
    });
}

/**
 * Cloudflare Workers entry point. The handler is built once per isolate and
 * reused; all state lives in D1, so any isolate in any location can answer
 * any call.
 */
export default {
    fetch(request: Request, env: WorkerEnv): Promise<Response> {
        if (cached?.env !== env) {
            cached = { env, handler: buildHandler(env) };
        }
        return cached.handler(request);
    },
};
