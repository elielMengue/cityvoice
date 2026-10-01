import type { TraceEntry } from "../api";
import { getApp } from "../api";
import { element } from "../dom";
import { clearCard, renderCard } from "./card";

/**
 * What the screen shows after a turn. A tool that comes with an MCP App gets
 * its app, as on an Echo Show; otherwise the card lists what Alexa said.
 */

const appContainer = element<HTMLDivElement>("app");

/** The frame code is heavy, so it loads the first time an app is shown. */
const loadFrame = () => import("./appFrame");

let shown = false;

export async function clearScreen(): Promise<void> {
    clearCard();
    appContainer.hidden = true;
    if (shown) {
        shown = false;
        await (await loadFrame()).closeApp();
    }
}

export async function showOnScreen(entries: readonly TraceEntry[]): Promise<void> {
    await clearScreen();
    const last = [...entries].reverse().find((entry) => !entry.isError && entry.data !== undefined);
    if (last?.uiResourceUri === undefined) {
        renderCard(entries);
        return;
    }
    try {
        const [page, frame] = await Promise.all([getApp(last.uiResourceUri), loadFrame()]);
        appContainer.hidden = false;
        shown = true;
        await frame.showApp(appContainer, page, last);
    } catch {
        // No app, no problem: everything it would show was also said.
        appContainer.hidden = true;
        renderCard(entries);
    }
}
