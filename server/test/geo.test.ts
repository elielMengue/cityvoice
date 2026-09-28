import { describe, expect, test } from "bun:test";

import { DC_PLACES } from "../src/demo/dcDemo";
import { GazetteerGeocoder, placeTokens } from "../src/geo/gazetteerGeocoder";
import { distanceMeters } from "../src/geo/geo";
import { decodeLocationId, encodeLocationId } from "../src/geo/locationId";

describe("distanceMeters", () => {
    test("one block along U Street is about 210 meters", () => {
        const fourteenth = { lat: 38.91705, lng: -77.03196 };
        const thirteenth = { lat: 38.917, lng: -77.0295 };

        expect(distanceMeters(fourteenth, thirteenth)).toBeCloseTo(213, -1);
    });

    test("is zero for the same point", () => {
        const point = { lat: 38.9, lng: -77 };
        expect(distanceMeters(point, point)).toBe(0);
    });
});

describe("location ids", () => {
    const location = {
        address: "14th Street and U Street Northwest",
        point: { lat: 38.91705, lng: -77.03196 },
        isHome: false,
    };

    test("round-trip without any server state", () => {
        expect(decodeLocationId(encodeLocationId(location))).toEqual(location);
    });

    test.each(["", "loc_", "loc_!!!", "abc", `loc_${Buffer.from('["x", 999, 0, 0]').toString("base64url")}`])(
        "reject %p",
        (id) => {
            expect(decodeLocationId(id)).toBeUndefined();
        },
    );
});

describe("GazetteerGeocoder", () => {
    const geocoder = new GazetteerGeocoder(DC_PLACES);

    test.each(["14th and U", "14th and U Street", "U Street and 14th", "fourteenth & u st nw"])(
        "%s finds 14th Street and U Street Northwest",
        async (spoken) => {
            const [best] = await geocoder.geocode(spoken);
            expect(best?.address).toBe("14th Street and U Street Northwest");
            expect(best?.relevance).toBe(1);
        },
    );

    test("a street alone matches several places with low relevance", async () => {
        const matches = await geocoder.geocode("14th Street");
        expect(matches.length).toBeGreaterThan(3);
        expect(matches[0]?.relevance).toBeLessThan(0.7);
    });

    test("filler words carry no meaning", () => {
        expect([...placeTokens("at the corner of 14th St NW and U Street")]).toEqual(["14th", "u"]);
    });
});
