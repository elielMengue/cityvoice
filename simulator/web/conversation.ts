import { refreshAccount } from "./account";
import { postTurn } from "./api";
import { renderTrace } from "./scenes";
import { renderCard } from "./screen/card";
import { setState, show } from "./stage";
import { speak } from "./voice/speak";

/**
 * One turn of the conversation. The conversation lives here and is sent with
 * every turn, so the server keeps nothing between turns.
 */

let conversation: unknown[] = [];
let busy = false;

export async function sendTurn(utterance: string): Promise<void> {
    if (busy || utterance.trim().length === 0) {
        return;
    }
    busy = true;
    setState("thinking");
    show(utterance, "...");
    try {
        const result = await postTurn(utterance, conversation);
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

export function forgetConversation(): void {
    conversation = [];
}
