/**
 * Renders the Devpost gallery: six 1500 x 1000 images (the 3:2 ratio Devpost
 * asks for) into docs/media. Every sentence on them is what the server really
 * says, produced by calling its tools, and every map is drawn from the pins
 * the tools return, on our own map tiles. San Francisco's map uses the city's
 * live 311 feed, so it shows the requests open at the time of rendering.
 *
 * Usage: bun scripts/renderGallery.ts
 * Needs a network connection, and Chrome (set CHROME_PATH if it is elsewhere).
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { syncSanFrancisco } from "../src/cities/sanFrancisco";
import type { MapStatus, ReportMap } from "../src/map/reportMap";
import { createTestApp } from "../test/support/testApp";
import type { LatLng } from "../ui/report-map/tiles";
import { fitView, screenPixel, tilesFor } from "../ui/report-map/tiles";
import { findChrome, screenshot } from "./renderAddonAssets";

const WIDTH = 1500;
const HEIGHT = 1000;
const TILES = "https://cityvoice.demop.workers.dev/tiles";
const root = join(import.meta.dir, "..", "..");
const target = join(root, "docs", "media");
const icon = pathToFileURL(join(root, "addon", "assets", "icon.svg")).href;

const STATUS_LABELS: Record<MapStatus, string> = { open: "waiting", progress: "in progress", closed: "closed" };

function escape(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A static picture of the report map: the same framing, tiles and pins as the MCP App. */
function mapHtml(map: ReportMap, width: number, height: number): string {
    const points: LatLng[] = map.pins.map((pin) => ({ lat: pin.lat, lng: pin.lng }));
    if (map.place !== undefined) {
        points.push(map.place);
    }
    const view = fitView(points, width, height, 56);
    const tiles = tilesFor(view, width, height)
        .map(
            (tile) =>
                `<img class="tile" src="${TILES}/${tile.zoom}/${tile.x}/${tile.y}.png" style="left:${tile.left}px;top:${tile.top}px" alt="">`,
        )
        .join("");
    const place =
        map.place === undefined
            ? ""
            : (() => {
                  const at = screenPixel(map.place, view, width, height);
                  return `<div class="place" style="left:${at.x}px;top:${at.y}px"></div>`;
              })();
    const pins = map.pins
        .map((pin) => {
            const at = screenPixel(pin, view, width, height);
            return `<div class="pin" data-status="${pin.status}" data-mine="${pin.mine}" style="left:${at.x}px;top:${at.y}px"></div>`;
        })
        .join("");
    const counts = (["open", "progress", "closed"] as const)
        .map((status) => [status, map.pins.filter((pin) => pin.status === status).length] as const)
        .filter(([, count]) => count > 0)
        .map(
            ([status, count]) =>
                `<div class="legend-row"><span class="dot" data-status="${status}"></span>${count} ${STATUS_LABELS[status]}</div>`,
        )
        .join("");
    const mine = map.pins.some((pin) => pin.mine)
        ? `<div class="legend-row"><span class="dot mine"></span>yours</div>`
        : "";
    return `<div class="map" style="width:${width}px;height:${height}px"><div class="tiles">${tiles}</div>${place}${pins}
        <div class="legend">${counts}${mine}</div><div class="attribution">&copy; OpenStreetMap contributors</div></div>`;
}

function said(text: string): string {
    return `<p class="said">&ldquo;${escape(text)}&rdquo;</p>`;
}

function answer(text: string): string {
    return `<p class="answer"><span class="who">Alexa</span>${escape(text)}</p>`;
}

const STYLE = `
* { box-sizing: border-box; }
html, body { width: ${WIDTH}px; height: ${HEIGHT}px; margin: 0; overflow: hidden; }
body {
    display: flex; flex-direction: column; gap: 28px; padding: 64px 72px;
    background:
        radial-gradient(55% 40% at 70% 0%, rgb(124 196 248 / 55%), transparent 70%),
        radial-gradient(40% 35% at 5% 0%, rgb(150 225 240 / 40%), transparent 70%), #f6f6f7;
    color: #1f2933; font: 26px/1.42 "Inter", "Segoe UI", sans-serif;
}
.brand { display: flex; align-items: center; gap: 14px; color: #0a73c9; font-size: 30px; font-weight: 600; }
.brand img { width: 52px; height: 52px; }
h1 { margin: 0; font-size: 52px; font-weight: 600; line-height: 1.12; letter-spacing: -0.01em; }
.row { display: flex; gap: 48px; align-items: flex-start; flex: 1; min-height: 0; }
.column { display: flex; flex-direction: column; gap: 18px; flex: 1; min-width: 0; }
.said, .answer { margin: 0; padding: 18px 24px; border-radius: 26px; }
.said { align-self: flex-end; max-width: 92%; background: #dfe9f5; border-bottom-right-radius: 8px; }
.answer { align-self: flex-start; max-width: 96%; background: #fff; border-bottom-left-radius: 8px;
    box-shadow: 0 8px 28px rgb(20 40 80 / 10%); }
.who { display: block; margin-bottom: 4px; color: #0a73c9; font-size: 18px; font-weight: 600; }
.card { padding: 26px 30px; border-radius: 26px; background: #fff; box-shadow: 0 8px 28px rgb(20 40 80 / 10%); }
.label { color: #5f6b7a; font-size: 20px; }
.big { font-size: 64px; font-weight: 600; letter-spacing: 0.08em; }
pre { margin: 0; padding: 22px 26px; border-radius: 20px; background: #14181e; color: #e6edf3;
    font: 18px/1.5 "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
.map { position: relative; overflow: hidden; border-radius: 26px; box-shadow: 0 8px 28px rgb(20 40 80 / 12%); flex: none; }
.tiles { filter: saturate(0.45) brightness(1.04); }
.tile { position: absolute; width: 256px; height: 256px; }
.place { position: absolute; width: 48px; height: 48px; margin: -24px 0 0 -24px; border: 3px solid #0a73c9;
    border-radius: 50%; background: rgb(10 115 201 / 15%); }
.pin { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border: 3px solid #fff;
    border-radius: 50%; background: #2563eb; box-shadow: 0 2px 6px rgb(0 0 0 / 35%); }
.pin[data-status="progress"], .dot[data-status="progress"] { background: #d97706; }
.pin[data-status="closed"], .dot[data-status="closed"] { background: #16a34a; }
.pin[data-mine="true"] { outline: 3px solid #1f2933; }
.legend { position: absolute; top: 16px; left: 16px; display: grid; gap: 6px; padding: 10px 16px;
    border-radius: 14px; background: rgb(255 255 255 / 94%); box-shadow: 0 2px 10px rgb(0 0 0 / 15%);
    font-size: 20px; font-weight: 600; }
.legend-row { display: flex; align-items: center; gap: 10px; }
.dot { width: 16px; height: 16px; border-radius: 50%; background: #2563eb; }
.dot.mine { background: transparent; outline: 3px solid #1f2933; outline-offset: -3px; }
.attribution { position: absolute; right: 8px; bottom: 6px; padding: 0 6px; border-radius: 4px;
    background: rgb(255 255 255 / 80%); color: #5f6b7a; font-size: 13px; }
.note { margin: 0; color: #5f6b7a; font-size: 22px; }
`;

function page(title: string, body: string): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap">
        <style>${STYLE}</style></head><body>
        <div class="brand"><img src="${icon}" alt="">CityVoice</div>
        <h1>${escape(title)}</h1>${body}</body></html>`;
}

async function scenes(): Promise<{ name: string; html: string }[]> {
    // Scenario A: Daniel reports a pothole, and the city's view of it.
    const daniel = createTestApp();
    const reportSaid = "There's a huge pothole in the right lane at 14th and U Street.";
    const started = await daniel.callTool(
        "start_report",
        { problem_description: "there's a huge pothole in the right lane", spoken_place: "14th and U Street" },
        "daniel",
    );
    const draftId = (started.data["draft"] as { draft_id: string }).draft_id;
    const readback = await daniel.callTool(
        "draft_report",
        { draft_id: draftId, answers: { position: "in the road" } },
        "daniel",
    );
    const sent = await daniel.callTool("submit_report", { draft_id: draftId, user_confirmed: true }, "daniel");
    const requestId = String(sent.data["request_id"]);
    const record = (await (
        await daniel.handle(new Request(`http://localhost/open311/v2/requests/${requestId}.json`))
    ).json()) as Record<string, unknown>[];
    const recordShown = Object.fromEntries(
        Object.entries(record[0] ?? {}).filter(([key]) =>
            ["service_request_id", "status", "service_code", "description", "address", "lat", "long"].includes(key),
        ),
    );

    // Scenario B and D.
    const maria = createTestApp();
    const offered = await maria.callTool(
        "start_report",
        { problem_description: "the streetlight is out", spoken_place: "in front of my house" },
        "maria",
    );
    const neighbors = offered.data["reports"] as { request_id: string }[];
    const supported = await maria.callTool("support_report", { request_id: neighbors[0]?.request_id ?? "" }, "maria");
    const emergency = await maria.callTool(
        "start_report",
        { problem_description: "there's a gas smell in my building" },
        "maria",
    );

    // Scenario C: Aisha's reports, with the map.
    const aisha = createTestApp();
    const mine = await aisha.callTool("get_my_reports", {}, "aisha");

    // San Francisco, from the city's live feed.
    const sf = createTestApp("sql");
    if (sf.db === undefined) {
        throw new Error("The SQL backend has a database");
    }
    // Today's date, so the mirror keeps the city's recent requests.
    await syncSanFrancisco(sf.db, new Date());
    const around = await sf.callTool("show_report_map", { spoken_place: "16th and Mission" }, "sam");

    return [
        { name: "gallery-1-cityvoice", html: cover() },
        {
            name: "gallery-2-report",
            html: page(
                "Filed after a clear yes, in the format cities read",
                `<div class="row"><div class="column">
                    ${said(reportSaid)}
                    ${answer(readback.speech)}
                    ${said("Yes.")}
                    ${answer(sent.speech)}
                </div><div class="column" style="max-width:560px">
                    <p class="note">What the city would receive, from CityVoice's public Open311 feed:</p>
                    <pre>${escape(JSON.stringify(recordShown, null, 2))}</pre>
                </div></div>`,
            ),
        },
        {
            name: "gallery-3-follow-up",
            html: page(
                "Know where your reports stand, with a map on screens",
                `<div class="row"><div class="column" style="max-width:560px">
                    ${said("What's happening with my reports?")}
                    ${answer(mine.speech)}
                </div>${mapHtml(mine.data["map"] as ReportMap, 760, 620)}</div>`,
            ),
        },
        {
            name: "gallery-4-san-francisco",
            html: page(
                "A real city: San Francisco's live 311 requests",
                `<div class="row"><div class="column" style="max-width:560px">
                    ${said("What's been reported around 16th and Mission?")}
                    ${answer(around.speech)}
                    <p class="note">Read from the city's own Open311 feed. Nothing is ever sent to the city.</p>
                </div>${mapHtml(around.data["map"] as ReportMap, 760, 620)}</div>`,
            ),
        },
        {
            name: "gallery-5-neighbors-and-safety",
            html: page(
                "Fewer duplicates, and emergencies sent to 911",
                `<div class="row"><div class="column">
                    ${said("The streetlight in front of my house is out.")}
                    ${answer(offered.speech)}
                    ${said("Add my support.")}
                    ${answer(supported.speech)}
                </div><div class="column">
                    ${said("There's a gas smell in my building.")}
                    ${answer(emergency.speech)}
                    <p class="note">The emergency screen is plain code in the server, never left to a language model.</p>
                </div></div>`,
            ),
        },
        {
            name: "gallery-6-architecture",
            html: page("How it works", architecture()),
        },
    ];
}

/** The cover: what CityVoice is, at a glance. */
function cover(): string {
    const points: readonly (readonly [string, string])[] = [
        ["Report by voice", "Alexa asks what the city needs and files only after a clear yes."],
        ["Fewer duplicates", "A neighbor's report nearby? Add your support instead."],
        ["Safety first", "Anything dangerous goes to 911, and nothing is filed."],
        ["Follow up", "Hear where your reports stand, with a map on screens."],
    ];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap">
        <style>${STYLE}
        body { justify-content: center; gap: 40px; padding: 80px 96px; }
        .hero { display: flex; align-items: center; gap: 32px; }
        .hero img { width: 132px; height: 132px; }
        .hero h1 { font-size: 92px; letter-spacing: -0.02em; }
        .pitch { margin: 0; font-size: 40px; line-height: 1.3; }
        .points { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; }
        .point { padding: 24px 26px; border-radius: 24px; background: #fff; box-shadow: 0 8px 28px rgb(20 40 80 / 10%); }
        .point strong { display: block; margin-bottom: 8px; color: #0a73c9; font-size: 26px; }
        .point span { color: #5f6b7a; font-size: 22px; }
        .footer { margin: 0; color: #5f6b7a; font-size: 24px; }
        </style></head><body>
        <div class="hero"><img src="${icon}" alt=""><h1>CityVoice</h1></div>
        <p class="pitch">Report a problem in your street to your city, just by talking to Alexa.</p>
        <div class="points">${points
            .map(
                ([title, text]) =>
                    `<div class="point"><strong>${escape(title)}</strong><span>${escape(text)}</span></div>`,
            )
            .join("")}</div>
        <p class="footer">An MCP server for Alexa+, built on Open311, the standard US cities use for 311 requests.</p>
        </body></html>`;
}

function architecture(): string {
    const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], accent = false) =>
        `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${accent ? "#0a73c9" : "#ffffff"}"
            stroke="${accent ? "#0a73c9" : "#d5dbe3"}" stroke-width="2"/>
        <text x="${x + w / 2}" y="${y + 46}" text-anchor="middle" font-size="27" font-weight="600"
            fill="${accent ? "#ffffff" : "#1f2933"}">${escape(title)}</text>
        ${lines
            .map(
                (line, index) =>
                    `<text x="${x + w / 2}" y="${y + 84 + index * 30}" text-anchor="middle" font-size="21"
                        fill="${accent ? "#e6f2fc" : "#5f6b7a"}">${escape(line)}</text>`,
            )
            .join("")}</g>`;
    // A label sits above its arrow and follows its slope, so it never covers the line.
    const arrow = (x1: number, y1: number, x2: number, y2: number, label: string, dashed = false) => {
        const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
        let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        if (Math.abs(angle) > 90) {
            angle += 180;
        }
        return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#5f6b7a" stroke-width="3"
            marker-end="url(#head)"${dashed ? ' stroke-dasharray="10 8"' : ""}/>
        <text x="${mx}" y="${my - 14}" transform="rotate(${angle.toFixed(1)} ${mx} ${my})" text-anchor="middle"
            font-size="19" fill="#5f6b7a">${escape(label)}</text></g>`;
    };
    return `<svg width="1356" height="700" viewBox="0 0 1356 700" font-family="Inter, Segoe UI, sans-serif">
        <defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#5f6b7a"/></marker></defs>
        ${box(0, 70, 250, 150, "Resident", ["speaks to Alexa"])}
        ${box(380, 70, 300, 150, "Alexa+", ["or the web simulator", "understands, calls tools"])}
        ${box(810, 40, 420, 210, "CityVoice MCP server", ["Cloudflare Worker", "tools, map page (MCP App)", "OAuth 2.1 with PKCE"], true)}
        ${box(810, 420, 420, 150, "D1 database", ["residents, drafts,", "sandbox requests"])}
        ${box(330, 420, 360, 150, "San Francisco", ["Open311 feed, read only"])}
        ${box(0, 420, 250, 150, "Cities, judges", ["public Open311 feed"])}
        ${arrow(250, 145, 378, 145, "voice")}
        ${arrow(680, 145, 808, 145, "MCP + token")}
        ${arrow(1020, 250, 1020, 418, "")}
        ${arrow(690, 495, 808, 495, "every 10 min")}
        ${arrow(810, 230, 252, 450, "Open311 GeoReport v2", true)}
        <text x="678" y="660" text-anchor="middle" font-size="22" fill="#5f6b7a">
            No language model in the server: tools are plain code, and each returns a sentence and its data.</text>
    </svg>`;
}

if (import.meta.main) {
    const chrome = await findChrome();
    const scratch = await mkdtemp(join(tmpdir(), "cityvoice-gallery-"));
    await mkdir(target, { recursive: true });
    try {
        for (const scene of await scenes()) {
            const file = join(scratch, `${scene.name}.html`);
            await Bun.write(file, scene.html);
            await screenshot(chrome, pathToFileURL(file).href, WIDTH, HEIGHT, join(target, `${scene.name}.png`));
            console.log(`rendered ${scene.name}.png`);
        }
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}
