import { describe, expect, test } from "bun:test";

import { allowed, visitorKey } from "../src/limits";

const request = new Request("https://simulator.example/api/turn", { headers: { "cf-connecting-ip": "198.51.100.4" } });

describe("visitorKey", () => {
    test("counts a linked visitor per link, whatever the token's secret part", () => {
        expect(visitorKey("maria:grant7:secretA", request)).toBe("link:maria:grant7");
        expect(visitorKey("maria:grant7:secretB", request)).toBe("link:maria:grant7");
    });

    test("counts anyone else per address", () => {
        expect(visitorKey(undefined, request)).toBe("ip:198.51.100.4");
    });
});

describe("allowed", () => {
    test("follows the binding's answer", async () => {
        expect(await allowed({ limit: async () => ({ success: true }) }, "k")).toBe(true);
        expect(await allowed({ limit: async () => ({ success: false }) }, "k")).toBe(false);
    });

    test("never blocks when there is no binding", async () => {
        expect(await allowed(undefined, "k")).toBe(true);
    });
});
