/** What the simulator's own server answers. The shapes mirror src/worker.ts. */

export interface TraceEntry {
    readonly tool: string;
    readonly args: Record<string, unknown>;
    readonly isError: boolean;
    readonly speech: string;
    readonly data?: Record<string, unknown>;
    readonly ms: number;
}

export interface TurnResponse {
    readonly speech: string;
    readonly history?: unknown[];
    readonly trace?: TraceEntry[];
    readonly steps?: { readonly model: string; readonly ms: number }[];
    readonly ms?: number;
    readonly linked?: boolean;
}

export async function postTurn(utterance: string, history: readonly unknown[]): Promise<TurnResponse> {
    const response = await fetch("/api/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance, history }),
    });
    return (await response.json()) as TurnResponse;
}

export async function getSession(): Promise<{ readonly linked: boolean }> {
    return (await (await fetch("/api/session")).json()) as { linked: boolean };
}
