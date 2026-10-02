/**
 * Registers an OAuth client with CityVoice, for a client that cannot register
 * itself. Alexa+ is one: it does not support dynamic registration, and wants
 * a confidential client with a secret and its own redirect URIs.
 *
 * Registration is closed in production. Open it for one deploy, run this,
 * then deploy again with it closed; docs/alexa-addon.md has the steps.
 *
 * Usage:
 *   bun scripts/registerClient.ts <server-url> --name "Alexa+" --redirect <uri> [--redirect <uri> ...] [--public]
 *
 * The client secret is printed once and stored nowhere else: CityVoice keeps
 * only its hash. Give it to the Alexa AI CLI at its masked prompt.
 */
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        name: { type: "string" },
        redirect: { type: "string", multiple: true },
        public: { type: "boolean", default: false },
    },
});

const [serverUrl] = positionals;
const redirects = values.redirect ?? [];
if (serverUrl === undefined || values.name === undefined || redirects.length === 0) {
    console.error(
        'Usage: bun scripts/registerClient.ts <server-url> --name "Alexa+" --redirect <uri> [--redirect <uri> ...]',
    );
    process.exit(2);
}
/** https everywhere, except back to this machine, where a local simulator listens on plain http. */
function isAllowedRedirect(uri: string): boolean {
    if (!URL.canParse(uri)) {
        return false;
    }
    const { protocol, hostname } = new URL(uri);
    return protocol === "https:" || (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1"));
}

if (!redirects.every(isAllowedRedirect)) {
    console.error("Every redirect URI must be an https URL, or http on localhost.");
    process.exit(2);
}

const metadata = (await (await fetch(new URL("/.well-known/oauth-authorization-server", serverUrl))).json()) as {
    registration_endpoint?: string;
};
if (metadata.registration_endpoint === undefined) {
    console.error(
        "Client registration is closed on this server. Deploy once with ALLOW_CLIENT_REGISTRATION set to true.",
    );
    process.exit(1);
}

const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        client_name: values.name,
        redirect_uris: redirects,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: values.public ? "none" : "client_secret_basic",
    }),
});
const client = (await response.json()) as { client_id?: string; client_secret?: string; error_description?: string };
if (!response.ok || client.client_id === undefined) {
    console.error(`Registration failed (${response.status}): ${client.error_description ?? "no details"}`);
    process.exit(1);
}

console.log(`client_id      ${client.client_id}`);
if (client.client_secret !== undefined) {
    console.log(`client_secret  ${client.client_secret}`);
    console.log("\nKeep the secret somewhere safe now: it cannot be shown again.");
}
// Locally, registration stays open on purpose; online it must be closed again.
if (!["localhost", "127.0.0.1"].includes(new URL(serverUrl).hostname)) {
    console.log("Close registration again: deploy with ALLOW_CLIENT_REGISTRATION set to false.");
}
