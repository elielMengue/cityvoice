# Friction log

A running record of what slowed us down while building CityVoice, written on
the day it happened. Each entry says what we tried, what we expected, what
actually happened, and how we got past it. We keep it honest and specific so
the teams behind these tools can act on it.

Time lost is our own rough estimate.

## 2026-09-28

### We could not activate an AWS account from the Central African Republic

- **Product:** AWS account sign-up
- **Tried:** to add a payment card and verify the phone number, the last steps
  before any AWS service can be used, including the Free plan.
- **Expected:** a verification code by SMS or voice call, or another way to
  verify, such as email.
- **Happened:** the SMS code never arrived. The page offers no alternative, so
  the account stays unusable. Without an active account there are no Free
  plan credits either.
- **Workaround:** a support case (Account activation, Phone verification) is
  possible without an active account, but we could not wait for it. We moved
  hosting to Cloudflare's free tier and the simulator's model to Gemini, and
  dropped the AWS Builder mini challenge.
- **Impact:** this decided our whole stack. A hackathon open to every country
  loses builders at the very first step when phone verification is the only
  path.
- **Time lost:** 1 hour, plus the redesign.

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

### A Worker crashes if its main module exports a constant

- **Product:** Cloudflare Workers runtime (workerd), through `wrangler dev`
- **Tried:** to export a few path constants from `worker.ts` for reuse.
- **Happened:** the runtime refused to start with "Incorrect type for map
  entry 'AUTHORIZE_PATH': the provided value is not of type 'function or
  ExportedHandler'". Every named export of the main module is treated as an
  entry point.
- **Expected:** either a lint or type error at build time, or a message that
  says to move non-handler exports elsewhere.
- **Workaround:** keep only the default export as a value in the main module,
  and say so in a comment.
- **Time lost:** 10 minutes.

### Cloudflare types and Bun types do not mix

- **Product:** `@cloudflare/workers-types`, `@cloudflare/workers-oauth-provider`
- **Happened:** the OAuth library's types rely on Cloudflare's global types
  (`ExportedHandler`, `Cloudflare.Env`). Installing them next to Bun's types
  brings two conflicting definitions of `Request` and `Response`, and without
  them every handler parameter silently becomes `any`.
- **Workaround:** leave the Cloudflare globals out and type each handler's
  parameters by hand.
- **Time lost:** 15 minutes.

### `wrangler dev` on Windows adds about 240 ms to every local request

- **Product:** Wrangler 4.143 on Windows 11
- **Happened:** a `ping` that takes under 30 ms inside the Worker took 250 ms
  from the outside, on every request, not just the first. It makes local
  latency checks against the 500 ms budget meaningless.
- **Workaround:** measure inside the Worker from our own request log, and
  measure the real round trip only once deployed.
- **Time lost:** 15 minutes.

### A Worker cannot time its own requests

- **Product:** Cloudflare Workers in production
- **Tried:** to check the 500 ms budget with the `latencyMs` field we log for
  every request.
- **Happened:** it read 0 ms online, while `wrangler dev` showed real values.
  Workers freeze the clock during execution as a defence against timing
  attacks, so `performance.now()` cannot measure a request.
- **Workaround:** read `wallTime` from Cloudflare's own request events
  (`wrangler tail` or Workers observability). MCP calls take 66 to 166 ms
  there, the slowest being the first call on a fresh isolate.
- **Time lost:** 15 minutes.

### Gemini's free tier is too busy to rely on for a live demo

- **Product:** Gemini API, free tier
- **Tried:** to use Gemini as the simulated Alexa+ model, choosing tools over
  several steps per turn.
- **Happened:** most requests to the newest models (3.8, 3.7, flash-latest)
  came back with 503 "high demand". `gemini-2.5-flash` answered 404: no longer
  available to new users. Turns that did complete took 11 to 42 seconds, of
  which our tools used about 2. In one turn, all four models failed.
- **Workaround:** the simulator tries a list of models with a timeout and
  jittered pauses, and says plainly when no model answers. This keeps it
  honest but not fast. We are looking at a faster model host for the demo.
- **Time lost:** 45 minutes.

### Workers reject a stored `fetch` with "Illegal invocation"

- **Product:** Cloudflare Workers runtime
- **Happened:** keeping the global `fetch` in a class field and calling it as
  `this.fetch(...)` fails in Workers, while Bun runs it fine, so every unit
  test passed and the first real turn failed.
- **Workaround:** a small `boundFetch` wrapper used everywhere, with a comment
  explaining why.
- **Time lost:** 10 minutes.

### Changing a D1 database id silently resets local data

- **Product:** Wrangler, local D1
- **Happened:** after replacing the placeholder `database_id` with the real
  one, `wrangler dev` started on an empty local database. The first request
  failed with "no such table: residents". Local state is keyed by the id, but
  nothing says a new local database was created.
- **Workaround:** run the local migration and seed again after changing an id.
- **Time lost:** 5 minutes.

## 2026-09-30

### Open models on Workers AI break rules written in their prompt

- **Product:** Cloudflare Workers AI, open models used as the simulated Alexa+
- **Happened:** Llama 3.3 answered the city's question for the resident and
  filed the report without a yes, retrying submit with `user_confirmed` set to
  true after the server refused. Llama 4 Scout answered a pothole report
  without calling any tool and named a city department it made up. Several
  models wrote tool calls as text, which was then read aloud.
- **Workaround:** the simulator enforces confirmation and grounded answers in
  code, runs tool calls written as text, and cleans spoken text. A model can
  still skip a tool entirely; Mistral answered a gas smell with "Call 911."
  on its own, which is safe but not our wording.
- **Time lost:** 1 hour 30 minutes.

### Workers AI speed depends on the hour and on the conversation length

- **Product:** Workers AI, free plan
- **Happened:** a model step took about 1 second in the morning with a short
  prompt, and 3 to 11 seconds in the afternoon with our full tool list and a
  few turns of history. Two of the faster models (GLM, DeepSeek) are not
  available on the free plan.
- **Workaround:** fewer steps per turn. A combined `start_report` tool gets to
  the first question in one call, and the simulator says a tool's answer
  directly instead of asking the model to repeat it.
- **Time lost:** 1 hour.

### Linking the same user again revokes their earlier links

- **Product:** `@cloudflare/workers-oauth-provider`
- **Happened:** two people testing as the same demo resident kept logging each
  other out. By default `completeAuthorization()` revokes the user's earlier
  grants for the same client. It is documented, and right for real accounts,
  but it took a while to connect "Grant not found" with a second person
  linking.
- **Workaround:** `revokeExistingGrants: false` for our shared demo accounts.
- **Time lost:** 45 minutes.

### The rate limiting binding let three times its limit through

- **Product:** Workers rate limiting binding, free plan
- **Tried:** a limit of 20 requests per minute on the OAuth routes, to protect
  the 1,000 KV writes a day of the free plan.
- **Happened:** 60 requests in 30 seconds, all with the same key, were all
  allowed. Logging inside the Worker showed the binding called every time with
  a stable key and answering `success: true`. The documentation does call it
  permissive and eventually consistent, but nothing says how far over the
  limit it can go.
- **Workaround:** we keep it to slow floods down, and added an exact daily
  budget counted in D1 for the requests that write to KV.
- **Time lost:** 40 minutes.

### One Worker cannot fetch another on the same workers.dev subdomain

- **Product:** Cloudflare Workers
- **Happened:** once deployed, linking the simulator crashed with error 1101.
  The logs showed why: the token request from the simulator Worker to the
  CityVoice Worker came back as "error code: 1042", plain text, which the
  simulator then failed to read as JSON. Locally both ran on localhost, so
  nothing showed it before deploying.
- **Workaround:** a service binding from the simulator to CityVoice, which is
  the supported way, and a callback that reports a failed link on the page
  instead of crashing.
- **Time lost:** 30 minutes.
