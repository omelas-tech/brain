# tasks/todo.md — open store contract + `brain-store` reference server

Started 2026-09-18. Decisions made: Node.js with no runtime dependencies, written
fresh; static bearer tokens first, OIDC last; working name `brain-store`.
No commits until the user asks; `npm test` after each stage. The working tree
already carries unrelated uncommitted work (verify command, prompts, installer,
quarantine) — do not touch those files.

The previous plan in this file (Aug-31 scan build, finished 2026-09-03) is in git
history.

## Stage 1 — contract, reference server, conformance suite, CLI

- [x] `store/CONTRACT.md` — prose spec, v1 (what clients use today) + v1.1 (`ETag`, `If-None-Match`, `If-Match` → `412`)
- [x] `store/openapi.yaml` — OpenAPI 3.1 for the same surface
- [x] `store/lib/tar.js` — zero-dep gzip+tar reader: count regular files, bounded against tar/gzip bombs
- [x] `store/lib/storage.js` — file-only storage: `DATA_DIR/brains/<user>/<brain>/{current.bin,meta.json,versions/}`, atomic swap, 5 snapshots, optional AES-256-GCM at rest
- [x] `store/lib/auth.js` — static bearer tokens, stored as SHA-256 hashes in `users.json`, constant-time compare
- [x] `store/server.js` — `createStore(opts)` HTTP handler: `/health`, `/auth/me`, `/api/brains` CRUD, `/sync` up/down, `/versions`, restore; empty-push guard, upload limit, per-token rate limit
- [x] `store/bin/brain-store.js` — `serve`, `user add|list|rotate|remove`, `keygen`
- [x] `store/conformance/` — black-box suite over `STORE_URL` + `STORE_TOKEN`; spins up the reference server when unset
- [x] CLI: `brain cloud login --api-url URL --token-stdin | --token T | BRAIN_STORE_TOKEN`; no refresh for a static token
- [x] CLI: remember the last pulled/pushed checksum, send `If-Match` on push, explain `412`; `--force` to override
- [x] `package.json`: `brain-store` bin, `store/` in `files`, store + conformance suites in `npm test`
- [x] `npm test` green

## Stage 2 — stateless MCP server with remote memory

- [x] Connector: identity seam `CONNECTOR_IDP=firebase|static` behind one interface (`src/identity.ts`); Firebase stays the default
- [x] Connector: `static` provider — login page takes the store token; token forwarded to the store
- [x] Connector: `If-Match` on sync-back; on `412` discard the copy, re-pull, re-apply the write, push again
- [x] `store/deploy/` — Docker Compose (store + connector + Caddy TLS), `.env.example`, two Dockerfiles, root `.dockerignore`
- [x] `store/SELF-HOSTING.md`, `store/README.md`, self-hosting section in `SECURITY.md`, connector README
- [x] brain-cloud (Go): `ETag` / `If-None-Match` / `If-Match` on `/sync` and restore, archive validation, `/health` discovery fields, tests

## Stage 3 — OIDC

- [x] Store: verify OIDC ID tokens (discovery + JWKS, RS256/ES256), auto-provision by issuer + `sub` (`store/lib/oidc.js`)
- [x] Connector: `CONNECTOR_IDP=oidc` — authorization code + PKCE + nonce against any OIDC issuer, refresh (`src/oidc-idp.ts`, `/oidc/callback`)
- [x] Tests against an in-process mock issuer that signs real tokens (`store/test/mock-issuer.js`)
- [x] Docs

## Review (2026-09-18)

All three stages built, uncommitted. Nothing pushed, published or deployed.

Verification:
- `npm test` in `brain`: 920 → 1034 tests, all passing. New: 35 conformance, 38 reference-server,
  28 OIDC, 13 CLI-against-store.
- `npm test` in `brain/connector`: all 12 existing suites still pass, plus `selfhost` and `oidc`.
- `go test -race ./...` in `brain-cloud`: all passing, 14 new tests.
- The conformance suite also passes (35/35) against the Dockerised store through Caddy, which is
  the only run that was truly black-box over a network path. The Compose stack was built, started,
  smoke-tested and torn down locally.

What changed vs. the plan:
- Encryption at rest is store-local HKDF + AES-256-GCM, not a reuse of `src/crypto.js`: that module is
  passphrase/PBKDF2-shaped, and `store/` should be movable to its own repository without importing `../src`.
- The 412 retry lives in the connector's write path (`writeThenSync` in `server.ts`), not in
  `store.ts`. Unpacking a newer archive over a working copy would leave the index and the memory
  files inconsistent; discarding the copy and re-running the write on a fresh one does not.
- Found and fixed on the way:
  - macOS `tar` added an AppleDouble `._name` entry per file to every pushed archive (file count 10 for 3 files). `COPYFILE_DISABLE`.
  - Connector: a user with a brain record but no archive was treated as a store outage on session renewal.
  - brain-cloud: `RestoreVersion` never updated the brain record, so `X-Checksum` and `file_count`
    described the replaced archive. With `ETag` that would have broken conditional sync after any restore.
- `CONNECTOR_TRUST_PROXY` was needed: the connector trusted only a loopback proxy, which is wrong
  when Caddy is another container. `true` is refused.

Not done / follow-ups:
- The conformance suite has not been run against a live Brain Cloud: that needs a database and a
  disposable account. The Go unit tests cover the same behaviours.
- OIDC is verified against a mock issuer only. It has not met Entra, Google or Keycloak.
- `README.md` does not mention the store: it carries someone else's uncommitted edits, so it was left alone.
- GOVERNANCE.md says contract changes go through a public `rfc` issue. The `rfc` label and the issue
  for this contract still have to be created on GitHub.
- The brain-cloud change needs a deploy to take effect for hosted users. Until then Brain Cloud
  ignores `If-Match` and the CLI behaves as before.
- Pull is still "unpack over the local brain". After a 412 the CLI tells the user to pull then push,
  which is right for append-mostly memories but still overwrites same-named local files, `index.json`
  included. A real merge is the per-memory contract's job (future RFC).
- `npm run test:integrations` was run afterwards: all five suites pass.

## After the push (2026-09-18)

- Pushed as four commits (`c4435ca`, `c2c9fd9`, `20bc4eb`, `6142516`). The contract RFC is open as #6.
- CI: 14 of 15 jobs passed first time, on Linux, macOS and Windows with Node 18 to 24. The
  Node 18 / Ubuntu job hung once: `npm test` printed the conformance suite's results and then
  nothing for 16 minutes, until cancelled. Node 18 runs files in sorted order, so the process that
  never exited was the next one, `store/test/oidc.test.js`. A re-run of the same job passed in 17
  seconds. It did not reproduce in 25 runs of that file, 10 of the conformance suite and 4 full
  suites under `node:18` on Linux in Docker. Cause not found. The likeliest suspect is a `fetch`
  keep-alive socket keeping the event loop alive at exit on Node 18, but that is a guess.
  The CI jobs now have a time limit so a repeat fails in minutes instead of holding a runner for
  six hours. If it recurs, the next step is to move the test helpers from `fetch` to `http.request`
  with `agent: false`, so no connection pool outlives a test.
- At the committed state on this machine, `test/harvest.test.js` has one failing test. It failed
  before this work too: it enumerates the real `~/.codex` of whoever runs it. CI has no `~/.codex`,
  so it passes there, and an uncommitted change already in the working tree fixes it.

## The CI hang, second occurrence (2026-09-19)

- It recurred on the next-but-few push (`68c04d8`): Node 18 / Ubuntu again, output stopping at the
  identical line (393 log lines both times), one orphaned child process. The 10-minute job limit
  cancelled it, which also skipped the website deploy queued behind the tests.
- Re-reading the evidence: the orphan is the FIRST child started, and Node 18 starts files in sorted
  order, so the stuck process was `store/conformance/conformance.test.js` itself, after all 35 of
  its tests had passed and been printed. Not the next file, as first assumed.
- Fix: the store test helpers no longer use `fetch`. `rawRequest()` makes each request on a socket
  of its own (`agent: false`, `Connection: close`), so no pooled connection can outlive the test
  process. The OIDC tests give the verifier the same transport (`plainFetch`). The default-`fetch`
  path is still covered by the connector's OIDC test, which runs on Node 22.
- Still unproven: the hang never reproduced locally (now 37 Linux runs under `node:18`), so this is
  a fix for the most likely cause, confirmed only by CI staying green over time.
