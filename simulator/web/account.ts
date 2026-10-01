import { getSession } from "./api";
import { element } from "./dom";

/** The account link in the top bar. */

const status = element<HTMLSpanElement>("account-status");
const linkButton = element<HTMLAnchorElement>("link-button");
const unlinkForm = element<HTMLFormElement>("unlink-form");

export async function refreshAccount(): Promise<void> {
    try {
        const { linked } = await getSession();
        status.textContent = linked ? "Account linked" : "Not linked";
        status.dataset["linked"] = String(linked);
        linkButton.hidden = linked;
        unlinkForm.hidden = !linked;
    } catch {
        status.textContent = "Offline";
    }
}
