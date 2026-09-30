/**
 * Cookies that page scripts cannot read (HttpOnly), that only travel over
 * HTTPS (Secure; browsers also allow it on localhost), and that other sites
 * cannot send (SameSite=Lax).
 */

export const SESSION_COOKIE = "cv_session";
export const LOGIN_COOKIE = "cv_login";

export function readCookie(request: Request, name: string): string | undefined {
    const header = request.headers.get("cookie") ?? "";
    for (const pair of header.split(";")) {
        const [key, ...rest] = pair.trim().split("=");
        if (key === name) {
            return decodeURIComponent(rest.join("="));
        }
    }
    return undefined;
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name: string): string {
    return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
