import { z } from "zod";

const configSchema = z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // Only "demo" exists until OAuth lands. It trusts a header to pick the
    // resident, so it is for local runs and tests.
    AUTH_MODE: z.enum(["demo"]).default("demo"),
    DEMO_RESIDENT: z.string().min(1).optional(),
    NODE_ENV: z.string().optional(),
});

export interface Config {
    readonly port: number;
    readonly host: string;
    readonly logLevel: "debug" | "info" | "warn" | "error";
    readonly authMode: "demo";
    readonly demoResident: string | undefined;
}

/**
 * Reads the configuration from environment variables and fails fast on bad
 * input, so a misconfigured task never starts serving traffic.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const parsed = configSchema.parse(env);
    // The demo authenticator lets any caller pick any resident. Refusing to
    // start is the only safe answer if it is ever deployed by mistake.
    if (parsed.AUTH_MODE === "demo" && parsed.NODE_ENV === "production") {
        throw new Error("AUTH_MODE=demo trusts the caller and must not run with NODE_ENV=production.");
    }
    return {
        port: parsed.PORT,
        host: parsed.HOST,
        logLevel: parsed.LOG_LEVEL,
        authMode: parsed.AUTH_MODE,
        demoResident: parsed.DEMO_RESIDENT,
    };
}
