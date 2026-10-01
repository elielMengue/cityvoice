import type { McpServer } from "@modelcontextprotocol/server";

/**
 * A ready-made question for the resident: what changed around home this
 * week. The words are the resident's; show_report_map's description tells
 * the model how to answer it.
 */
export const NEIGHBORHOOD_UPDATE_QUESTION = "What's new around my home this week?";

export function registerNeighborhoodUpdatePrompt(server: McpServer): void {
    server.registerPrompt(
        "neighborhood_update",
        {
            title: "Neighborhood update",
            description: "What was reported or fixed within a few blocks of the resident's home this week.",
        },
        () => ({
            messages: [{ role: "user", content: { type: "text", text: NEIGHBORHOOD_UPDATE_QUESTION } }],
        }),
    );
}
