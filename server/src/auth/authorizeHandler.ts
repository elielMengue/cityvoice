import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";

import type { ResidentStore } from "../residents/residentStore";
import type { DemoAccount } from "./consentPage";
import { escapeHtml, renderConsentPage } from "./consentPage";

/** The one scope CityVoice grants: file, support and follow reports. */
export const REPORTS_SCOPE = "reports";

/** What the access token carries. The tools read the resident from here, never from their arguments. */
export interface TokenProps {
    readonly residentId: string;
}

export interface AuthorizeDeps {
    readonly oauth: OAuthHelpers;
    readonly residents: ResidentStore;
    readonly accounts: readonly DemoAccount[];
}

function textResponse(status: number, message: string): Response {
    return new Response(escapeHtml(message), {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
    });
}

async function showConsent({ oauth, accounts }: AuthorizeDeps, request: Request): Promise<Response> {
    const authRequest = await oauth.parseAuthRequest(request);
    // Describe first: a failed lookup must not leave a consent record behind.
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    consent.headers.set("content-type", "text/html; charset=utf-8");
    return new Response(renderConsentPage(details, consent.handle, accounts), { headers: consent.headers });
}

async function decide({ oauth, residents }: AuthorizeDeps, request: Request): Promise<Response> {
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
    }
    const resident = await residents.getResident(String(form.get("resident") ?? ""));
    if (resident === undefined) {
        return textResponse(400, "Please pick one of the demo residents and try again.");
    }

    const approved = await oauth.approveConsent(request, handle, { scope: [REPORTS_SCOPE] });
    const props: TokenProps = { residentId: resident.id };
    const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: resident.id,
        metadata: { residentName: resident.name },
        scope: approved.request.scope,
        props,
    });
    approved.headers.set("location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
}

/**
 * Serves /authorize: GET shows the consent page, POST records the decision.
 * The library keeps the authorization request server-side between the two;
 * the form only carries a one-time handle bound to this browser.
 */
export async function handleAuthorize(deps: AuthorizeDeps, request: Request): Promise<Response> {
    try {
        if (request.method === "GET") {
            return await showConsent(deps, request);
        }
        if (request.method === "POST") {
            return await decide(deps, request);
        }
        return textResponse(405, "Method not allowed.");
    } catch (error) {
        // Redirect only when the library has validated the client and its redirect URI.
        if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
            return Response.redirect(error.redirectTo, 302);
        }
        if (error instanceof AuthorizationError) {
            return textResponse(400, `${error.description} Please start again from the app.`);
        }
        if (error instanceof CimdFetchError) {
            return textResponse(400, "This app could not be verified. Please start again from the app.");
        }
        throw error;
    }
}
