import { describe, expect, test } from "bun:test";

import { escapeHtml, renderConsentPage } from "../src/auth/consentPage";
import { DEMO_ACCOUNTS } from "../src/cities/cities";

const details = {
    clientName: "Alexa",
    redirectHost: "pitangui.amazon.com",
    redirectIsLoopback: false,
};

describe("consent page", () => {
    test("names the client, where access goes, and every demo resident", () => {
        const html = renderConsentPage(details, "handle-1", DEMO_ACCOUNTS);

        expect(html).toContain("Link CityVoice to Alexa");
        expect(html).toContain("pitangui.amazon.com");
        for (const resident of DEMO_ACCOUNTS) {
            expect(html).toContain(`value="${resident.id}"`);
        }
        expect(html).toContain('name="handle" value="handle-1"');
        expect(html).toContain("3150 18th Street, San Francisco");
    });

    test("escapes a client name chosen by an attacker", () => {
        const html = renderConsentPage(
            { ...details, clientName: '<script>alert("x")</script>' },
            '"><img src=x>',
            DEMO_ACCOUNTS,
        );

        expect(html).not.toContain("<script>alert");
        expect(html).not.toContain("<img src=x>");
    });

    test("warns when access goes to an app on this computer", () => {
        const html = renderConsentPage({ ...details, redirectIsLoopback: true }, "h", DEMO_ACCOUNTS);

        expect(html).toContain("an app on this computer");
    });

    test("escapeHtml covers the five dangerous characters", () => {
        expect(escapeHtml(`&<>"'`)).toBe("&#38;&#60;&#62;&#34;&#39;");
    });
});
