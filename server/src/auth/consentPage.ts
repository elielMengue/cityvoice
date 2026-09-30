/**
 * The page a resident sees when linking CityVoice to Alexa. It is a demo, so
 * "signing in" means picking one of the demo residents; the page says so
 * rather than pretending to check an identity.
 */

export interface ConsentDetails {
    readonly clientName: string;
    readonly clientDomain?: string | undefined;
    readonly redirectHost: string;
    readonly redirectIsLoopback: boolean;
}

export interface DemoAccount {
    readonly id: string;
    readonly name: string;
    readonly homeAddress: string;
}

/** Everything that came from the client is chosen by whoever registered it, so all of it is escaped. */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
    :root { color-scheme: light dark; --accent: #0b6bcb; --on-accent: #ffffff; --muted: #5b6470; --line: #d5dae0; }
    @media (prefers-color-scheme: dark) {
        :root { --accent: #6cb4ff; --on-accent: #0b1a2b; --muted: #a3acb8; --line: #3a414a; }
    }
    body { font: 18px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .muted { color: var(--muted); }
    .warning { border-left: 4px solid #c7541b; padding: 0.5rem 0.75rem; }
    fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 0.5rem 1rem; margin: 1.25rem 0; }
    label { display: block; padding: 0.5rem 0; cursor: pointer; }
    .actions { display: flex; gap: 0.75rem; }
    button { font: inherit; padding: 0.6rem 1.25rem; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; }
    button[value="approve"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
`;

export function renderConsentPage(details: ConsentDetails, handle: string, accounts: readonly DemoAccount[]): string {
    const name = escapeHtml(details.clientName);
    const origin =
        details.clientDomain === undefined
            ? "This app registered itself, so its name is not verified."
            : `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`;
    const loopbackWarning = details.redirectIsLoopback
        ? `<p class="warning">Access will go to an app on this computer. Continue only if you just started linking from it.</p>`
        : "";
    const options = accounts
        .map(
            (account, index) =>
                `<label><input type="radio" name="resident" value="${escapeHtml(account.id)}"${index === 0 ? " checked" : ""}>
                <strong>${escapeHtml(account.name)}</strong> <span class="muted">${escapeHtml(account.homeAddress)}</span></label>`,
        )
        .join("\n");

    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link CityVoice</title>
<style>${STYLE}</style>
<h1>Link CityVoice to ${name}</h1>
<p class="muted">${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopbackWarning}
<p>${name} will be able to file city reports for you, add your support to your neighbors' reports, and tell you
how your reports are going.</p>
<form method="post">
    <input type="hidden" name="handle" value="${escapeHtml(handle)}">
    <fieldset>
        <legend>Demo account</legend>
        ${options}
    </fieldset>
    <p class="muted">This is a demo. Pick a resident to act as; no password is needed and no real city receives
    your reports.</p>
    <div class="actions">
        <button name="decision" value="approve">Allow</button>
        <button name="decision" value="deny">Deny</button>
    </div>
</form>
</html>`;
}
