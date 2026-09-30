/**
 * The browser side of the simulator: microphone, voice, what Alexa shows,
 * and the "behind the scenes" drawer. The conversation lives here and is sent
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
    readonly steps?: { readonly model: string; readonly ms: number }[];
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

const greeting = element<HTMLHeadingElement>("greeting");
const said = element<HTMLParagraphElement>("said");
const speechText = element<HTMLParagraphElement>("speech");
const card = element<HTMLDivElement>("card");
const voice = element<HTMLDivElement>("voice");
const trace = element<HTMLOListElement>("trace");
const mic = element<HTMLButtonElement>("mic");
const hint = element<HTMLParagraphElement>("hint");
const textForm = element<HTMLFormElement>("text-form");
const textInput = element<HTMLInputElement>("text-input");

// The conversation so far, sent with every turn: the server keeps none.
let conversation: unknown[] = [];
let busy = false;

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

const STATE_HINTS: Record<VoiceState, string> = {
    idle: "Tap the microphone and speak.",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Tap the microphone to interrupt.",
};

/** The ring around the microphone, and the line under it, say what Alexa is doing. */
function setState(state: VoiceState): void {
    voice.dataset["state"] = state;
    hint.textContent = STATE_HINTS[state];
}

/** Replaces the greeting with the exchange: what the resident said, and Alexa's answer. */
function show(utterance: string | undefined, answer: string): void {
    greeting.hidden = true;
    said.hidden = utterance === undefined;
    said.textContent = utterance === undefined ? "" : `"${utterance}"`;
    speechText.hidden = false;
    speechText.textContent = answer;
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

// Natural US voices, best first. Edge and Windows ship "Microsoft ... Online
// (Natural)" voices, Chrome ships "Google US English", Safari ships "Samantha".
const PREFERRED_VOICES = [
    /Aria.*Natural/i,
    /Jenny.*Natural/i,
    /Natural.*United States/i,
    /Google US English/i,
    /Samantha/i,
];

/**
 * Browsers load their voices after the page, and getVoices() is empty until
 * they arrive. Speaking before that falls back to the system voice, which on
 * a French Windows reads English with a French accent.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
        return Promise.resolve(voices);
    }
    return new Promise((resolve) => {
        const done = () => resolve(speechSynthesis.getVoices());
        speechSynthesis.addEventListener("voiceschanged", done, { once: true });
        setTimeout(done, 1500);
    });
}

let chosenVoice: SpeechSynthesisVoice | undefined;

async function usVoice(): Promise<SpeechSynthesisVoice | undefined> {
    if (chosenVoice !== undefined) {
        return chosenVoice;
    }
    const english = (await loadVoices()).filter((voice) => voice.lang.replace("_", "-").toLowerCase() === "en-us");
    chosenVoice =
        PREFERRED_VOICES.map((pattern) => english.find((voice) => pattern.test(voice.name))).find(
            (voice) => voice !== undefined,
        ) ?? english[0];
    if (chosenVoice === undefined) {
        hint.textContent = "No US English voice is installed, so Alexa may sound odd. Try Chrome or Edge.";
    }
    return chosenVoice;
}

async function speak(text: string): Promise<void> {
    if (!("speechSynthesis" in window)) {
        return;
    }
    const voice = await usVoice();
    return new Promise((resolve) => {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        if (voice !== undefined) {
            utterance.voice = voice;
        }
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        setState("speaking");
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
    setState("thinking");
    show(utterance, "...");
    try {
        const response = await fetch("/api/turn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ utterance, history: conversation }),
        });
        const result = (await response.json()) as TurnResponse;
        if (result.history !== undefined) {
            conversation = result.history;
        }
        if (result.linked === false) {
            void refreshAccount();
        }
        show(utterance, result.speech);
        renderCard(result.trace ?? []);
        renderTrace(utterance, result);
        await speak(result.speech);
    } catch {
        show(utterance, "Sorry, I'm having trouble right now. Please try again in a moment.");
    } finally {
        busy = false;
        setState("idle");
    }
}

/* ---------- Voice in ---------- */

// Chrome and Edge still ship the recognizer under its prefixed name.
const speechWindow: Window & {
    readonly SpeechRecognition?: RecognitionConstructor;
    readonly webkitSpeechRecognition?: RecognitionConstructor;
} = window;
const RecognitionClass = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

let recognition: Recognition | undefined;

function listen(): void {
    if (RecognitionClass === undefined) {
        hint.textContent =
            "This browser can't listen. Type instead with the button next to the microphone, or use Chrome or Edge.";
        openTyping();
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
        show(parts.map((result) => result[0]?.transcript ?? "").join(" "), "...");
    };
    current.onerror = (event) => {
        hint.textContent =
            event.error === "not-allowed"
                ? "The microphone is blocked. Allow it in the address bar, or type instead."
                : "I didn't catch that. Tap the microphone and try again.";
    };
    current.onend = () => {
        recognition = undefined;
        mic.setAttribute("aria-pressed", "false");
        setState("idle");
        if (finalText.trim().length > 0) {
            void sendTurn(finalText.trim());
        }
    };
    mic.setAttribute("aria-pressed", "true");
    setState("listening");
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

const typeToggle = element<HTMLButtonElement>("type-toggle");
const scenes = element<HTMLElement>("scenes");
const scenesToggle = element<HTMLButtonElement>("scenes-toggle");

/** Typing is there for accessibility and for browsers that cannot listen; voice comes first. */
function openTyping(): void {
    textForm.hidden = false;
    typeToggle.setAttribute("aria-expanded", "true");
    textInput.focus();
}

function toggleTyping(): void {
    if (textForm.hidden) {
        openTyping();
    } else {
        textForm.hidden = true;
        typeToggle.setAttribute("aria-expanded", "false");
    }
}

function setScenes(open: boolean): void {
    scenes.hidden = !open;
    scenesToggle.setAttribute("aria-expanded", String(open));
}

mic.addEventListener("click", listen);
textForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value;
    textInput.value = "";
    void sendTurn(text);
});
typeToggle.addEventListener("click", toggleTyping);
scenesToggle.addEventListener("click", () => setScenes(scenesToggle.getAttribute("aria-expanded") !== "true"));
element<HTMLButtonElement>("scenes-close").addEventListener("click", () => setScenes(false));
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        setScenes(false);
    }
});
element<HTMLButtonElement>("reset").addEventListener("click", () => {
    conversation = [];
    trace.replaceChildren();
    card.hidden = true;
    said.hidden = true;
    speechText.hidden = true;
    greeting.hidden = false;
});

void refreshAccount();

// Back from a sign-in that did not work: say so once, then tidy the address.
if (new URLSearchParams(location.search).get("link") === "failed") {
    show(undefined, "Linking your account didn't work. Please try again with the Link account button.");
    history.replaceState(null, "", location.pathname);
}
