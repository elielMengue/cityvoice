import { randomUUID } from "node:crypto";

import { GazetteerGeocoder } from "../geo/gazetteerGeocoder";
import { SandboxOpen311 } from "../open311/sandboxOpen311";
import { MemoryResidentStore } from "../residents/memoryResidentStore";
import type { ToolDeps } from "../tools/toolContext";
import { buildDemoSeed, createDemoRequestIds, DC_BOUNDS, DC_PLACES } from "./dcDemo";

/** Wires the tools to the Washington DC demo: gazetteer, sandbox 311 and in-memory residents. */
export function createDemoDeps(now: () => Date = () => new Date(), newId: () => string = randomUUID): ToolDeps {
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
