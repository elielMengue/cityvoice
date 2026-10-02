/**
 * Renders the Alexa+ add-on's images from their sources in addon/assets:
 * the icon at the six sizes the store asks for, and one carousel image per
 * scene. A headless Chrome draws them, so what the store shows is exactly
 * what the HTML and SVG say. The images are served from public/addon.
 *
 * Usage: bun scripts/renderAddonAssets.ts
 * Set CHROME_PATH if Chrome is not in its usual place.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ICON_SIZES = [64, 72, 88, 126, 180, 241] as const;
export const CAROUSEL_SCENES = [1, 2, 3] as const;
export const CAROUSEL_SIZE = { width: 600, height: 900 } as const;

const root = join(import.meta.dir, "..", "..");
const sources = join(root, "addon", "assets");
const target = join(root, "server", "public", "addon");

const CHROME_CANDIDATES = [
    process.env["CHROME_PATH"],
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
];

async function findChrome(): Promise<string> {
    for (const candidate of CHROME_CANDIDATES) {
        if (candidate !== undefined && (await Bun.file(candidate).exists())) {
            return candidate;
        }
    }
    throw new Error("Chrome not found. Set CHROME_PATH to its executable.");
}

async function screenshot(chrome: string, url: string, width: number, height: number, output: string) {
    const chromeRun = Bun.spawn(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--default-background-color=00000000",
            `--window-size=${width},${height}`,
            `--screenshot=${output}`,
            url,
        ],
        { stdout: "ignore", stderr: "ignore" },
    );
    if ((await chromeRun.exited) !== 0 || !(await Bun.file(output).exists())) {
        throw new Error(`Chrome could not render ${url}`);
    }
}

if (import.meta.main) {
    const chrome = await findChrome();
    const scratch = await mkdtemp(join(tmpdir(), "cityvoice-assets-"));
    await mkdir(target, { recursive: true });
    try {
        const icon = pathToFileURL(join(sources, "icon.svg")).href;
        for (const size of ICON_SIZES) {
            const page = join(scratch, `icon-${size}.html`);
            await Bun.write(
                page,
                `<!doctype html><body style="margin:0"><img src="${icon}" width="${size}" height="${size}"></body>`,
            );
            await screenshot(chrome, pathToFileURL(page).href, size, size, join(target, `icon-${size}x${size}.png`));
        }
        const carousel = pathToFileURL(join(sources, "carousel.html")).href;
        for (const scene of CAROUSEL_SCENES) {
            const { width, height } = CAROUSEL_SIZE;
            await screenshot(
                chrome,
                `${carousel}?scene=${scene}`,
                width,
                height,
                join(target, `carousel-${scene}.png`),
            );
        }
        console.log(`Rendered ${ICON_SIZES.length} icons and ${CAROUSEL_SCENES.length} carousel images into ${target}`);
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}
