import { describe, expect, test } from "bun:test";

import type { SpokenReport } from "../src/reports/myReportsSpeech";
import { describeMyReports } from "../src/reports/myReportsSpeech";
import { shortPlace, spokenPlace } from "../src/speech/places";

describe("places the way people say them", () => {
    test.each([
        ["14th Street and U Street Northwest", "14th and U"],
        ["6th Street and East Capitol Street", "6th and East Capitol"],
        ["8th Street and Pennsylvania Avenue Southeast", "8th Street and Pennsylvania Avenue"],
        ["1520 T Street Northwest", "T Street"],
        ["1421 Columbia Road Northwest", "Columbia Road"],
    ])("%s is %s", (address, short) => {
        expect(shortPlace(address)).toBe(short);
    });

    test("intersections are at, streets are on, and home is home", () => {
        expect(spokenPlace("14th Street and U Street Northwest")).toBe("at 14th and U");
        expect(spokenPlace("900 U Street Northwest")).toBe("on U Street");
        expect(spokenPlace("1520 T Street Northwest", "1520 T Street Northwest")).toBe("at your home");
    });
});

describe("describeMyReports", () => {
    const waiting = (thing: string, place: string, filed = "today"): SpokenReport => ({
        thing,
        place,
        supported: false,
        state: "waiting",
        filed,
    });

    test("says reports in the same state together, and does not repeat the kind", () => {
        const speech = describeMyReports([
            waiting("broken streetlight", "at your home"),
            waiting("broken streetlight", "at 14th and U"),
        ]);

        expect(speech).toBe(
            "The broken streetlight at your home and the one at 14th and U are still waiting for the city. " +
                "Both were filed today.",
        );
    });

    test("leaves the dates out when they differ", () => {
        const speech = describeMyReports([
            waiting("pothole", "on U Street", "today"),
            waiting("graffiti", "on 11th Street", "3 days ago"),
        ]);

        expect(speech).toBe("The pothole on U Street and the graffiti on 11th Street are still waiting for the city.");
    });

    test("gives each report in progress its own sentence, with the city's note", () => {
        const speech = describeMyReports([
            { ...waiting("pothole", "on U Street"), state: "progress", note: "a crew has been assigned" },
            { ...waiting("graffiti", "on 11th Street"), state: "closed", closed: "today" },
        ]);

        expect(speech).toBe(
            "The pothole on U Street is in progress: a crew has been assigned. The graffiti on 11th Street was closed today.",
        );
    });
});
