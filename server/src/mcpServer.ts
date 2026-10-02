import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { forCity } from "./cities/cities";
import type { Logger } from "./logger";
import { registerNeighborhoodUpdatePrompt } from "./prompts/neighborhoodUpdate";
import { registerServicesResource } from "./resources/servicesResource";
import { registerDraftReportTool } from "./tools/draftReport";
import { registerFindNearbyReportsTool } from "./tools/findNearbyReports";
import { registerGetMyReportsTool } from "./tools/getMyReports";
import { registerListServiceTypesTool } from "./tools/listServiceTypes";
import { registerPingTool } from "./tools/ping";
import { registerResolveLocationTool } from "./tools/resolveLocation";
import { registerShowReportMapTool } from "./tools/showReportMap";
import { registerStartReportTool } from "./tools/startReport";
import { registerSubmitReportTool } from "./tools/submitReport";
import { registerSupportReportTool } from "./tools/supportReport";
import type { Caller, ToolDeps } from "./tools/toolContext";
import { registerReportMapResource } from "./ui/reportMapResource";

const SERVER_NAME = "cityvoice";
const SERVER_VERSION = "0.2.0";

/** Anything bigger than this is not a voice request. */
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

const INSTRUCTIONS =
    "CityVoice lets residents report non-emergency city problems (potholes, broken streetlights, missed trash, " +
    "graffiti and similar) and follow them up. To report, call start_report with the problem and the place in " +
    "the user's words. It screens for emergencies: if it says to call 911, say only that and stop. Otherwise " +
    "follow its next_step: support_report for a neighbor's report, draft_report for the user's answers, and " +
    "submit_report only after the user says yes. The other tools are for corrections. To follow up, " +
    "get_my_reports. To show reports on a screen, show_report_map. Each tool returns a speech field: say it as it is.";

export type McpFetch = (request: Request, authInfo: AuthInfo | undefined) => Promise<Response>;

/** The resident id rides in the verified token's extra claims. */
function callerFrom(authInfo: AuthInfo | undefined): Caller {
    const residentId = authInfo?.extra?.["residentId"];
    return { residentId: typeof residentId === "string" ? residentId : undefined };
}

/** The caller's city decides which places and which area the tools work with. */
async function depsForCaller(deps: ToolDeps, caller: Caller): Promise<ToolDeps> {
    const resident = caller.residentId === undefined ? undefined : await deps.residents.getResident(caller.residentId);
    return forCity(deps, resident?.city ?? "washington-dc");
}

/**
 * Builds a fresh MCP server, with every tool, for one caller. The origin is
 * where the request arrived, so the map page loads its tiles from the same
 * server that sent it.
 */
function createMcpServer(deps: ToolDeps, caller: Caller, origin: string): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
    registerPingTool(server);
    registerStartReportTool(server, deps, caller);
    registerResolveLocationTool(server, deps, caller);
    registerListServiceTypesTool(server, deps);
    registerFindNearbyReportsTool(server, deps, caller);
    registerDraftReportTool(server, deps, caller);
    registerSubmitReportTool(server, deps, caller);
    registerSupportReportTool(server, deps, caller);
    registerGetMyReportsTool(server, deps, caller);
    registerShowReportMapTool(server, deps, caller);
    registerReportMapResource(server, origin);
    registerServicesResource(server);
    registerNeighborhoodUpdatePrompt(server);
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
    const handler = createMcpHandler(
        async ({ authInfo, requestInfo }) => {
            const caller = callerFrom(authInfo);
            const origin = new URL(requestInfo?.url ?? "http://localhost").origin;
            return createMcpServer(await depsForCaller(deps, caller), caller, origin);
        },
        {
            legacy: "stateless",
            maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
            onerror: (error) => logger.warn("mcp request rejected", { error: error.message }),
        },
    );
    return (request, authInfo) => handler.fetch(request, authInfo === undefined ? {} : { authInfo });
}
