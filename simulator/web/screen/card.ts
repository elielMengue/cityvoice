import type { TraceEntry } from "../api";
import { element, node } from "../dom";

/** The card under Alexa's answer. It shows what Alexa just said, never more. */

const card = element<HTMLDivElement>("card");

type Status = "open" | "progress" | "closed";

function statusBadge(status: Status): HTMLElement {
    const labels: Record<Status, string> = { open: "Waiting", progress: "In progress", closed: "Closed" };
    const badge = node("span", labels[status], "status");
    badge.dataset["status"] = status;
    return badge;
}

function reportItem(title: string, detail: string, status?: Status): HTMLElement {
    const item = node("li");
    if (status !== undefined) {
        item.append(statusBadge(status));
    }
    const text = node("div");
    text.append(node("div", title), node("div", detail, "detail"));
    item.append(text);
    return item;
}

/** What the screen shows for the last tool call. Everything shown was also said. */
export function renderCard(entries: readonly TraceEntry[]): void {
    card.replaceChildren();
    const last = [...entries].reverse().find((entry) => !entry.isError && entry.data !== undefined);
    const data = last?.data;
    if (last === undefined || data === undefined) {
        card.hidden = true;
        return;
    }
    const list = node("ul");

    if (last.tool === "get_my_reports") {
        for (const report of (data["reports"] as Record<string, string>[] | undefined) ?? []) {
            const status: Status =
                report["status"] === "closed"
                    ? "closed"
                    : (report["spoken_status"] ?? "").startsWith("is in progress")
                      ? "progress"
                      : "open";
            list.append(reportItem(report["service_name"] ?? "", report["address"] ?? "", status));
        }
    } else if (last.tool === "find_nearby_reports") {
        for (const report of (data["reports"] as Record<string, string | number>[] | undefined) ?? []) {
            const supporters = Number(report["supporters"]);
            list.append(
                reportItem(
                    String(report["service_name"]),
                    `${String(report["address"])}, ${supporters} ${supporters === 1 ? "neighbor" : "neighbors"}`,
                    "open",
                ),
            );
        }
    } else if (last.tool === "submit_report") {
        const id = String(data["request_id"] ?? "");
        card.append(node("div", "Request number ending", "detail"), node("div", id.slice(-4), "big"));
        card.hidden = false;
        return;
    } else if (last.tool === "draft_report" && data["ready"] === true) {
        card.append(node("div", String(data["readback"] ?? "")));
        card.hidden = false;
        return;
    } else if (last.tool === "resolve_location") {
        for (const candidate of (data["candidates"] as Record<string, string>[] | undefined) ?? []) {
            list.append(reportItem(candidate["address"] ?? "", ""));
        }
    }

    card.hidden = list.childElementCount === 0;
    if (!card.hidden) {
        card.append(list);
    }
}

export function clearCard(): void {
    card.replaceChildren();
    card.hidden = true;
}
