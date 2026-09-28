# Build from the repository root so the workspace lockfile is in context:
#   docker build -f server/Dockerfile -t cityvoice-server .
#
# Until account linking exists, the server only runs in demo mode, which
# refuses NODE_ENV=production. To try the image locally:
#   docker run -p 8080:8080 -e NODE_ENV=development cityvoice-server

FROM oven/bun:1.3.9-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json server/
RUN bun install --frozen-lockfile --production --filter @cityvoice/server

FROM oven/bun:1.3.9-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
USER bun
EXPOSE 8080
CMD ["bun", "server/src/index.ts"]
