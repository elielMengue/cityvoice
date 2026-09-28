# Friction log

A running record of what slowed us down while building CityVoice, written on
the day it happened. Each entry says what we tried, what we expected, what
actually happened, and how we got past it. We keep it honest and specific so
the teams behind these tools can act on it.

Time lost is our own rough estimate.

## 2026-09-28

### AWS App Runner is closed to new customers

- **Product:** AWS App Runner
- **Tried:** to plan hosting on App Runner, because our brief picked it for
  its always-on containers and simple setup.
- **Expected:** a new account could create a service.
- **Happened:** App Runner stopped taking new customers on 30 April 2026 and
  is in maintenance. Several hackathon guides and blog posts from early 2026
  still recommend it.
- **Workaround:** Amazon ECS Express Mode, which AWS names as the successor.
- **Time lost:** 20 minutes, mostly re-reading the brief's fallback plan.

### The Alexa+ docs split the server requirements across pages

- **Product:** Alexa+ MCP Toolkit documentation
- **Tried:** to find the protocol version, transport, auth and latency rules
  on the Functional Requirements page.
- **Expected:** one page listing everything a server must do.
- **Happened:** Functional Requirements covers tool behaviour only. The spec
  version (2025-11-25), Streamable HTTP, OAuth 2.1 with PKCE and the 500 ms
  budget are in the QuickStart.
- **Also:** the QuickStart says to host Protected Resource Metadata at
  `/.well-known/oauth-authorization-server`. In the MCP spec and RFC 9728,
  Protected Resource Metadata lives at `/.well-known/oauth-protected-resource`,
  and the other path is the authorization server's metadata. We will serve
  both and note which one Alexa+ actually reads.
- **Time lost:** 15 minutes.

### MCP TypeScript SDK v1 or v2

- **Product:** MCP TypeScript SDK, MCP Apps extension
- **Tried:** to start on `@modelcontextprotocol/sdk` 1.30, the package most
  examples still use.
- **Happened:** `@modelcontextprotocol/ext-apps` 2.0, which we need for the
  map, only works with the v2 packages (`@modelcontextprotocol/server`). v2
  implements the 2026-07-28 spec, while Alexa+ asks for 2025-11-25. We had to
  read the SDK source to confirm that v2 still serves 2025-era clients through
  a stateless legacy path.
- **Also:** on that legacy path the answer is always an SSE stream. The
  `responseMode: "json"` option only applies to 2026-07-28 traffic. The docs
  do say so, but it is easy to miss.
- **Workaround:** moved to v2 before writing any real tool, and added a test
  that talks to the server exactly as a 2025-11-25 client would.
- **Time lost:** 40 minutes.

### typescript-eslint refuses TypeScript 7

- **Product:** typescript-eslint 8.70 with TypeScript 7.0
- **Happened:** `bun add -d typescript` installed 7.0, and ESLint stopped with
  "typescript-eslint does not support TS 7.0".
- **Workaround:** pinned TypeScript to 6.x.
- **Time lost:** 5 minutes.

### AWS CLI on Windows crashes on non-ASCII output

- **Product:** AWS CLI 2.37.4 on Windows 11, `aws agent-toolkit list-available-skills`
- **Happened:** the command failed with
  `'charmap' codec can't encode character '→'`, because a skill
  description contains an arrow and the console uses a legacy code page.
- **Workaround:** set `PYTHONUTF8=1`, or narrow the output with `--query`.
- **Time lost:** 10 minutes.

### GeoReport v2 cannot search by distance

- **Product:** Open311 GeoReport v2 standard
- **Tried:** to find open reports within 75 meters of a place, to catch
  duplicates before they are filed.
- **Expected:** a `lat`, `long` and `radius` filter on `GET requests`.
- **Happened:** the standard filters by service, status and date only. Some
  cities add their own geographic filters, but each one differently.
- **Workaround:** ask for open requests of one service type, then filter by
  distance on our side. This is fine for a demo city, but on a large city it
  would pull thousands of rows; a cache per service type will be needed.
- **Time lost:** 10 minutes.

### Agent Toolkit setup ends with a Windows error

- **Product:** `aws configure agent-toolkit` on Windows 11
- **Happened:** it installed the skills and configured Claude Code, then
  stopped with `[WinError 2] The system cannot find the file specified`. It
  seems to fail when it moves on to tools whose command line is a PowerShell
  script or is not on `PATH`. It does not say which tool it was configuring.
- **Expected:** skip the tool it cannot configure, name it, and carry on.
- **Time lost:** 15 minutes.
