import type { AuthInfo } from "@modelcontextprotocol/server";

/**
 * Decides who is calling. Returns undefined for an anonymous request. The
 * OAuth 2.1 bearer check plugs in here; until then the demo authenticator
 * stands in.
 */
export type Authenticator = (request: Request) => Promise<AuthInfo | undefined>;

export const DEMO_RESIDENT_HEADER = "x-cityvoice-demo-resident";

/**
 * For the local demo and the tests only: the resident is picked from a header,
 * or falls back to a default. It trusts the caller completely, so it must
 * never face the internet.
 */
export function createDemoAuthenticator(knownResidents: readonly string[], defaultResident?: string): Authenticator {
    return async (request) => {
        const requested = request.headers.get(DEMO_RESIDENT_HEADER) ?? defaultResident;
        if (requested === undefined || !knownResidents.includes(requested)) {
            return undefined;
        }
        return { token: "demo", clientId: "cityvoice-demo", scopes: [], extra: { residentId: requested } };
    };
}
