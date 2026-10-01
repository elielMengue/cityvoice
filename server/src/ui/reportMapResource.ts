import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

import { TILE_HOSTS } from "../../ui/report-map/tiles";
import { REPORT_MAP_HTML, REPORT_MAP_URI } from "./generated/reportMap";

export { REPORT_MAP_URI };

/**
 * The report map as an MCP Apps resource. Hosts with a screen render it next
 * to the answer; the page loads street tiles from the hosts below and nothing
 * else, which is what its Content Security Policy allows.
 */
const REPORT_MAP_META = { ui: { csp: { resourceDomains: TILE_HOSTS }, prefersBorder: false } };

/** Tells a tool's result to show the report map, for _meta on the tool. */
export const SHOWS_REPORT_MAP = { ui: { resourceUri: REPORT_MAP_URI } };

export function registerReportMapResource(server: McpServer): void {
    registerAppResource(
        server,
        "Report map",
        REPORT_MAP_URI,
        {
            description: "A map of city reports around a place, colored by status, for devices with a screen.",
            _meta: REPORT_MAP_META,
        },
        async () => ({
            contents: [
                { uri: REPORT_MAP_URI, mimeType: RESOURCE_MIME_TYPE, text: REPORT_MAP_HTML, _meta: REPORT_MAP_META },
            ],
        }),
    );
}
