import { element } from "./dom";

/** The middle of the page: the greeting, what the resident said, Alexa's answer, and the microphone's state. */

const greeting = element<HTMLHeadingElement>("greeting");
const said = element<HTMLParagraphElement>("said");
const speechText = element<HTMLParagraphElement>("speech");
const voice = element<HTMLDivElement>("voice");
const hint = element<HTMLParagraphElement>("hint");

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

const STATE_HINTS: Record<VoiceState, string> = {
    idle: "Tap the microphone and speak.",
    listening: "Listening...",
    thinking: "Thinking...",
    speaking: "Tap the microphone to interrupt.",
};

/** The ring around the microphone, and the line under it, say what Alexa is doing. */
export function setState(state: VoiceState): void {
    voice.dataset["state"] = state;
    hint.textContent = STATE_HINTS[state];
}

/** Replaces the line under the microphone until the next change of state. */
export function setHint(text: string): void {
    hint.textContent = text;
}

/** Replaces the greeting with the exchange: what the resident said, and Alexa's answer. */
export function show(utterance: string | undefined, answer: string): void {
    greeting.hidden = true;
    said.hidden = utterance === undefined;
    said.textContent = utterance === undefined ? "" : `"${utterance}"`;
    speechText.hidden = false;
    speechText.textContent = answer;
}

/** Back to the greeting, as on a fresh page. */
export function clearStage(): void {
    said.hidden = true;
    speechText.hidden = true;
    greeting.hidden = false;
}
