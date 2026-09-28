import type { CallToolResult } from "@modelcontextprotocol/server";

import type { BoundingBox } from "../geo/geo";
import type { Geocoder } from "../geo/geocoder";
import type { Open311Client } from "../open311/types";
import type { Resident, ResidentStore } from "../residents/residentStore";
import { toolFailure } from "./toolResult";

/** Everything a tool may touch. Passed in, so tests can hand in fakes and a fixed clock. */
export interface ToolDeps {
    readonly geocoder: Geocoder;
    readonly open311: Open311Client;
    readonly residents: ResidentStore;
    /** The area the connected city covers. Places outside it are refused. */
    readonly serviceArea: BoundingBox;
    readonly now: () => Date;
    readonly newId: () => string;
}

/** Who is speaking. Comes from the verified access token, never from tool arguments. */
export interface Caller {
    readonly residentId: string | undefined;
}

export const NOT_LINKED_SPEECH =
    "I need you to link your CityVoice account first. You can do that in the Alexa app, then ask me again.";

/** Looks up the calling resident, or returns the failure to send back when there is none. */
export async function resolveResident(
    deps: ToolDeps,
    caller: Caller,
): Promise<{ readonly resident: Resident } | { readonly failure: CallToolResult }> {
    const resident = caller.residentId === undefined ? undefined : await deps.residents.getResident(caller.residentId);
    return resident === undefined ? { failure: toolFailure(NOT_LINKED_SPEECH) } : { resident };
}
