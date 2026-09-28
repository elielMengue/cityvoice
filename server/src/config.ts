import { z } from "zod";

const configSchema = z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface Config {
    readonly port: number;
    readonly host: string;
    readonly logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * Reads the configuration from environment variables and fails fast on bad
 * input, so a misconfigured task never starts serving traffic.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const parsed = configSchema.parse(env);
    return {
        port: parsed.PORT,
        host: parsed.HOST,
        logLevel: parsed.LOG_LEVEL,
    };
}
