import { MCP_PATH } from "./httpServer";

/**
 * Sends one real MCP call through the handler before the server opens its
 * port. The SDK loads parts of itself on first use, which costs a few hundred
 * milliseconds. Paying that at startup keeps the first resident's request
 * inside the 500 ms budget.
 */
export async function warmUp(fetchHandler: (request: Request) => Promise<Response>): Promise<void> {
    const response = await fetchHandler(
        new Request(`http://localhost${MCP_PATH}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-protocol-version": "2025-11-25",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list", params: {} }),
        }),
    );
    // Drain the body so the per-request server is closed cleanly.
    await response.text();
    if (!response.ok) {
        throw new Error(`Warm-up call failed with status ${response.status}`);
    }
}
