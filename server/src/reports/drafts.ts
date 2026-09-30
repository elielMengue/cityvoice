import type { ServiceAttribute, ServiceType } from "../catalog/serviceCatalog";
import { matchAttributeAnswer } from "../catalog/serviceCatalog";
import type { ResolvedLocation } from "../geo/locationId";
import type { Draft } from "../residents/residentStore";
import { withArticle } from "../speech/speech";
import type { ToolDeps } from "../tools/toolContext";

export const DRAFT_TTL_MS = 15 * 60 * 1000;

export const EXPIRED_DRAFT_SPEECH =
    "That report timed out before it was sent. Let's start again: what's the problem, and where is it?";

export function missingAttributes(service: ServiceType, answers: Readonly<Record<string, string>>): ServiceAttribute[] {
    return service.attributes.filter((attribute) => attribute.required && answers[attribute.code] === undefined);
}

/** The sentence Alexa reads before asking for confirmation. Built from the draft only. */
function buildReadback(draft: Draft, service: ServiceType): string {
    const answerPhrases = service.attributes.flatMap((attribute) => {
        const answer = draft.answers[attribute.code];
        if (answer === undefined) {
            return [];
        }
        const option = attribute.options?.find((candidate) => candidate.key === answer);
        return [option?.phrase ?? answer];
    });
    const summary = [withArticle(service.name), ...answerPhrases].join(", ");
    const details = draft.description.trim().length > 0 ? ` Details: ${draft.description.trim()}.` : "";
    return `${summary}, at ${draft.location.address}.${details}`;
}

/** Maps each answer to an option key. Answers that fit no option are dropped so the question is asked again. */
function normalizeAnswers(
    service: ServiceType,
    answers: Readonly<Record<string, string>>,
): { readonly accepted: Record<string, string>; readonly rejected: ServiceAttribute[] } {
    const accepted: Record<string, string> = {};
    const rejected: ServiceAttribute[] = [];
    for (const [code, answer] of Object.entries(answers)) {
        const attribute = service.attributes.find((candidate) => candidate.code === code);
        if (attribute === undefined) {
            continue;
        }
        const key = matchAttributeAnswer(attribute, answer);
        if (key === undefined) {
            rejected.push(attribute);
        } else {
            accepted[code] = key;
        }
    }
    return { accepted, rejected };
}

export interface DraftChange {
    readonly residentId: string;
    readonly previous?: Draft | undefined;
    readonly location: ResolvedLocation;
    readonly service: ServiceType;
    readonly description?: string | undefined;
    readonly answers?: Readonly<Record<string, string>> | undefined;
}

export interface SavedDraft {
    readonly draft: Draft;
    readonly readback: string;
    readonly missing: readonly ServiceAttribute[];
    /** The next question, or the readback and "should I send it?" when nothing is missing. */
    readonly speech: string;
}

/** Creates or updates a draft and works out what to ask next. Nothing is sent to the city. */
export async function saveDraft(deps: ToolDeps, change: DraftChange): Promise<SavedDraft> {
    const { previous, service } = change;
    // Answers only carry over when the service stays the same, since each
    // service asks its own questions.
    const carried = previous?.serviceCode === service.code ? previous.answers : {};
    const { accepted, rejected } = normalizeAnswers(service, change.answers ?? {});
    const draft: Draft = {
        id: previous?.id ?? deps.newId(),
        residentId: change.residentId,
        location: change.location,
        serviceCode: service.code,
        description: change.description ?? previous?.description ?? "",
        answers: { ...carried, ...accepted },
        expiresAt: new Date(deps.now().getTime() + DRAFT_TTL_MS).toISOString(),
    };
    await deps.residents.saveDraft(draft);

    const missing = missingAttributes(service, draft.answers);
    const readback = buildReadback(draft, service);
    const [next] = missing;
    let speech: string;
    if (next === undefined) {
        speech = `Here's your report: ${readback} Should I send it to the city?`;
    } else if (rejected.some((attribute) => attribute.code === next.code)) {
        speech = `Sorry, I didn't catch that. ${next.question}`;
    } else {
        speech = next.question;
    }
    return { draft, readback, missing, speech };
}
