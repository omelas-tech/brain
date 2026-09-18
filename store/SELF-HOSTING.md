# Self-hosting Brain

Run your own store, and optionally your own MCP connector in front of it, so
that every agent you use reaches memory that lives on a machine you control.
Nothing here needs a Brain Cloud account.

There are two pieces, and you can stop after the first.

| Piece | What it gives you | Needs |
|---|---|---|
| **`brain-store`** | Sync between your machines with `brain cloud push` and `pull` | Node.js 18+, or Docker |
| **The connector** | The same brain inside MCP-only hosts: Claude.ai, ChatGPT, goose and others | Docker, two DNS names, ports 80 and 443 |

The store never reads your memories. It keeps each brain as one archive, exactly
as the client sent it. The interface is documented in [CONTRACT.md](CONTRACT.md).

## 1. The store by itself

```bash
npx -p brain-memory brain-store user add alice     # prints alice's token, once
npx -p brain-memory brain-store serve               # http://127.0.0.1:8787
```

From a checkout of this repository, use `node store/bin/brain-store.js` in place
of `npx -p brain-memory brain-store`.

On each machine that should share the brain:

```bash
pbpaste | brain cloud login --api-url https://store.example.com --token-stdin
brain cloud push      # from the machine that has the memories
brain cloud pull      # on the others
```

`--token-stdin` keeps the token out of your shell history. `--token TOKEN` and
the `BRAIN_STORE_TOKEN` environment variable also work.

The server speaks plain HTTP and binds to `127.0.0.1`. To reach it from other
machines, put a TLS-terminating reverse proxy in front of it; the Compose setup
below does that for you. The `brain` CLI refuses to send a token over plain HTTP
to another host unless you pass `--allow-http`.

### Pushing from two machines

`push` is conditional. If another machine has pushed since you last pulled, the
store refuses the upload and nothing is overwritten:

```
Error: The store has changes you have not pulled, so nothing was uploaded.
Run `brain cloud pull` and push again, or `brain cloud push --force` to overwrite the store.
```

Pull, then push. The store keeps the last five archives it replaced, so even a
forced push can be undone: `brain restore --list --from cloud`, then
`brain restore --to <version> --from cloud`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `STORE_DATA_DIR` | `~/.brain-store` | Where users and archives live |
| `STORE_HOST`, `STORE_PORT` | `127.0.0.1`, `8787` | Bind address |
| `STORE_ENCRYPTION_KEY` | unset | 32 bytes, hex or base64. Turns on encryption at rest. Make one with `brain-store keygen` |
| `STORE_MAX_UPLOAD_MB` | `50` | Largest archive accepted |
| `STORE_MAX_USER_MB` | `0` | Storage per user; `0` is unlimited |
| `STORE_TRUST_PROXY` | unset | Set to `1` behind a reverse proxy, so rate limits see the real client address |
| `STORE_QUIET` | unset | Set to `1` to silence the request log |

Users:

```bash
brain-store user add <name> [--email E]   # create; prints the token once
brain-store user list
brain-store user rotate <name>            # new token; the old one stops working at once
brain-store user remove <name> [--purge]  # --purge also deletes their brains
```

Run one server process per data directory. The lock that makes conditional
uploads safe lives inside the process.

## 2. Store and connector with Docker Compose

This runs the store, the connector and [Caddy](https://caddyserver.com), which
obtains TLS certificates by itself.

1. Point two DNS names at the host, for example `store.example.com` and
   `mcp.example.com`, and open ports 80 and 443.
2. Configure:

   ```bash
   cd store/deploy
   cp .env.example .env
   docker compose run --rm store keygen     # paste into STORE_ENCRYPTION_KEY
   openssl rand -hex 32                     # paste into CONNECTOR_STATE_KEY
   ```

   Fill in the two domain names as well.
3. Start it, and create a user:

   ```bash
   docker compose up -d --build
   docker compose exec store node store/bin/brain-store.js user add alice
   ```

4. Connect a client. In any MCP host, add the server `https://mcp.example.com/mcp`.
   For example:

   ```bash
   claude mcp add --transport http brain https://mcp.example.com/mcp
   ```

   The host opens a sign-in page served by your connector. Paste the token from
   step 3. The CLI on your own machines uses `https://store.example.com` with the
   same token, as in part 1.

The connector is stateless in the sense that matters: it holds no memories of
its own. At login it pulls the user's brain from the store into memory, answers
recall from that copy, writes changes back, and discards the copy after fifteen
idle minutes or when the session ends.

## 3. Signing in through your organisation's identity provider

For more than a handful of people, issuing tokens by hand does not scale. The
store can instead accept ID tokens from an OpenID Connect issuer you already run:
Microsoft Entra, Google Workspace, Keycloak, Okta. People sign in with their work
account, and the store creates their user and first brain the first time it sees
them. Static tokens keep working alongside, which is how the `brain` CLI still
connects (`brain-store user rotate <oidc user id>` issues one for an OIDC user).

1. Register an application with your identity provider. Its redirect URI is
   `https://mcp.example.com/oidc/callback`. Note the issuer URL and the client id.
2. Configure the store and the connector with the same issuer and client id:

   | Store | Connector |
   |---|---|
   | `STORE_OIDC_ISSUER` | `OIDC_ISSUER` |
   | `STORE_OIDC_AUDIENCE` (the client id) | `OIDC_CLIENT_ID` |
   | `STORE_OIDC_ALLOWED_DOMAINS`, `STORE_OIDC_ALLOWED_EMAILS` | `OIDC_ALLOWED_DOMAINS`, `OIDC_ALLOWED_EMAILS` |
   | | `CONNECTOR_IDP=oidc` |
   | | `OIDC_CLIENT_SECRET`, if your provider issues one |
   | | `OIDC_SCOPES` (default `openid email profile offline_access`) |
   | | `OIDC_AUTH_PARAMS`, extra query parameters for the sign-in request |

3. Provider notes:
   - **Microsoft Entra:** use the tenant-specific issuer,
     `https://login.microsoftonline.com/<tenant id>/v2.0`. Everyone in that tenant
     can then sign in; no allow-list is needed.
   - **Google:** the issuer `https://accounts.google.com` gives tokens to anyone
     with a Google account, so the store refuses to start without an allow-list.
     Set `STORE_OIDC_ALLOWED_DOMAINS` to your Workspace domain. Google does not
     accept the `offline_access` scope: set `OIDC_SCOPES=openid email profile` and
     `OIDC_AUTH_PARAMS=access_type=offline&prompt=consent`.
   - Allow-lists match an address only when the provider marks it verified, or
     match Google's hosted-domain claim.

Only RS256 and ES256 signatures are accepted. The token's issuer, audience,
expiry and nonce are all checked, and the issuer must be reached over HTTPS.

This path is tested against a mock issuer that signs real tokens. It has not yet
been exercised against each real provider; expect to adjust scopes and parameters
for yours, and please report what you had to change.

## Backups

Everything is under the store's data directory (the `store-data` volume in
Compose): `users.json` and `brains/`. Copy that directory. With encryption at
rest switched on, a copy is useless without `STORE_ENCRYPTION_KEY`, so keep the
key somewhere separate from the backups, and do not lose it.

## What to know before you expose this to the internet

- **TLS is not optional.** Tokens are bearer credentials. The Compose setup
  terminates TLS in Caddy; if you use another proxy, do the same.
- **Tokens are stored hashed** (SHA-256 of 256 random bits). A stolen
  `users.json` does not yield usable tokens. A token shown by `user add` cannot
  be shown again; rotate it if it is lost.
- **Encryption at rest protects a stolen disk or backup, not a compromised
  server.** The server holds the key while it runs. This is server-side
  encryption, not end-to-end encryption.
- **The connector holds plaintext working copies while a user is active.** In
  the Compose setup they live on a memory-backed filesystem and are never written
  to disk.
- **Failed logins are rate limited** by client address, at the store and at the
  connector's sign-in endpoint.
- **Removing or rotating a user at the store ends their connector sessions** at
  the next silent renewal, within the hour.

Report security problems privately: see [SECURITY.md](../SECURITY.md).

## Checking your deployment

The conformance suite is a black-box test of the contract. Create a disposable
user, then:

```bash
STORE_URL=https://store.example.com STORE_TOKEN=bst_… node --test store/conformance/
```

It overwrites the brain it works on. Do not point it at a user whose memories
you want to keep.
