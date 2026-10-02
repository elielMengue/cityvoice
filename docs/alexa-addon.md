# Runbook: publishing CityVoice as an Alexa+ add-on

This runbook is for whoever publishes CityVoice to Alexa+ with an Amazon
developer account. It covers account linking, deployment and submission. To
try CityVoice, the online simulator is enough; see the main README.

The add-on itself lives in `addon/`. The MCP server lives in `server/`, and
Alexa+ reaches it at `https://cityvoice.demop.workers.dev/mcp`.

## What the add-on is made of

| Path                         | What it is                                                |
| ---------------------------- | --------------------------------------------------------- |
| `addon/addon.json`           | Store listing, privacy links, images and the MCP endpoint |
| `addon/assets/icon.svg`      | The icon, rendered at the six sizes the store asks for    |
| `addon/assets/carousel.html` | The three carousel scenes, rendered at 600 x 900          |

The images, the privacy policy and the terms are served by the CityVoice
Worker from `server/public`, so every URL in the manifest points at our own
domain. `server/test/addonManifest.test.ts` checks the manifest against the
store's limits and against those files.

To render the images again after changing a source:

```sh
cd server
bun scripts/renderAddonAssets.ts
```

It uses a headless Chrome; set `CHROME_PATH` if Chrome is not in its usual
place.

## Before you start

- Access to the Alexa+ Private Preview, and the Alexa AI CLI that comes with
  it. Install it from Amazon's instructions only: a package called
  `alexa-ai` on npm is an unrelated project.
- The server deployed, so the pages and images are online:
  `cd server && bun run deploy`.

## Linking accounts

Alexa+ links accounts with OAuth 2.1 and PKCE, and does not register clients
on its own. It needs a client registered ahead of time, with a secret, and
with every redirect URI it uses: there is one per region, and registering
only one breaks linking for customers in the others.

1. Run `alexa-ai configure` to sign in, then
   `alexa-ai configure-account-linking`. Note every redirect URI it lists.
2. Open client registration for one deploy: in `server/wrangler.jsonc`, set
   `ALLOW_CLIENT_REGISTRATION` to `"true"` under `env.production`, then
   `bun run deploy`.
3. Register the Alexa client, with one `--redirect` per URI from step 1:

    ```sh
    bun scripts/registerClient.ts https://cityvoice.demop.workers.dev --name "Alexa+" \
      --redirect <first uri> --redirect <second uri>
    ```

    It prints a client id and a secret. The secret is shown once; CityVoice
    keeps only its hash.

4. Close registration again: set `ALLOW_CLIENT_REGISTRATION` back to
   `"false"`, deploy, and add the new client id to the list of registered
   clients in the comment next to it.
5. Give the client id and secret to the CLI. It asks for the secret at a
   masked prompt, or reads it from `ALEXA_CLIENT_SECRET`. Never pass it as a
   plain flag, and never commit it.

The server publishes its endpoints in its metadata. If the CLI asks for them,
they are:

- Authorization: `https://cityvoice.demop.workers.dev/authorize`
- Token: `https://cityvoice.demop.workers.dev/oauth/token`
- Scope: `reports`

## Deploying and testing

From the `addon/` folder:

```sh
alexa-ai deploy
alexa-ai test
```

`deploy` makes the add-on available for development testing. Alexa+ reads
the tool list only when the add-on is deployed, so deploy again after
changing a tool's name, description or inputs.

When you link the account, the CityVoice consent page asks which
demonstration resident to act as: Maria, Daniel or Aisha. Their scenarios are
in `server/test/scenarios.test.ts`.

## Submitting

`alexa-ai submit` sends the add-on for certification. Before that, check the
voice rules in the project brief, run the server's smoke test against
production (`bun run smoke:oauth:prod`), and try the four scenarios on a
device with a screen and on one without.
