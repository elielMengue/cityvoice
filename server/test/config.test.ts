import { describe, expect, test } from "bun:test";

import { loadConfig } from "../src/config";

describe("loadConfig", () => {
    test("falls back to safe defaults", () => {
        expect(loadConfig({})).toEqual({
            port: 8080,
            host: "0.0.0.0",
            logLevel: "info",
            authMode: "demo",
            demoResident: undefined,
            publicUrl: undefined,
        });
    });

    test("reads values from the environment", () => {
        expect(loadConfig({ PORT: "3000", LOG_LEVEL: "debug", DEMO_RESIDENT: "maria" })).toMatchObject({
            port: 3000,
            logLevel: "debug",
            demoResident: "maria",
        });
    });

    test("rejects a port that is not a number", () => {
        expect(() => loadConfig({ PORT: "eighty" })).toThrow();
    });

    test("refuses to run the demo authenticator in production", () => {
        expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/must not run/);
    });

    test("OAuth needs the public address tokens are issued for", () => {
        expect(() => loadConfig({ AUTH_MODE: "oauth" })).toThrow(/PUBLIC_URL/);
        expect(loadConfig({ AUTH_MODE: "oauth", PUBLIC_URL: "https://cityvoice.example.com/" }).publicUrl).toBe(
            "https://cityvoice.example.com",
        );
    });

    test("OAuth is allowed in production", () => {
        expect(
            loadConfig({ AUTH_MODE: "oauth", PUBLIC_URL: "https://cityvoice.example.com", NODE_ENV: "production" })
                .authMode,
        ).toBe("oauth");
    });

    test("rejects an auth mode that does not exist", () => {
        expect(() => loadConfig({ AUTH_MODE: "none" })).toThrow();
    });
});
