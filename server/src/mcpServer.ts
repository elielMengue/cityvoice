import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import type { Logger } from "./logger";
import { registerDraftReportTool } from "./tools/draftReport";
import { registerFindNearbyReportsTool } from "./tools/findNearbyReports";
import { registerGetMyReportsTool } from "./tools/getMyReports";
import { registerListServiceTypesTool } from "./tools/listServiceTypes";
import { registerPingTool } from "./tools/ping";
import { registerResolveLocationTool } from "./tools/resolveLocation";
import { registerSubmitReportTool } from "./tools/submitReport";
import { registerSupportReportTool } from "./tools/supportReport";
import type { Caller, ToolDeps } from "./tools/toolContext";

export const SERVER_NAME = "cityvoice";
export const SERVER_VERSION = "0.2.0";

/** Anything bigger than this is not a voice request. */
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

const INSTRUCTIONS =
    "CityVoice lets residents report non-emergency city problems (potholes, broken streetlights, missed trash, " +
    "graffiti and similar) and follow them up. To report: resolve_location, then list_service_types, then " +
    "find_nearby_reports. If a neighbor already reported it, offer support_report. Otherwise draft_report, ask any " +
    "missing questions, read the readback, and call submit_report only after the user says yes. " +
    "To follow up, get_my_reports. Each tool returns a speech field: say it as it is.";

export type McpFetch = (request: Request, authInfo: AuthInfo | undefined) => Promise<Response>;

/** The resident id rides in the verified token's extra claims. */
export function callerFrom(authInfo: AuthInfo | undefined): Caller {
    const residentId = authInfo?.extra?.["residentId"];
    return { residentId: typeof residentId === "string" ? residentId : undefined };
}

/** Builds a fresh MCP server, with every tool, for one caller. */
export function createMcpServer(deps: ToolDeps, caller: Caller): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    registerPingTool(server);
    registerResolveLocationTool(server, deps, caller);
    registerListServiceTypesTool(server, deps);
    registerFindNearbyReportsTool(server, deps, caller);
    registerDraftReportTool(server, deps, caller);
    registerSubmitReportTool(server, deps, caller);
    registerSupportReportTool(server, deps, caller);
    registerGetMyReportsTool(server, deps, caller);
    return server;
}

/**
 * Serves MCP over Streamable HTTP. The SDK builds one server per request, so
 * nothing survives between calls and any task behind the load balancer can
 * answer any request. Alexa+ speaks the 2025-11-25 revision, which the SDK
 * serves through its stateless legacy path, answering each call as a short
 * SSE stream that carries the single result.
 */
export function createMcpFetch(logger: Logger, deps: ToolDeps): McpFetch {
    const handler = createMcpHandler(({ authInfo }) => createMcpServer(deps, callerFrom(authInfo)), {
        legacy: "stateless",
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
        onerror: (error) => logger.warn("mcp request rejected", { error: error.message }),
    });
    return (request, authInfo) => handler.fetch(request, authInfo === undefined ? {} : { authInfo });
}
