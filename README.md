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

Early. The server runs, speaks MCP over Streamable HTTP, and exposes a single
`ping` tool. The reporting tools come next.

## Run it locally

You need [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
cd server
bun dev
```

The MCP endpoint is then at `http://localhost:8080/mcp`, and a health check at
`http://localhost:8080/health`.

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

More in [docs/engineering-practices.md](docs/engineering-practices.md).

## License

[MIT](LICENSE)
