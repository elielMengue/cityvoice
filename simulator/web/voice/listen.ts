import { element } from "../dom";
import { setHint, setState, show } from "../stage";
import { stopSpeaking } from "./speak";

/** The resident's voice, with the browser's speech recognition. */

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

// Chrome and Edge still ship the recognizer under its prefixed name.
const speechWindow: Window & {
    readonly SpeechRecognition?: RecognitionConstructor;
    readonly webkitSpeechRecognition?: RecognitionConstructor;
} = window;
const RecognitionClass = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

const mic = element<HTMLButtonElement>("mic");
let recognition: Recognition | undefined;

/**
 * Starts listening, or stops if already listening. What was heard goes to
 * onHeard; a browser that cannot listen calls onCannotListen instead.
 */
export function listen(onHeard: (text: string) => void, onCannotListen: () => void): void {
    if (RecognitionClass === undefined) {
        setHint(
            "This browser can't listen. Type instead with the button next to the microphone, or use Chrome or Edge.",
        );
        onCannotListen();
        return;
    }
    if (recognition !== undefined) {
        recognition.stop();
        return;
    }
    stopSpeaking();
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
        setHint(
            event.error === "not-allowed"
                ? "The microphone is blocked. Allow it in the address bar, or type instead."
                : "I didn't catch that. Tap the microphone and try again.",
        );
    };
    current.onend = () => {
        recognition = undefined;
        mic.setAttribute("aria-pressed", "false");
        setState("idle");
        if (finalText.trim().length > 0) {
            onHeard(finalText.trim());
        }
    };
    mic.setAttribute("aria-pressed", "true");
    setState("listening");
    current.start();
}
