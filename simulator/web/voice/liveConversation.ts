import { sendTurn } from "../conversation";
import { setHint } from "../stage";
import { openTyping } from "../typing";
import { endsConversation } from "./goodbyes";
import { isListening, listen, stopListening } from "./listen";
import { stopSpeaking } from "./speak";

/**
 * A conversation that stays open, like Alexa's follow-up mode: after each
 * answer the microphone opens again on its own, so the resident just keeps
 * talking. It closes after a silence, when the resident says they are done,
 * or when they tap the microphone. The first tap is needed anyway: browsers
 * only open the microphone after a gesture.
 */

const FOLLOW_UP_HINT = "I'm listening. Say “that's all” when you're done.";

let live = false;

function end(): void {
    live = false;
}

function listenForReply(): void {
    listen({
        onHeard: (heard) => void reply(heard),
        onNothingHeard: end,
        onCannotListen: () => {
            end();
            openTyping();
        },
    });
}

async function reply(heard: string): Promise<void> {
    await sendTurn(heard);
    if (!live || endsConversation(heard)) {
        end();
        return;
    }
    // Tapping the microphone while Alexa spoke already opened it again.
    if (!isListening()) {
        listenForReply();
        setHint(FOLLOW_UP_HINT);
    }
}

/** The microphone button: starts a conversation, interrupts Alexa, or ends the conversation. */
export function tapMicrophone(): void {
    if (isListening()) {
        end();
        stopListening();
        return;
    }
    live = true;
    stopSpeaking();
    listenForReply();
}
