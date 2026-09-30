import type { FetchLike } from "./boundFetch";
import { boundFetch } from "./boundFetch";

/**
 * The simulator links to CityVoice the way the Alexa app does: OAuth 2.1
 * authorization code with PKCE and a resource indicator. The exchange happens
 * on the server, so tokens never reach page scripts.
 */

export interface OAuthClientConfig {
    /** CityVoice, for example https://cityvoice.demop.workers.dev */
    readonly serverUrl: string;
    readonly clientId: string;
    /** This simulator's /callback address, registered with the client. */
    readonly redirectUri: string;
}

export interface Tokens {
    readonly accessToken: string;
    readonly refreshToken?: string;
    /** Epoch milliseconds. */
    readonly expiresAt: number;
}

export interface PendingLogin {
    readonly state: string;
    readonly verifier: string;
}

function base64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(): string {
    return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function resourceFor(config: OAuthClientConfig): string {
    return `${config.serverUrl}/mcp`;
}

/** Builds the authorize URL and the secrets to keep until the resident comes back. */
export async function startLogin(config: OAuthClientConfig): Promise<{ url: string; pending: PendingLogin }> {
    const pending = { state: randomString(), verifier: randomString() };
    const challenge = base64Url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pending.verifier))),
    );
    const url = new URL(`${config.serverUrl}/authorize`);
    url.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: "reports",
        state: pending.state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: resourceFor(config),
    }).toString();
    return { url: url.toString(), pending };
}

interface TokenResponse {
    readonly access_token?: string;
    readonly refresh_token?: string;
    readonly expires_in?: number;
    readonly error?: string;
}

async function requestTokens(
    config: OAuthClientConfig,
    body: Record<string, string>,
    fetchImpl: FetchLike,
): Promise<Tokens> {
    const response = await fetchImpl(`${config.serverUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: config.clientId, resource: resourceFor(config), ...body }).toString(),
        signal: AbortSignal.timeout(5_000),
    });
    const json = (await response.json()) as TokenResponse;
    if (!response.ok || json.access_token === undefined) {
        throw new Error(`Token request failed: ${json.error ?? response.status}`);
    }
    return {
        accessToken: json.access_token,
        ...(json.refresh_token === undefined ? {} : { refreshToken: json.refresh_token }),
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
}

export function exchangeCode(
    config: OAuthClientConfig,
    code: string,
    pending: PendingLogin,
    fetchImpl: FetchLike = boundFetch,
): Promise<Tokens> {
    return requestTokens(
        config,
        { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: pending.verifier },
        fetchImpl,
    );
}

export function refresh(
    config: OAuthClientConfig,
    refreshToken: string,
    fetchImpl: FetchLike = boundFetch,
): Promise<Tokens> {
    return requestTokens(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}
