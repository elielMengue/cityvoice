# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

CityVoice is an MCP server for Alexa+ that lets residents report city issues
(311) by voice, over the Open311 GeoReport v2 standard. It is an entry for the
Alexa+ track of the Amazon "Build, Ship, Shape" hackathon. Submission deadline:
23 October 2026, 12:00 PT.

## Commands

- `bun install` at the root (Bun only, never npm, pnpm or yarn)
- `bun run typecheck`, `bun run lint`, `bun run test`, `bun run format`
- `cd server && bun dev` to run the server on port 8080

## House rules

- Follow [docs/engineering-practices.md](docs/engineering-practices.md): AWS
  guidance first, Google TypeScript Style Guide for the gaps.
- Docs, comments and commit messages in clear English, level B2 to C1. The
  text must read as written by a person: no em dashes or double hyphens as
  punctuation, no marketing tone.
- No emojis anywhere.
- One commit, one purpose. Conventional Commits subject, a body that explains
  why. No `Co-Authored-By` trailers.
- Add an entry to [docs/friction-log.md](docs/friction-log.md) the same day
  something slows us down.
- The MCP server never calls an LLM, and never writes to a real city's 311
  system. Emergencies get "call 911" and nothing is filed.

<!-- BEGIN AWS Agent Toolkit rules -->

## AWS guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions, since it provides sandboxed
  execution, observability, and audit logging. If it is unavailable, use the
  AWS CLI directly with `--profile cityvoice`.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over general
  knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure as code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use hyphens
  instead.

### Secret safety

- MUST load the `aws-secrets-manager` skill first for any secret, credential,
  API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST NOT
  hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

<!-- END AWS Agent Toolkit rules -->
