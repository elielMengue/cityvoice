/**
 * Walks through account linking the way Alexa+ does, against a running
 * server, and checks every step. Works on `bun run worker:dev:oauth` and on
 * the deployed Worker.
 *
 *   bun scripts/oauthSmoke.ts http://localhost:8790
 *
 * Exits with code 1 on the first failed check.
 */

const baseUrl = (process.argv[2] ?? "http://localhost:8790").replace(/\/+$/, "");
const REDIRECT_URI = "http://localhost:9876/callback";
const RESIDENT = "maria";

function check(condition: unknown, message: string): asserts condition {
    if (!condition) {
        console.error(`FAIL  ${message}`);
        process.exit(1);
    }
    console.log(`ok    ${message}`);
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
    return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");
}

async function mcpCall(token: string | undefined, name: string, args: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
    };
    if (token !== undefined) {
        headers["authorization"] = `Bearer ${token}`;
    }
    return fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
}

// 1. Without a token, the server must refuse and say where to authenticate.
const anonymous = await mcpCall(undefined, "ping", {});
check(anonymous.status === 401, `unauthenticated MCP call is refused with 401 (got ${anonymous.status})`);
const challenge = anonymous.headers.get("www-authenticate") ?? "";
check(challenge.includes("resource_metadata"), "the 401 challenge points at the protected resource metadata");

// 2. Discovery, as an MCP client does it.
const resource = (await (await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`)).json()) as {
    resource: string;
    authorization_servers: string[];
};
check(resource.resource === `${baseUrl}/mcp`, `protected resource metadata names ${baseUrl}/mcp`);
const server = (await (await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)).json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    code_challenge_methods_supported: string[];
};
check(server.code_challenge_methods_supported.includes("S256"), "the authorization server supports PKCE S256");

// 3. Register a client.
const registration = (await (
    await fetch(server.registration_endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client_name: "CityVoice smoke test",
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: "none",
        }),
    })
).json()) as { client_id: string };
check(typeof registration.client_id === "string", "a public client can register");

// 4. Authorize with PKCE and the resource indicator.
const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
const challengeValue = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
const authorizeUrl = new URL(server.authorization_endpoint);
authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: REDIRECT_URI,
    scope: "reports",
    state: "smoke-state",
    code_challenge: challengeValue,
    code_challenge_method: "S256",
    resource: `${baseUrl}/mcp`,
}).toString();
const consentPage = await fetch(authorizeUrl, { redirect: "manual" });
const html = await consentPage.text();
check(consentPage.status === 200 && html.includes("Link CityVoice"), "the consent page is shown");
check(
    (consentPage.headers.get("content-security-policy") ?? "").includes("frame-ancestors") ||
        consentPage.headers.get("x-frame-options") !== null,
    "the consent page cannot be framed by another site",
);
const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
check(handle !== undefined, "the consent form carries a one-time handle");
const cookies = consentPage.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

// 5. Approve as Maria.
const decision = await fetch(authorizeUrl, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
    body: new URLSearchParams({ handle, decision: "approve", resident: RESIDENT }).toString(),
});
const location = decision.headers.get("location") ?? "";
check(decision.status === 302 && location.startsWith(REDIRECT_URI), "approving redirects back to the client");
const callback = new URL(location);
check(callback.searchParams.get("state") === "smoke-state", "the state comes back unchanged");
const code = callback.searchParams.get("code");
check(code !== null, "an authorization code is issued");

// 6. Exchange the code, proving possession of the PKCE verifier.
const tokens = (await (
    await fetch(server.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
            client_id: registration.client_id,
            code_verifier: verifier,
            resource: `${baseUrl}/mcp`,
        }).toString(),
    })
).json()) as { access_token?: string; refresh_token?: string };
check(typeof tokens.access_token === "string", "the code is exchanged for an access token");
check(typeof tokens.refresh_token === "string", "a refresh token is issued, so linking lasts");

// 7. The token acts as Maria, and only as Maria.
const started = performance.now();
const reports = await mcpCall(tokens.access_token, "resolve_location", { spoken_place: "my house" });
const elapsed = Math.round(performance.now() - started);
const body = await reports.text();
check(reports.status === 200, "an MCP call with the token is accepted");
check(body.includes("1421 Columbia Road"), "the tools see the resident chosen on the consent page");
console.log(`info  round trip ${elapsed} ms`);

const forged = await mcpCall(`${tokens.access_token}x`, "ping", {});
check(forged.status === 401, "a tampered token is refused");

// 8. Demo accounts are shared by every judge: a second link as the same
// resident must not log the first one out.
async function linkAgain(): Promise<string | undefined> {
    const secondVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const secondUrl = new URL(authorizeUrl);
    secondUrl.searchParams.set(
        "code_challenge",
        base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secondVerifier))),
    );
    const page = await fetch(secondUrl, { redirect: "manual" });
    const secondHandle = /name="handle" value="([^"]+)"/.exec(await page.text())?.[1] ?? "";
    const secondCookies = page.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; ");
    const approved = await fetch(secondUrl, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: secondCookies },
        body: new URLSearchParams({ handle: secondHandle, decision: "approve", resident: RESIDENT }).toString(),
    });
    const secondCode = new URL(approved.headers.get("location") ?? REDIRECT_URI).searchParams.get("code") ?? "";
    const exchanged = (await (
        await fetch(server.token_endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: secondCode,
                redirect_uri: REDIRECT_URI,
                client_id: registration.client_id,
                code_verifier: secondVerifier,
                resource: `${baseUrl}/mcp`,
            }).toString(),
        })
    ).json()) as { access_token?: string };
    return exchanged.access_token;
}
const secondToken = await linkAgain();
check(typeof secondToken === "string", "a second person can link as the same demo resident");
const firstStillWorks = await mcpCall(tokens.access_token, "ping", {});
check(firstStillWorks.status === 200, "the first link keeps working after the second one");

console.log("\nAccount linking works end to end.");
