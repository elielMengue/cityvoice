import { setHint, setState } from "../stage";

/** Alexa's voice, with the browser's speech synthesis. */

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
        setHint("No US English voice is installed, so Alexa may sound odd. Try Chrome or Edge.");
    }
    return chosenVoice;
}

export async function speak(text: string): Promise<void> {
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

export function stopSpeaking(): void {
    if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
    }
}
