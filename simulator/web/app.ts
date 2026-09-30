/**
 * The browser side of the simulator: microphone, voice, the Echo Show screen
 * and the "behind the scenes" panel. The conversation lives here and is sent
 * with every turn, so the server keeps nothing between turns.
 */

interface TraceEntry {
    readonly tool: string;
    readonly args: Record<string, unknown>;
    readonly isError: boolean;
    readonly speech: string;
    readonly data?: Record<string, unknown>;
    readonly ms: number;
}

interface TurnResponse {
    readonly speech: string;
    readonly history?: unknown[];
    readonly trace?: TraceEntry[];
    readonly models?: string[];
    readonly ms?: number;
    readonly linked?: boolean;
}

// The Web Speech API is not in TypeScript's DOM types yet.
interface RecognitionResultEvent {
    readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }> & { readonly isFinal: boolean }>;
}
interface Recognition {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: RecognitionResultEvent) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    start(): void;
    stop(): void;
}
type RecognitionConstructor = new () => Recognition;

function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (found === null) {
        throw new Error(`Missing #${id}`);
    }
    return found as T;
}

const speechText = element<HTMLParagraphElement>("speech");
const card = element<HTMLDivElement>("card");
const lightBar = element<HTMLDivElement>("light-bar");
const trace = element<HTMLOListElement>("trace");
const mic = element<HTMLButtonElement>("mic");
const hint = element<HTMLParagraphElement>("hint");
const textForm = element<HTMLFormElement>("text-form");
const textInput = element<HTMLInputElement>("text-input");

let history: unknown[] = [];
let busy = false;

function setLight(state: "idle" | "listening" | "thinking" | "speaking"): void {
    lightBar.dataset["state"] = state;
}

function node(tag: string, text?: string, className?: string): HTMLElement {
    const created = document.createElement(tag);
    if (text !== undefined) {
        created.textContent = text;
    }
    if (className !== undefined) {
        created.className = className;
    }
    return created;
}

/* ---------- Voice out ---------- */

function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
        if (!("speechSynthesis" in window)) {
            resolve();
            return;
        }
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        const voice = speechSynthesis.getVoices().find((candidate) => candidate.lang === "en-US");
        if (voice !== undefined) {
            utterance.voice = voice;
        }
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        setLight("speaking");
        speechSynthesis.speak(utterance);
    });
}

/* ---------- The screen ---------- */

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
function renderCard(entries: readonly TraceEntry[]): void {
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

/* ---------- Behind the scenes ---------- */

function renderTrace(utterance: string, response: TurnResponse): void {
    const turn = node("li", undefined, "turn");
    turn.append(node("div", `"${utterance}"`, "said"));
    const models = [...new Set(response.models ?? [])].join(", ");
    turn.append(node("div", `${response.ms ?? 0} ms in total${models ? `, model: ${models}` : ""}`, "meta"));
    for (const entry of response.trace ?? []) {
        const call = node("div", undefined, "call");
        call.dataset["error"] = String(entry.isError);
        call.append(node("span", entry.tool, "name"), document.createTextNode(` ${entry.ms} ms `));
        call.append(node("code", JSON.stringify(entry.args)));
        call.append(node("div", entry.speech, "muted"));
        turn.append(call);
    }
    trace.prepend(turn);
}

/* ---------- A turn ---------- */

async function sendTurn(utterance: string): Promise<void> {
    if (busy || utterance.trim().length === 0) {
        return;
    }
    busy = true;
    setLight("thinking");
    speechText.textContent = "...";
    try {
        const response = await fetch("/api/turn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ utterance, history }),
        });
        const result = (await response.json()) as TurnResponse;
        if (result.history !== undefined) {
            history = result.history;
        }
        if (result.linked === false) {
            void refreshAccount();
        }
        speechText.textContent = result.speech;
        renderCard(result.trace ?? []);
        renderTrace(utterance, result);
        await speak(result.speech);
    } catch {
        speechText.textContent = "I couldn't reach the simulator. Check your connection and try again.";
    } finally {
        busy = false;
        setLight("idle");
    }
}

/* ---------- Voice in ---------- */

const RecognitionClass =
    (
        window as unknown as {
            SpeechRecognition?: RecognitionConstructor;
            webkitSpeechRecognition?: RecognitionConstructor;
        }
    ).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: RecognitionConstructor }).webkitSpeechRecognition;

let recognition: Recognition | undefined;

function listen(): void {
    if (RecognitionClass === undefined) {
        hint.textContent = "This browser has no speech recognition. Type instead, or use Chrome or Edge.";
        return;
    }
    if (recognition !== undefined) {
        recognition.stop();
        return;
    }
    speechSynthesis.cancel();
    const current = new RecognitionClass();
    recognition = current;
    current.lang = "en-US";
    current.interimResults = true;
    current.continuous = false;
    let finalText = "";
    current.onresult = (event) => {
        const parts = Array.from(event.results);
        finalText = parts
            .filter((result) => result.isFinal)
            .map((result) => result[0]?.transcript ?? "")
            .join(" ");
        speechText.textContent = parts.map((result) => result[0]?.transcript ?? "").join(" ");
    };
    current.onerror = (event) => {
        hint.textContent =
            event.error === "not-allowed"
                ? "The microphone is blocked. Allow it in the address bar, or type instead."
                : "I didn't catch that. Try again, or type instead.";
    };
    current.onend = () => {
        recognition = undefined;
        mic.setAttribute("aria-pressed", "false");
        setLight("idle");
        if (finalText.trim().length > 0) {
            void sendTurn(finalText.trim());
        }
    };
    mic.setAttribute("aria-pressed", "true");
    setLight("listening");
    current.start();
}

/* ---------- Account ---------- */

async function refreshAccount(): Promise<void> {
    const status = element<HTMLSpanElement>("account-status");
    const linkButton = element<HTMLAnchorElement>("link-button");
    const unlinkForm = element<HTMLFormElement>("unlink-form");
    try {
        const { linked } = (await (await fetch("/api/session")).json()) as { linked: boolean };
        status.textContent = linked ? "Account linked" : "Not linked";
        status.dataset["linked"] = String(linked);
        linkButton.hidden = linked;
        unlinkForm.hidden = !linked;
    } catch {
        status.textContent = "Offline";
    }
}

/* ---------- Wiring ---------- */

function tickClock(): void {
    element<HTMLSpanElement>("clock").textContent = new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
    });
}

mic.addEventListener("click", listen);
textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value;
    textInput.value = "";
    void sendTurn(text);
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-say]")) {
    button.addEventListener("click", () => void sendTurn(button.dataset["say"] ?? ""));
}
element<HTMLButtonElement>("reset").addEventListener("click", () => {
    history = [];
    trace.replaceChildren();
    card.hidden = true;
    speechText.textContent = "New conversation. What can I help you with?";
});

tickClock();
setInterval(tickClock, 30_000);
void refreshAccount();
