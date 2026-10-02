import type { Session } from "./api";
import { getSession } from "./api";
import { element } from "./dom";

/** The account link in the top bar. */

const status = element<HTMLSpanElement>("account-status");
const linkButton = element<HTMLAnchorElement>("link-button");
const unlinkForm = element<HTMLFormElement>("unlink-form");

/** Updates the top bar, and hands the session on to whoever needs it. */
export async function refreshAccount(): Promise<Session | undefined> {
    try {
        const session = await getSession();
        status.textContent = session.linked ? "Account linked" : "Not linked";
        status.dataset["linked"] = String(session.linked);
        linkButton.hidden = session.linked;
        unlinkForm.hidden = !session.linked;
        return session;
    } catch {
        status.textContent = "Offline";
        return undefined;
    }
}
