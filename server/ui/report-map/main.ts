import { App } from "@modelcontextprotocol/ext-apps";

import type { ReportMap } from "../../src/map/reportMap";
import { renderMap } from "./render";

type Theme = "light" | "dark";

/**
 * The map page Alexa+ shows on screens. The host hands it the tool result;
 * the page draws data.map and asks for nothing else.
 */

const root = document.getElementById("map");
if (root === null) {
    throw new Error("Missing #map");
}
const mapRoot = root;

let current: ReportMap | undefined;
let theme: Theme = "light";

function draw(): void {
    document.documentElement.dataset["theme"] = theme;
    if (current !== undefined) {
        renderMap(mapRoot, current);
    }
}

/** Accepts only the shape the server sends, so a stray result never breaks the page. */
function mapFrom(structured: unknown): ReportMap | undefined {
    if (typeof structured !== "object" || structured === null) {
        return undefined;
    }
    const data = (structured as { data?: { map?: ReportMap } }).data;
    return Array.isArray(data?.map?.pins) ? data.map : undefined;
}

const app = new App({ name: "CityVoice report map", version: "1.0.0" });

app.ontoolresult = (result) => {
    current = mapFrom(result.structuredContent);
    draw();
};
app.onhostcontextchanged = (context) => {
    if (context.theme !== undefined) {
        theme = context.theme;
        draw();
    }
};

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 100);
});

await app.connect();
theme = app.getHostContext()?.theme ?? theme;
draw();
