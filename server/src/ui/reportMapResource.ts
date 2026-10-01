import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

import { TILES_PATH } from "../map/tileProxy";
import { REPORT_MAP_HTML, REPORT_MAP_URI } from "./generated/reportMap";

export { REPORT_MAP_URI };

/** Where the page reads its tile address; see ui/report-map/index.html. */
const TILES_PLACEHOLDER = "__CITYVOICE_TILES__";

/** Tells a tool's result to show the report map, for _meta on the tool. */
export const SHOWS_REPORT_MAP = { ui: { resourceUri: REPORT_MAP_URI } };

/**
 * The report map as an MCP Apps resource. Hosts with a screen render it next
 * to the answer. The page loads street tiles from this server, given as
 * origin, and nothing else, which is what its Content Security Policy allows.
 */
export function registerReportMapResource(server: McpServer, origin: string): void {
    const meta = { ui: { csp: { resourceDomains: [origin] }, prefersBorder: false } };
    const html = REPORT_MAP_HTML.replace(TILES_PLACEHOLDER, `${origin}${TILES_PATH}`);
    registerAppResource(
        server,
        "Report map",
        REPORT_MAP_URI,
        {
            description: "A map of city reports around a place, colored by status, for devices with a screen.",
            _meta: meta,
        },
        async () => ({
            contents: [{ uri: REPORT_MAP_URI, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: meta }],
        }),
    );
}
