/**
 * What ends a live conversation. Alexa's follow-up mode closes the same way:
 * on silence, or when the resident says they are done.
 */
const GOODBYE =
    /^(?:(?:ok|okay|no|thanks|thank you)[,.!]?\s+)*(?:stop|cancel|that's all|that is all|that's it|goodbye|bye|i'm done|i am done|nothing else|no thanks|no thank you)\b/i;

export function endsConversation(utterance: string): boolean {
    return GOODBYE.test(utterance.trim());
}
