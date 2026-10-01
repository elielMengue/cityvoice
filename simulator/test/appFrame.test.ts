import { describe, expect, test } from "bun:test";

import { contentPolicy } from "../web/screen/appFrame";

describe("contentPolicy", () => {
    test("lets the page load only from the hosts its resource declared", () => {
        const policy = contentPolicy({
            html: "",
            resourceDomains: ["https://tile.openstreetmap.org"],
            connectDomains: [],
        });

        expect(policy).toBe(
            "default-src 'none'; script-src 'unsafe-inline' https://tile.openstreetmap.org; " +
                "style-src 'unsafe-inline' https://tile.openstreetmap.org; " +
                "img-src data: https://tile.openstreetmap.org; font-src https://tile.openstreetmap.org; " +
                "connect-src 'none'",
        );
    });

    test("allows no network at all when nothing was declared", () => {
        const policy = contentPolicy({ html: "", resourceDomains: [], connectDomains: [] });

        expect(policy).toContain("img-src data:;");
        expect(policy).toContain("font-src 'none'");
        expect(policy).toEndWith("connect-src 'none'");
    });
});
