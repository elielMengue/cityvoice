import { createDemoAuthenticator } from "./auth/authenticator";
import { loadConfig } from "./config";
import { DEMO_RESIDENTS } from "./demo/dcDemo";
import { createDemoDeps } from "./demo/demoDeps";
import { createFetchHandler, MCP_PATH } from "./httpServer";
import { createLogger, SILENT_LOGGER } from "./logger";
import { warmUp } from "./warmUp";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const tools = createDemoDeps();
const authenticate = createDemoAuthenticator(
    DEMO_RESIDENTS.map((resident) => resident.id),
    config.demoResident,
);

const warmUpStartedAt = performance.now();
await warmUp(createFetchHandler({ logger: SILENT_LOGGER, tools, authenticate }));
const warmUpMs = Math.round(performance.now() - warmUpStartedAt);

const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: createFetchHandler({ logger, tools, authenticate }),
});

logger.info("server started", { url: `${server.url.origin}${MCP_PATH}`, authMode: config.authMode, warmUpMs });

// ECS sends SIGTERM before it stops a task. Finishing in-flight requests first
// means a deployment never cuts a user off in the middle of a report.
process.on("SIGTERM", async () => {
    logger.info("shutting down");
    await server.stop();
    process.exit(0);
});
