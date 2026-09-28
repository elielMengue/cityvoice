# Engineering practices

This is how we write code in CityVoice. We follow AWS guidance first. Where AWS
has nothing to say, we fall back on the Google TypeScript Style Guide. When the
two disagree, AWS wins, and the choice is written down here so nobody has to
guess.

## Sources

- AWS Prescriptive Guidance, [Follow TypeScript best practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/typescript-best-practices.html)
- AWS Prescriptive Guidance, [Organize code for large-scale projects](https://docs.aws.amazon.com/prescriptive-guidance/latest/best-practices-cdk-typescript-iac/organizing-code-best-practices.html)
- Amazon Builders' Library, [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- Amazon Builders' Library, [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- Amazon Builders' Library, [Avoiding fallback in distributed systems](https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/)
- Amazon Builders' Library, [Instrumenting distributed systems for operational visibility](https://aws.amazon.com/builders-library/instrumenting-distributed-systems-for-operational-visibility/)
- AWS Well-Architected Framework, for anything we deploy
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), for the gaps

## Types

- No `any`. If a value really is unknown, type it as `unknown` and narrow it.
- Describe data with interfaces and union types. Mark fields `readonly` when
  they should not change after creation.
- No empty interfaces. An interface with nothing in it enforces nothing.
- Validate everything that crosses a boundary (HTTP bodies, tool arguments,
  environment variables, rows read back from DynamoDB) with Zod, once, at the
  edge. Inside the boundary, trust the types.
- `strict` is on, plus `noUncheckedIndexedAccess`. We turned off
  `exactOptionalPropertyTypes` because the MCP SDK's own types do not compile
  under it.

## Naming

Taken from AWS Prescriptive Guidance:

| Thing                         | Style      | Example               |
| ----------------------------- | ---------- | --------------------- |
| Variables, functions, members | camelCase  | `resolveLocation`     |
| Classes, interfaces, types    | PascalCase | `ServiceRequest`      |
| Global constants              | UPPER_CASE | `MAX_NEARBY_REPORTS`  |
| Files                         | camelCase  | `nearbyReports.ts`    |
| MCP tool names                | snake_case | `find_nearby_reports` |

Tool names are snake_case because they are part of the public contract in the
project brief and that is the MCP convention. Everything else follows AWS.

## Structure

- Split code by feature, not by kind. A tool, its input schema and its tests
  sit close together.
- Dependencies are passed in, never imported as singletons. The HTTP layer
  receives its logger, and later its repositories and its clock. Tests hand
  in fakes.
- `let` and `const` only, never `var`. Prefer `const`.
- Named exports only. No default exports (Google).
- Comments explain why, not what. If a comment repeats the code, delete it.

## Tools and the voice contract

- Every tool returns `speech` (a sentence Alexa can read out, under 60 words)
  and `data` (structured JSON). Both come from one call to `toolSuccess`, so
  what is said and what is shown cannot drift.
- Failures use `isError: true` and a sentence that tells the user what to do
  next. Never an error code, an identifier or JSON in `speech`.
- No LLM calls inside the MCP server. Every tool answers in well under 500 ms.

## Reliability

These come from the Builders' Library and apply as soon as we call anything
over the network (DynamoDB, Amazon Location Service, a city's Open311 API):

- Every outbound call has a timeout. Pick it from the latency budget, not from
  a default.
- Retry in one place only, usually the AWS SDK. Use capped exponential backoff
  with jitter. Never retry a 4xx.
- Write operations are idempotent. `submit_report` takes a `draft_id` and
  returns the same request for the same draft, however many times Alexa
  retries.
- No clever fallbacks. If a dependency is down, fail clearly and say so to the
  user rather than switching to a code path nobody has tested.

## Observability

- One structured JSON log line per request with method, path, status and
  latency. CloudWatch Logs Insights can query every field.
- Log the decision, not the payload. Never log a resident's address or the
  text of a report at `info` level.

## Formatting and linting

- Prettier formats, ESLint (typescript-eslint `strict`) lints. Both run in CI.
- 4 spaces, 120 columns, trailing commas.
- Run `bun run format` before committing. Do not argue with the formatter.

## Git

- One commit does one thing. The subject follows
  [Conventional Commits](https://www.conventionalcommits.org/) and says what
  changed; the body says why.
- Write commit messages in plain English, in the imperative ("add", not
  "added").
- No emojis anywhere: code, docs, commits or pull requests.

## Writing

Docs are written for a reader with good but not native English. Short
sentences, common words, active voice. Say what a thing does before you say
how. Punctuate like a person: commas, colons and full stops, not long dashes.
