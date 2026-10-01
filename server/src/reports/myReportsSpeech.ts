import { ageInWords, capitalized, joinWithAnd, numberWord } from "../speech/speech";
import { spokenPlace } from "../speech/places";
import type { ServiceRequest } from "../open311/types";

/**
 * How Alexa tells a resident where their reports stand. Reports in the same
 * state are said together ("The pothole on U Street and the one at 14th and
 * U are still waiting for the city."), so three reports do not sound like
 * three copies of one sentence.
 */

type State = "waiting" | "progress" | "closed";

export interface SpokenReport {
    /** "pothole", "broken streetlight". */
    readonly thing: string;
    /** "on U Street", "at your home". */
    readonly place: string;
    readonly supported: boolean;
    readonly state: State;
    /** The city's note on a report in progress: "a crew has been assigned". */
    readonly note?: string;
    /** "today", "2 days ago". */
    readonly filed: string;
    readonly closed?: string;
}

export function spokenReport(
    request: ServiceRequest,
    thing: string,
    supported: boolean,
    homeAddress: string,
    now: Date,
): SpokenReport {
    const note = request.status_notes?.trim().replace(/\.$/, "");
    const state: State = request.status === "closed" ? "closed" : note ? "progress" : "waiting";
    return {
        thing,
        place: spokenPlace(request.address ?? "", homeAddress),
        supported,
        state,
        ...(state === "progress" && note ? { note: `${note.charAt(0).toLowerCase()}${note.slice(1)}` } : {}),
        filed: ageInWords(new Date(request.requested_datetime), now),
        ...(state === "closed"
            ? { closed: ageInWords(new Date(request.updated_datetime ?? request.requested_datetime), now) }
            : {}),
    };
}

/** "the pothole on U Street", "the broken streetlight you support at your home", or "the one at 14th and U" after one of the same kind. */
function subjects(reports: readonly SpokenReport[]): string[] {
    return reports.map((report, index) => {
        const previous = reports[index - 1];
        if (previous?.thing === report.thing && !report.supported) {
            return `the one ${report.place}`;
        }
        return report.supported
            ? `the ${report.thing} you support ${report.place}`
            : `the ${report.thing} ${report.place}`;
    });
}

/** " Both were filed today." when they were filed the same day, nothing otherwise. */
function filedTogether(reports: readonly SpokenReport[]): string {
    const [first] = reports;
    if (first === undefined || reports.some((report) => report.filed !== first.filed)) {
        return "";
    }
    const all = reports.length === 2 ? "Both" : `All ${numberWord(reports.length)}`;
    return ` ${all} were filed ${first.filed}.`;
}

function describeGroup(state: State, reports: readonly SpokenReport[]): string[] {
    const [single] = reports;
    if (single === undefined) {
        return [];
    }
    if (state === "progress") {
        // Each note is different, so each report gets its own sentence.
        return reports.map((report) => `${capitalized(subjects([report])[0] ?? "")} is in progress: ${report.note}.`);
    }
    const together = capitalized(joinWithAnd(subjects(reports)));
    if (state === "closed") {
        const when = reports.every((report) => report.closed === single.closed) ? ` ${single.closed}` : "";
        return [`${together} ${reports.length === 1 ? "was" : "were"} closed${when}.`];
    }
    if (reports.length === 1) {
        return [`${together} is still waiting for the city, filed ${single.filed}.`];
    }
    return [`${together} are still waiting for the city.${filedTogether(reports)}`];
}

/** The reports, grouped by state in the order they come, as sentences. */
export function describeMyReports(reports: readonly SpokenReport[]): string {
    const order: State[] = [];
    for (const report of reports) {
        if (!order.includes(report.state)) {
            order.push(report.state);
        }
    }
    return order
        .flatMap((state) =>
            describeGroup(
                state,
                reports.filter((report) => report.state === state),
            ),
        )
        .join(" ");
}
