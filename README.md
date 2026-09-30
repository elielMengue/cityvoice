# CityVoice

Report a problem in your street to your city just by talking to Alexa.

CityVoice is an MCP server for Alexa+. A resident says "there's a huge pothole
at 14th and U", and CityVoice finds the place, checks whether neighbors have
already reported it, files the request, and later tells the resident how it is
going. It is built on the data model of
[Open311 GeoReport v2](https://wiki.open311.org/GeoReport_v2/), the open
standard many US cities already use for their 311 services, so that one
connector can serve any city that supports it.

Built for the Alexa+ track of
[Build, Ship, Shape: Amazon Developer Hackathon 2026](https://amazonappdev2026.devpost.com/).

## Status

A resident can link their account, report a problem from start to finish,
support a report a neighbor already filed, and ask how their reports are
going. Reports go to a sandbox that behaves like a city's Open311 server,
never to a real city. The map for screens, the Alexa+ simulator and the HTTP
connector for real Open311 cities come next.

## Tools

| Tool                  | What it does                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `start_report`        | The first answer in one call: emergency screen, service, place, neighbors' reports, draft |
| `resolve_location`    | Turns "14th and U" or "in front of my house" into a confirmed place                       |
| `list_service_types`  | Finds the city service for the problem, and stops at emergencies (call 911)               |
| `find_nearby_reports` | Checks whether neighbors already reported the same thing close by                         |
| `draft_report`        | Builds the report over several turns and asks what the city still needs                   |
| `submit_report`       | Sends the draft after an explicit yes; safe to retry                                      |
| `support_report`      | Adds the resident's support to a neighbor's report, once per person                       |
| `get_my_reports`      | Tells the resident where their reports stand, three at a time                             |
| `ping`                | Checks that the service is up                                                             |

Every tool returns `speech`, a sentence Alexa can say as it is, and `data`,
the structured result behind it.

`start_report` exists for speed. Each tool call costs the assistant a round of
thinking, and a report used to need four of them before the first question.
Now it needs one. The single-step tools stay for corrections, like "no, it's
on 15th Street".

## Demo data

The pilot uses real places in Washington DC and made-up residents and
reports. Three residents are ready to use: `maria`, `daniel` and `aisha`. The
data is rebuilt the same way at every start, so each run of the demo begins
from the same state.

## Run it locally

You need [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
cd server
bun dev
```

The MCP endpoint is then at `http://localhost:8080/mcp`, and a health check at
`http://localhost:8080/health`.

Account linking is not built yet. Until it is, pick the demo resident with
the `DEMO_RESIDENT` variable (for example `DEMO_RESIDENT=maria bun dev`), or per
request with the `x-cityvoice-demo-resident` header. This mode trusts the
caller completely and is only meant for a local machine.

### On Cloudflare Workers

Production runs on Cloudflare Workers, with the data in D1 and account linking
over OAuth 2.1 with PKCE. Locally, no Cloudflare account is needed:

```bash
cd server
bun run db:migrate:local
bun run db:seed:local
bun run worker:dev:oauth
```

`bun run smoke:oauth` then walks through account linking the way Alexa+ does
and checks every step: the 401 challenge, discovery, PKCE, the consent page,
the token, and a tool call as the chosen resident. `db:seed:local` also resets
the demo data, which is how each take of the demo video starts clean.

### By hand

To call it by hand, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:8080/mcp --transport http --method tools/call --tool-name ping
```

## Checks

From the repository root:

```bash
bun run typecheck
bun run lint
bun run test
```

## Layout

| Path      | What it is                                 |
| --------- | ------------------------------------------ |
| `server/` | The MCP server (Bun, TypeScript)           |
| `docs/`   | Engineering practices and the friction log |

## Design choices

- **Stateless MCP layer.** Every MCP request is served by a fresh server
  instance and there are no MCP sessions. What must be remembered (drafts,
  who supports what) lives in the resident store. The demo keeps that store in
  memory, so it runs as a single instance; with a shared database behind the
  same interface, any instance can answer any call.
- **No LLM in the server.** The tools are plain, fast code. Language
  understanding belongs to Alexa+, which keeps each call well under the
  500 ms budget.
- **Speech and data together.** Every tool returns a sentence ready to be
  spoken and the structured data behind it, built in one place so they always
  agree.
- **Location ids carry the place.** A `location_id` encodes the address and
  coordinates, so the next tool needs no lookup and no shared cache.
- **Ports and adapters.** Geocoding, the city's 311 system and resident
  storage sit behind interfaces. The demo plugs in a gazetteer, a sandbox and
  memory; a geocoding service, a city's Open311 API and a database plug in
  the same way, without touching the tools.
- **Safe to retry.** Alexa may repeat a call when a response is slow. Filing
  a report and supporting one are both protected, so a repeated or parallel
  call never files twice or counts anyone twice.

More in [docs/engineering-practices.md](docs/engineering-practices.md).

## License

[MIT](LICENSE)
