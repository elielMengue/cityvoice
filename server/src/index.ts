import { loadConfig } from "./config";
import { createFetchHandler, MCP_PATH } from "./httpServer";
import { createLogger, SILENT_LOGGER } from "./logger";
import { warmUp } from "./warmUp";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const warmUpStartedAt = performance.now();
await warmUp(createFetchHandler({ logger: SILENT_LOGGER }));
const warmUpMs = Math.round(performance.now() - warmUpStartedAt);

const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: createFetchHandler({ logger }),
});

logger.info("server started", { url: `${server.url.origin}${MCP_PATH}`, warmUpMs });

// ECS sends SIGTERM before it stops a task. Finishing in-flight requests first
// means a deployment never cuts a user off in the middle of a report.
process.on("SIGTERM", async () => {
    logger.info("shutting down");
    await server.stop();
    process.exit(0);
});
