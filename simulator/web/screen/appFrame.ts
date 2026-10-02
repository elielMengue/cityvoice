import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

import type { AppPage, TraceEntry } from "../api";

/**
 * Shows a tool's MCP App the way Alexa+ does: in a sandboxed frame that may
 * load only the hosts its resource declared, fed with the tool's result.
 * This module is loaded on demand, the first time a tool comes with an app.
 */

const HOST_INFO = { name: "CityVoice Alexa+ simulator", version: "0.1.0" };

/** Alexa's base canvas is 768 by 480; the frame keeps that shape. */
const CANVAS_RATIO = 480 / 768;

/** The page's Content Security Policy, built from what the resource declared and nothing more. */
export function contentPolicy(page: AppPage): string {
    const hosts = page.resourceDomains.join(" ");
    const connect = page.connectDomains.length === 0 ? "'none'" : page.connectDomains.join(" ");
    return [
        "default-src 'none'",
        `script-src 'unsafe-inline' ${hosts}`.trim(),
        `style-src 'unsafe-inline' ${hosts}`.trim(),
        `img-src data: ${hosts}`.trim(),
        `font-src ${hosts || "'none'"}`,
        `connect-src ${connect}`,
    ].join("; ");
}

function withPolicy(page: AppPage): string {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentPolicy(page)}">`;
    return page.html.replace(/<head>/i, (head) => `${head}${meta}`);
}

let current: { readonly bridge: AppBridge; readonly frame: HTMLIFrameElement } | undefined;

/** Removes the app on screen, letting it know first. */
export async function closeApp(): Promise<void> {
    const shown = current;
    current = undefined;
    if (shown === undefined) {
        return;
    }
    await shown.bridge.teardownResource({}).catch(() => undefined);
    await shown.bridge.close().catch(() => undefined);
    shown.frame.remove();
}

export async function showApp(container: HTMLElement, page: AppPage, entry: TraceEntry): Promise<void> {
    await closeApp();
    const frame = document.createElement("iframe");
    // Scripts only: no same origin, no forms, no top navigation.
    frame.sandbox.add("allow-scripts");
    frame.title = "What Alexa is showing";
    frame.className = "app-frame";
    const width = container.clientWidth;
    // Shown once the app says how tall it is: an app with nothing to show
    // reports zero, and then nothing appears at all.
    frame.style.height = "0";
    frame.dataset["empty"] = "true";
    container.append(frame);

    const view = frame.contentWindow;
    if (view === null) {
        frame.remove();
        return;
    }
    const bridge = new AppBridge(
        null,
        HOST_INFO,
        { sandbox: { csp: { resourceDomains: [...page.resourceDomains] } } },
        {
            hostContext: {
                theme: "light",
                platform: "web",
                displayMode: "inline",
                availableDisplayModes: ["inline"],
                containerDimensions: { width, maxHeight: Math.round(width * CANVAS_RATIO) },
                locale: "en-US",
            },
        },
    );
    bridge.onsizechange = ({ height }) => {
        if (height !== undefined) {
            frame.style.height = `${Math.ceil(height)}px`;
            frame.dataset["empty"] = String(height < 1);
        }
    };
    bridge.oninitialized = () => {
        void bridge.sendToolInput({ arguments: entry.args });
        void bridge.sendToolResult({
            content: [{ type: "text", text: entry.speech }],
            structuredContent: { speech: entry.speech, data: entry.data ?? {} },
        });
    };
    current = { bridge, frame };
    // Listen before the page exists, so its first message is not missed.
    await bridge.connect(new PostMessageTransport(view, view));
    frame.srcdoc = withPolicy(page);
}
