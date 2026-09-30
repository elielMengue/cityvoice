import type { RankedService } from "../catalog/serviceCatalog";
import { hasClearWinner } from "../catalog/serviceCatalog";
import { joinWithAnd, withArticle } from "../speech/speech";

const NO_SERVICE_SPEECH =
    "I couldn't match that to a city service. Could you describe what you see, " +
    "like a pothole, a broken streetlight, or graffiti?";

/** "That sounds like a pothole report." or, when it is not clear, a short choice. */
export function serviceMatchSpeech(ranked: readonly RankedService[]): string {
    const first = ranked[0]?.service;
    if (first === undefined) {
        return NO_SERVICE_SPEECH;
    }
    if (hasClearWinner(ranked)) {
        return `That sounds like ${withArticle(first.name)} report.`;
    }
    const choices = ranked.slice(0, 3).map(({ service }) => `${withArticle(service.name)} report`);
    return `That could be ${joinWithAnd(choices, "or")}. Which fits best?`;
}
