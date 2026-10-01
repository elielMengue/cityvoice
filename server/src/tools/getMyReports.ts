import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { findServiceType } from "../catalog/serviceCatalog";
import { pinFor, reportMapSchema } from "../map/reportMap";
import type { ServiceRequest } from "../open311/types";
import type { ReportRole } from "../residents/residentStore";
import { ageInWords, capitalized, countOf, numberWord } from "../speech/speech";
import { SHOWS_REPORT_MAP } from "../ui/reportMapResource";
import type { Caller, ToolDeps } from "./toolContext";
import { resolveResident } from "./toolContext";
import { toolFailure, toolSuccess } from "./toolResult";

const GET_MY_REPORTS_TOOL = "get_my_reports";

/**
 * Three reports fit in one spoken answer under 60 words. The page holds
 * exactly what is said, so the screen never shows more than Alexa read out.
 */
const REPORTS_PER_PAGE = 3;

const statusFilterSchema = z.enum(["open", "closed", "all"]);
type StatusFilter = z.infer<typeof statusFilterSchema>;

const outputSchema = z.object({
    speech: z.string(),
    data: z.object({
        reports: z.array(
            z.object({
                request_id: z.string(),
                service_name: z.string(),
                address: z.string(),
                status: z.enum(["open", "closed"]),
                spoken_status: z.string(),
                my_role: z.enum(["author", "supporter"]),
                supporters: z.number(),
                requested_datetime: z.string(),
                updated_datetime: z.string().optional(),
                lat: z.number(),
                lng: z.number(),
            }),
        ),
        total: z.number(),
        next_cursor: z.string().optional(),
        /** The same reports, for screens. */
        map: reportMapSchema,
    }),
});

/** "is in progress: a crew has been assigned", "was closed today", "is still waiting for the city". */
function spokenStatus(request: ServiceRequest, now: Date): string {
    const updated = new Date(request.updated_datetime ?? request.requested_datetime);
    if (request.status === "closed") {
        return `was closed ${ageInWords(updated, now)}`;
    }
    const notes = request.status_notes?.trim().replace(/\.$/, "");
    if (notes !== undefined && notes.length > 0) {
        return `is in progress: ${notes.charAt(0).toLowerCase()}${notes.slice(1)}`;
    }
    return `is still waiting for the city, filed ${ageInWords(new Date(request.requested_datetime), now)}`;
}

function sentenceFor(report: { service_name: string; address: string; spoken_status: string; my_role: ReportRole }) {
    const subject =
        report.my_role === "supporter"
            ? `The ${report.service_name} you support at ${report.address}`
            : `The ${report.service_name} at ${report.address}`;
    return `${subject} ${report.spoken_status}.`;
}

function decodeCursor(cursor: string | undefined): number | undefined {
    if (cursor === undefined) {
        return 0;
    }
    const offset = Number(cursor);
    return Number.isInteger(offset) && offset >= 0 ? offset : undefined;
}

function matchesFilter(request: ServiceRequest, filter: StatusFilter): boolean {
    return filter === "all" || request.status === filter;
}

export function registerGetMyReportsTool(server: McpServer, deps: ToolDeps, caller: Caller): void {
    registerAppTool(
        server,
        GET_MY_REPORTS_TOOL,
        {
            title: "Get my reports",
            description:
                "Tells the user where their city reports stand, without needing a request number. " +
                'Use it for "what\'s happening with my reports?", "did they fix the pothole?", ' +
                '"any news on my requests?". Covers reports the user filed and reports they support, ' +
                "most recently updated first, three at a time. If next_cursor is set, offer to read more " +
                "and call again with that cursor.",
            inputSchema: z.object({
                status: statusFilterSchema
                    .nullish()
                    // An unknown value reads as "all" rather than failing the call.
                    .catch(undefined)
                    .describe(
                        'Which reports: "open" (still being handled, pending, in progress), ' +
                            '"closed" (fixed, done, resolved) or "all". Defaults to all.',
                    ),
                cursor: z.string().nullish().describe("The next_cursor from the previous answer, to hear more."),
            }),
            outputSchema,
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
            _meta: SHOWS_REPORT_MAP,
        },
        async (args) => {
            const status = args.status ?? "all";
            const cursor = args.cursor ?? undefined;
            const found = await resolveResident(deps, caller);
            if ("failure" in found) {
                return found.failure;
            }
            const offset = decodeCursor(cursor);
            if (offset === undefined) {
                return toolFailure("I lost my place in your list. Ask me again for your reports.");
            }

            const links = await deps.residents.listReports(found.resident.id);
            const requests = await deps.open311.getRequests(links.map((link) => link.requestId));
            const roleOf = new Map(links.map((link) => [link.requestId, link.role]));
            const now = deps.now();

            const matching = requests
                .filter((request) => matchesFilter(request, status))
                .sort((a, b) =>
                    (b.updated_datetime ?? b.requested_datetime).localeCompare(
                        a.updated_datetime ?? a.requested_datetime,
                    ),
                );
            const pageRequests = matching.slice(offset, offset + REPORTS_PER_PAGE);
            const nameOf = (request: ServiceRequest) =>
                findServiceType(request.service_code)?.name ?? request.service_name;
            const page = pageRequests.map((request) => ({
                request_id: request.service_request_id,
                service_name: nameOf(request),
                address: request.address ?? "an unknown address",
                status: request.status,
                spoken_status: spokenStatus(request, now),
                my_role: roleOf.get(request.service_request_id) ?? ("author" as const),
                supporters: request.supporters,
                requested_datetime: request.requested_datetime,
                ...(request.updated_datetime === undefined ? {} : { updated_datetime: request.updated_datetime }),
                lat: request.lat,
                lng: request.long,
            }));
            const nextOffset = offset + page.length;
            const hasMore = nextOffset < matching.length;
            const data = {
                reports: page,
                total: matching.length,
                ...(hasMore ? { next_cursor: String(nextOffset) } : {}),
                map: { pins: pageRequests.map((request) => pinFor(request, nameOf(request), true)) },
            };

            const kind = status === "all" ? "report" : `${status} report`;
            if (matching.length === 0) {
                return toolSuccess({ speech: `You don't have any ${kind}s right now.`, data });
            }
            if (page.length === 0) {
                return toolSuccess({ speech: "That's all of them.", data });
            }

            const intro = offset === 0 ? `You have ${countOf(matching.length, kind)}. ` : "";
            const remaining = matching.length - nextOffset;
            const more = !hasMore
                ? ""
                : remaining === 1
                  ? " There is one more. Want to hear it?"
                  : ` There are ${numberWord(remaining)} more. Want to hear them?`;
            return toolSuccess({
                speech: capitalized(`${intro}${page.map(sentenceFor).join(" ")}${more}`),
                data,
            });
        },
    );
}
