import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

describe("loadConfig", () => {
    test("falls back to safe defaults", () => {
        expect(loadConfig({})).toEqual({ port: 8080, host: "0.0.0.0", logLevel: "info" });
    });

    test("reads values from the environment", () => {
        expect(loadConfig({ PORT: "3000", LOG_LEVEL: "debug" })).toMatchObject({ port: 3000, logLevel: "debug" });
    });

    test("rejects a port that is not a number", () => {
        expect(() => loadConfig({ PORT: "eighty" })).toThrow();
    });
});
