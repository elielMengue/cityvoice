import { z } from "zod";

import { clearCookie, LOGIN_COOKIE, readCookie, SESSION_COOKIE, setCookie } from "./cookies";
import { Gemini, ModelUnavailableError } from "./gemini";
import { McpHttpClient, UnauthorizedError } from "./mcpClient";
import type { OAuthClientConfig, PendingLogin, Tokens } from "./oauthClient";
import { exchangeCode, refresh, startLogin } from "./oauthClient";
import type { Content, ToolDeclaration, ToolResult, ToolServer } from "./orchestrator";
import { runTurn } from "./orchestrator";

// Only the default export may be a value here: Workers treats every named
// export of the main module as an entry point.

interface Env {
    readonly ASSETS: { fetch(request: Request): Promise<Response> };
    readonly GEMINI_API_KEY: string;
    readonly GEMINI_MODELS: string;
    readonly CITYVOICE_URL: string;
    readonly CLIENT_ID: string;
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_MAX_AGE_SECONDS = 10 * 60;
const TOOL_LIST_TTL_MS = 5 * 60 * 1000;

const NOT_LINKED_SPEECH = "Link your CityVoice account first, with the button above the device.";
const MODEL_DOWN_SPEECH = "My connection to the language model is busy right now. Please try again in a moment.";

const tokensSchema = z.object({
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expiresAt: z.number(),
});
const pendingSchema = z.object({ state: z.string(), verifier: z.string() });
const partSchema = z.looseObject({});
const turnSchema = z.object({
    utterance: z.string().trim().min(1).max(500),
    history: z
        .array(z.object({ role: z.enum(["user", "model"]), parts: z.array(partSchema) }))
        .max(80)
        .default([]),
});

function oauthConfig(env: Env, request: Request): OAuthClientConfig {
    return {
        serverUrl: env.CITYVOICE_URL.replace(/\/+$/, ""),
        clientId: env.CLIENT_ID,
        redirectUri: new URL("/callback", request.url).toString(),
    };
}

function parseCookie<T>(request: Request, name: string, schema: z.ZodType<T>): T | undefined {
    const raw = readCookie(request, name);
    if (raw === undefined) {
        return undefined;
    }
    try {
        const parsed = schema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : undefined;
    } catch {
        return undefined;
    }
}

function redirect(location: string, cookies: string[] = []): Response {
    const headers = new Headers({ location });
    for (const cookie of cookies) {
        headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
}

// The tool list is the same for every resident, so one call per isolate every
// few minutes is enough. It saves two round trips on every turn.
let toolListCache: { at: number; value: { tools: readonly ToolDeclaration[]; instructions: string } } | undefined;

function withCachedToolList(server: ToolServer): ToolServer {
    return {
        listTools: async () => {
            if (toolListCache === undefined || Date.now() - toolListCache.at > TOOL_LIST_TTL_MS) {
                toolListCache = { at: Date.now(), value: await server.listTools() };
            }
            return toolListCache.value;
        },
        callTool: (name: string, args: Record<string, unknown>): Promise<ToolResult> => server.callTool(name, args),
    };
}

async function handleTurn(request: Request, env: Env): Promise<Response> {
    const parsed = turnSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
        return Response.json({ error: "Invalid turn" }, { status: 400 });
    }
    let tokens = parseCookie<Tokens>(request, SESSION_COOKIE, tokensSchema);
    if (tokens === undefined) {
        return Response.json({ speech: NOT_LINKED_SPEECH, linked: false }, { status: 401 });
    }
    const config = oauthConfig(env, request);
    const cookies: string[] = [];
    const renew = async (current: Tokens): Promise<Tokens | undefined> => {
        if (current.refreshToken === undefined) {
            return undefined;
        }
        const renewed = await refresh(config, current.refreshToken).catch(() => undefined);
        if (renewed !== undefined) {
            cookies.push(setCookie(SESSION_COOKIE, JSON.stringify(renewed), SESSION_MAX_AGE_SECONDS));
        }
        return renewed;
    };
    if (tokens.expiresAt - Date.now() < 60_000) {
        tokens = (await renew(tokens)) ?? tokens;
    }

    const model = new Gemini({
        apiKey: env.GEMINI_API_KEY,
        models: env.GEMINI_MODELS.split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
    });
    const play = (accessToken: string) =>
        runTurn(
            { model, tools: withCachedToolList(new McpHttpClient(`${config.serverUrl}/mcp`, accessToken)) },
            parsed.data.history as Content[],
            parsed.data.utterance,
        );

    const started = Date.now();
    try {
        let result;
        try {
            result = await play(tokens.accessToken);
        } catch (error) {
            if (!(error instanceof UnauthorizedError)) {
                throw error;
            }
            const renewed = await renew(tokens);
            if (renewed === undefined) {
                return Response.json(
                    { speech: NOT_LINKED_SPEECH, linked: false },
                    { status: 401, headers: { "set-cookie": clearCookie(SESSION_COOKIE) } },
                );
            }
            result = await play(renewed.accessToken);
        }
        const headers = new Headers();
        for (const cookie of cookies) {
            headers.append("set-cookie", cookie);
        }
        return Response.json({ ...result, linked: true, ms: Date.now() - started }, { headers });
    } catch (error) {
        const speech = error instanceof ModelUnavailableError ? MODEL_DOWN_SPEECH : "Something went wrong on my side.";
        console.error(JSON.stringify({ message: "turn failed", error: String(error) }));
        return Response.json({ speech, linked: true, error: true }, { status: 502 });
    }
}

async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const config = oauthConfig(env, request);

    if (url.pathname === "/login" && request.method === "GET") {
        const { url: authorizeUrl, pending } = await startLogin(config);
        return redirect(authorizeUrl, [setCookie(LOGIN_COOKIE, JSON.stringify(pending), LOGIN_MAX_AGE_SECONDS)]);
    }
    if (url.pathname === "/callback" && request.method === "GET") {
        const pending = parseCookie<PendingLogin>(request, LOGIN_COOKIE, pendingSchema);
        const code = url.searchParams.get("code");
        if (pending === undefined || code === null || url.searchParams.get("state") !== pending.state) {
            // Denied, expired, or not started here: go back without linking.
            return redirect("/", [clearCookie(LOGIN_COOKIE)]);
        }
        const tokens = await exchangeCode(config, code, pending);
        return redirect("/", [
            clearCookie(LOGIN_COOKIE),
            setCookie(SESSION_COOKIE, JSON.stringify(tokens), SESSION_MAX_AGE_SECONDS),
        ]);
    }
    if (url.pathname === "/logout" && request.method === "POST") {
        return redirect("/", [clearCookie(SESSION_COOKIE)]);
    }
    if (url.pathname === "/api/session" && request.method === "GET") {
        return Response.json({ linked: parseCookie(request, SESSION_COOKIE, tokensSchema) !== undefined });
    }
    if (url.pathname === "/api/turn" && request.method === "POST") {
        return handleTurn(request, env);
    }
    return env.ASSETS.fetch(request);
}

export default {
    fetch: route,
};
