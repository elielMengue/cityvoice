import { describe, expect, test } from "bun:test";

import { detectEmergency } from "../src/catalog/emergency";
import { findServiceType, hasClearWinner, matchAttributeAnswer, rankServiceTypes } from "../src/catalog/serviceCatalog";

function topCode(description: string): string | undefined {
    return rankServiceTypes(description)[0]?.service.code;
}

describe("rankServiceTypes", () => {
    test.each([
        ["there's a huge pothole", "POTHOLE"],
        ["big hole in the road", "POTHOLE"],
        ["the street lamp is out", "STREETLIGHT"],
        ["they didn't pick up the garbage", "MISSED_TRASH"],
        ["someone spray painted the bus stop", "GRAFFITI"],
        ["somebody dumped an old mattress", "ILLEGAL_DUMPING"],
        ["the sidewalk is cracked and uneven", "SIDEWALK"],
        ["there's an abandoned car that hasn't moved in weeks", "ABANDONED_VEHICLE"],
        ["a big branch is hanging over the street", "TREE_HAZARD"],
    ])("%s", (description, expected) => {
        expect(topCode(description)).toBe(expected);
    });

    test("returns nothing for a problem the city does not handle here", () => {
        expect(rankServiceTypes("my neighbor plays loud music")).toEqual([]);
    });

    test("never returns more than five services", () => {
        const everything = "pothole streetlight trash graffiti dumping sidewalk abandoned car tree";
        expect(rankServiceTypes(everything).length).toBe(5);
    });
});

describe("hasClearWinner", () => {
    test("names the service when one is far ahead", () => {
        expect(hasClearWinner(rankServiceTypes("a tree branch is blocking the sidewalk"))).toBe(true);
    });

    test("leaves a tie to the resident", () => {
        expect(hasClearWinner(rankServiceTypes("there's graffiti on the trash can"))).toBe(false);
    });

    test("is false when nothing matched", () => {
        expect(hasClearWinner([])).toBe(false);
    });
});

describe("matchAttributeAnswer", () => {
    const position = findServiceType("POTHOLE")?.attributes[0];
    const items = findServiceType("ILLEGAL_DUMPING")?.attributes[0];

    test("maps free answers to the option key", () => {
        if (position === undefined) throw new Error("missing attribute");
        expect(matchAttributeAnswer(position, "in the road, right lane")).toBe("road");
        expect(matchAttributeAnswer(position, "at the crossing")).toBe("crosswalk");
        expect(matchAttributeAnswer(position, "crosswalk")).toBe("crosswalk");
    });

    test("refuses to guess when the answer fits no option, or several", () => {
        if (position === undefined) throw new Error("missing attribute");
        expect(matchAttributeAnswer(position, "no idea")).toBeUndefined();
        expect(matchAttributeAnswer(position, "the lane next to the crosswalk")).toBeUndefined();
    });

    test("keeps the words as they are for open questions", () => {
        if (items === undefined) throw new Error("missing attribute");
        expect(matchAttributeAnswer(items, " two old tires ")).toBe("two old tires");
        expect(matchAttributeAnswer(items, "   ")).toBeUndefined();
    });
});

describe("detectEmergency", () => {
    test.each([
        "I smell gas in the hallway",
        "it smells like rotten eggs in the stairwell",
        "there's smoke coming out of the manhole",
        "the building is on fire",
        "a power line is down on my street",
        "a man is bleeding on the corner",
        "there was a car accident at the light",
    ])("flags: %s", (description) => {
        expect(detectEmergency(description)).toContain("911");
    });

    test.each([
        "there's a huge pothole",
        "the fire hydrant is leaking",
        "trash all over the gas station parking lot",
        "the streetlight is flickering",
        "the streetlight is shot",
        "the street lamp is burning all day long",
        "someone left a gas can on the sidewalk",
        "I got hurt tripping on the broken sidewalk last week",
        "the smoke detector sign fell off the pole",
    ])("lets through: %s", (description) => {
        expect(detectEmergency(description)).toBeUndefined();
    });
});
