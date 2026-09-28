export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Writes one JSON object per line to stdout. CloudWatch Logs indexes these
 * fields, so a single request line can be queried by status or latency.
 */
export function createLogger(minLevel: LogLevel, write: (line: string) => void = console.log): Logger {
    const log = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
        if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
            return;
        }
        write(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
    };
    return {
        debug: (message, fields) => log("debug", message, fields),
        info: (message, fields) => log("info", message, fields),
        warn: (message, fields) => log("warn", message, fields),
        error: (message, fields) => log("error", message, fields),
    };
}

/** A logger that drops everything. Handy in tests. */
export const SILENT_LOGGER: Logger = createLogger("error", () => {});
