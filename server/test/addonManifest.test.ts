import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { CAROUSEL_SCENES, ICON_SIZES } from "../scripts/renderAddonAssets";

/**
 * The Alexa+ add-on manifest, checked against the store's limits and against
 * the files this server publishes. A broken link or a wrong size would only
 * show up at certification otherwise.
 */

const PUBLIC_URL = "https://cityvoice.demop.workers.dev";
const PUBLIC_DIR = join(import.meta.dir, "..", "public");

interface Manifest {
    manifestVersion: string;
    storeListing: {
        distributionCountries: string[];
        locales: Record<
            string,
            {
                name: { value: string };
                shortDescription: string;
                fullDescription: string;
                examplePhrases: string[];
                privacyAndCompliance: { privacyPolicyUrl: string; termsOfUseUrl: string };
                mediaAssets: {
                    icons: { light: { size: string; uri: string }[] };
                    carouselImages: { uri: string; altText: string; size: string }[];
                };
            }
        >;
    };
    integrations: { type: string; config: { endpoints: { default: { type: string; uri: string } } } }[];
}

const manifest = (await Bun.file(join(import.meta.dir, "..", "..", "addon", "addon.json")).json()) as Manifest;
const listing = manifest.storeListing.locales["en-US"];
if (listing === undefined) {
    throw new Error("addon.json has no en-US listing");
}

/** The file behind one of our public URLs. Pages are served without .html, as Cloudflare does. */
function localFile(url: string): string {
    expect(url.startsWith(`${PUBLIC_URL}/`)).toBe(true);
    const path = url.slice(PUBLIC_URL.length + 1);
    return join(PUBLIC_DIR, path.includes(".") ? path : `${path}.html`);
}

/** Width and height from a PNG's header. */
async function pngSize(path: string): Promise<string> {
    const header = new DataView(await Bun.file(path).slice(0, 24).arrayBuffer());
    return `${header.getUint32(16)}x${header.getUint32(20)}`;
}

describe("addon.json", () => {
    test("fits the store's limits", () => {
        expect(manifest.manifestVersion).toBe("1.0");
        expect(manifest.storeListing.distributionCountries).toEqual(["US"]);
        expect(listing.name.value.length).toBeLessThanOrEqual(30);
        expect(listing.shortDescription.length).toBeLessThanOrEqual(123);
        expect(listing.fullDescription.length).toBeLessThanOrEqual(4000);
        expect(listing.examplePhrases.length).toBeGreaterThanOrEqual(3);
        expect(listing.examplePhrases.length).toBeLessThanOrEqual(4);
        for (const phrase of listing.examplePhrases) {
            expect(phrase.length).toBeLessThanOrEqual(200);
        }
    });

    test("points Alexa at the MCP endpoint", () => {
        expect(manifest.integrations).toEqual([
            { type: "MCP", config: { endpoints: { default: { type: "HTTPS", uri: `${PUBLIC_URL}/mcp` } } } },
        ]);
    });

    test("links a privacy policy and terms that this server publishes", async () => {
        const { privacyPolicyUrl, termsOfUseUrl } = listing.privacyAndCompliance;
        for (const url of [privacyPolicyUrl, termsOfUseUrl]) {
            expect(await Bun.file(localFile(url)).exists()).toBe(true);
        }
    });

    test("lists every icon size, each a PNG of that size", async () => {
        const icons = listing.mediaAssets.icons.light;
        expect(icons.map((icon) => icon.size).sort()).toEqual(ICON_SIZES.map((size) => `${size}x${size}`).sort());
        for (const icon of icons) {
            expect(await pngSize(localFile(icon.uri))).toBe(icon.size);
        }
    });

    test("has carousel images of the right size, each described", async () => {
        const images = listing.mediaAssets.carouselImages;
        expect(images).toHaveLength(CAROUSEL_SCENES.length);
        for (const image of images) {
            expect(image.size).toBe("600x900");
            expect(await pngSize(localFile(image.uri))).toBe("600x900");
            expect(image.altText.length).toBeGreaterThan(0);
            expect(image.altText.length).toBeLessThanOrEqual(250);
        }
    });
});
