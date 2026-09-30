import type { SqlDatabase } from "../db/sqlDatabase";
import { GazetteerGeocoder } from "../geo/gazetteerGeocoder";
import { SandboxOpen311 } from "../open311/sandboxOpen311";
import { SqlSandboxOpen311 } from "../open311/sqlSandboxOpen311";
import { MemoryResidentStore } from "../residents/memoryResidentStore";
import { SqlResidentStore } from "../residents/sqlResidentStore";
import type { ToolDeps } from "../tools/toolContext";
import { buildDemoSeed, createDemoRequestIds, DC_BOUNDS, DC_PLACES, formatDemoRequestId } from "./dcDemo";

const randomId = (): string => crypto.randomUUID();

/** The Washington DC pilot, all in memory. For a single local process and fast tests. */
export function createDemoDeps(now: () => Date = () => new Date(), newId: () => string = randomId): ToolDeps {
    const seed = buildDemoSeed(now());
    return {
        geocoder: new GazetteerGeocoder(DC_PLACES),
        open311: new SandboxOpen311(seed.requests, { now, nextRequestId: createDemoRequestIds() }),
        residents: new MemoryResidentStore(seed.residents, seed.myReports),
        serviceArea: DC_BOUNDS,
        now,
        newId,
    };
}

/**
 * The Washington DC pilot on a SQL database, D1 in production. Every
 * instance reads and writes the same data. The database must already hold
 * the seed (see scripts/seedSql.ts).
 */
export function createSqlDemoDeps(
    db: SqlDatabase,
    now: () => Date = () => new Date(),
    newId: () => string = randomId,
): ToolDeps {
    return {
        geocoder: new GazetteerGeocoder(DC_PLACES),
        open311: new SqlSandboxOpen311(db, { now, formatRequestId: formatDemoRequestId }),
        residents: new SqlResidentStore(db),
        serviceArea: DC_BOUNDS,
        now,
        newId,
    };
}
