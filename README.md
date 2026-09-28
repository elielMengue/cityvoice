# CityVoice

Report a problem in your street to your city just by talking to Alexa.

CityVoice is an MCP server for Alexa+. A resident says "there's a huge pothole
at 14th and U", and CityVoice finds the place, checks whether neighbours have
already reported it, files the request, and later tells the resident how it is
going. It speaks [Open311 GeoReport v2](https://wiki.open311.org/GeoReport_v2/),
the open standard many US cities already use for their 311 services, so one
integration can serve any city that supports it.

Built for the Alexa+ track of
[Build, Ship, Shape: Amazon Developer Hackathon 2026](https://amazonappdev2026.devpost.com/).

## Status

A resident can report a problem from start to finish, and support a report a
neighbor already filed. Reports go to a sandbox that behaves like a city's
Open311 server, never to a real city. Following up on reports, the map for
screens and account linking come next.

## Tools

| Tool                  | What it does                                                                |
| --------------------- | --------------------------------------------------------------------------- |
| `resolve_location`    | Turns "14th and U" or "in front of my house" into a confirmed place         |
| `list_service_types`  | Finds the city service for the problem, and stops at emergencies (call 911) |
| `find_nearby_reports` | Checks whether neighbors already reported the same thing close by           |
| `draft_report`        | Builds the report over several turns and asks what the city still needs     |
| `submit_report`       | Sends the draft after an explicit yes; safe to retry                        |
| `support_report`      | Adds the resident's support to a neighbor's report, once per person         |
| `ping`                | Checks that the service is up                                               |

Every tool returns `speech`, a sentence Alexa can say as it is, and `data`,
the structured result behind it.

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

- **Stateless.** Every MCP request is served by a fresh server instance, so
  any container can answer any call and scaling out needs no shared session
  store.
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
  memory; production plugs in Amazon Location Service, a city's Open311 API
  and DynamoDB without touching the tools.

More in [docs/engineering-practices.md](docs/engineering-practices.md).

## License

[MIT](LICENSE)
