import { z } from "zod";

const configSchema = z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // "demo" trusts a header to pick the resident: local runs and tests only.
    // "oauth" requires an access token issued after account linking.
    AUTH_MODE: z.enum(["demo", "oauth"]).default("demo"),
    DEMO_RESIDENT: z.string().min(1).optional(),
    // The address residents and Alexa reach the service at. Tokens are issued
    // for `${PUBLIC_URL}/mcp`, so it must be exact.
    PUBLIC_URL: z.url().optional(),
    // Dynamic client registration writes to KV on every call. It stays closed
    // unless someone opens it on purpose to register a new client.
    ALLOW_CLIENT_REGISTRATION: z.enum(["true", "false"]).default("false"),
    NODE_ENV: z.string().optional(),
});

export type AuthMode = "demo" | "oauth";

export interface Config {
    readonly port: number;
    readonly host: string;
    readonly logLevel: "debug" | "info" | "warn" | "error";
    readonly authMode: AuthMode;
    readonly demoResident: string | undefined;
    readonly publicUrl: string | undefined;
    readonly allowClientRegistration: boolean;
}

/**
 * Reads the configuration from environment variables and fails fast on bad
 * input, so a misconfigured server never starts serving traffic.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const parsed = configSchema.parse(env);
    // The demo authenticator lets any caller pick any resident. Refusing to
    // start is the only safe answer if it is ever deployed by mistake.
    if (parsed.AUTH_MODE === "demo" && parsed.NODE_ENV === "production") {
        throw new Error("AUTH_MODE=demo trusts the caller and must not run with NODE_ENV=production.");
    }
    if (parsed.AUTH_MODE === "oauth" && parsed.PUBLIC_URL === undefined) {
        throw new Error("AUTH_MODE=oauth needs PUBLIC_URL, the address tokens are issued for.");
    }
    return {
        port: parsed.PORT,
        host: parsed.HOST,
        logLevel: parsed.LOG_LEVEL,
        authMode: parsed.AUTH_MODE,
        demoResident: parsed.DEMO_RESIDENT,
        // Stored without a trailing slash so paths can be appended safely.
        publicUrl: parsed.PUBLIC_URL?.replace(/\/+$/, ""),
        allowClientRegistration: parsed.ALLOW_CLIENT_REGISTRATION === "true",
    };
}
