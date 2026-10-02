import type { TraceEntry, TurnResponse } from "./api";
import { element, node } from "./dom";

/** The "behind the scenes" drawer: every MCP call of every turn, newest first. */

const scenes = element<HTMLElement>("scenes");
const scenesToggle = element<HTMLButtonElement>("scenes-toggle");
const trace = element<HTMLOListElement>("trace");

let open311Url: string | undefined;

/** Where CityVoice's Open311 feed lives, so a filed report can be opened as a city would see it. */
export function setOpen311Url(url: string | undefined): void {
    open311Url = url;
}

/** A link to the report in the Open311 feed, for a report that was just filed. */
function recordLink(entry: TraceEntry): HTMLElement | undefined {
    const id = entry.data?.["request_id"];
    if (entry.tool !== "submit_report" || entry.isError || typeof id !== "string" || open311Url === undefined) {
        return undefined;
    }
    const link = document.createElement("a");
    link.className = "record-link";
    link.href = `${open311Url}/requests/${encodeURIComponent(id)}.json`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "View the Open311 record";
    return link;
}

export function renderTrace(utterance: string, response: TurnResponse): void {
    const turn = node("li", undefined, "turn");
    turn.append(node("div", `"${utterance}"`, "said-line"));
    const steps = response.steps ?? [];
    const models = [...new Set(steps.map((step) => step.model.replace(/^@cf\/[^/]+\//, "")))].join(", ");
    const stepTimes = steps.map((step) => `${step.ms}`).join(" + ");
    turn.append(
        node(
            "div",
            `${response.ms ?? 0} ms in total${models ? `; ${models}, ${steps.length} steps: ${stepTimes} ms` : ""}`,
            "meta",
        ),
    );
    for (const entry of response.trace ?? []) {
        const call = node("div", undefined, "call");
        call.dataset["error"] = String(entry.isError);
        call.append(node("span", entry.tool, "name"), document.createTextNode(` ${entry.ms} ms `));
        call.append(node("code", JSON.stringify(entry.args)));
        call.append(node("div", entry.speech, "muted"));
        const record = recordLink(entry);
        if (record !== undefined) {
            call.append(record);
        }
        turn.append(call);
    }
    trace.prepend(turn);
}

export function clearTrace(): void {
    trace.replaceChildren();
}

function setScenes(open: boolean): void {
    scenes.hidden = !open;
    scenesToggle.setAttribute("aria-expanded", String(open));
}

export function wireScenes(): void {
    scenesToggle.addEventListener("click", () => setScenes(scenesToggle.getAttribute("aria-expanded") !== "true"));
    element<HTMLButtonElement>("scenes-close").addEventListener("click", () => setScenes(false));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setScenes(false);
        }
    });
}
