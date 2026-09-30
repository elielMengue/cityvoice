/**
 * Prints the SQL that resets the database to the demo seed, dated now.
 *
 *   bun scripts/seedSql.ts > seed.sql
 *   bunx wrangler d1 execute cityvoice --local --file seed.sql
 *
 * Run it right before recording, so ages like "4 days ago" match the script.
 */
import { renderSql, seedStatements } from "../src/db/seedStatements";
import { buildDemoSeed, FIRST_DEMO_REQUEST_NUMBER } from "../src/demo/dcDemo";

console.log(renderSql(seedStatements(buildDemoSeed(new Date()), FIRST_DEMO_REQUEST_NUMBER)));
