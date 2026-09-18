# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately via email to **onur@omelas.tech**. Do not open a public GitHub issue for security vulnerabilities.

You should receive a response within 48 hours. Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

## Scope

Brain Memory handles sensitive data in several areas:

- **AES-256-GCM encryption** — Optional encryption for Git-synced and exported memory files using a user-provided passphrase (PBKDF2-SHA512, 100K iterations)
- **File system access** — Reads and writes to the `.brain/` directory tree
- **Git operations** — When sync is configured, pushes/pulls to a user-specified Git remote using the system `git` binary and the user's existing Git/SSH authentication

## Memory poisoning (OWASP ASI06)

Because Brain reloads stored memories into the model, a memory absorbed from
untrusted content — an email, a web page, a tool result — is an injection vector
([MemGhost](https://arxiv.org/abs/2607.05189)). Brain implements all five ASI06
defense layers; the full model is in the [Provenance & Trust](https://brainmemory.ai/docs/concepts/provenance-trust/)
docs:

- **Provenance ceilings.** Every memory records an `origin`; non-`user` origins
  are confidence-capped, decay faster, and **cannot pin or entrench** (refused at
  write, not silently capped).
- **Trust-weighted recall.** Origin trust multiplies the recall score and damps
  spreading-activation sources, so a co-tagged clique of planted writes can't
  self-amplify past a genuine memory.
- **Content lint.** Instruction-shaped writes (e.g. "ignore previous
  instructions", pipe-to-shell, secret exfiltration) are flagged regardless of
  the claimed origin.
- **Quarantine + verification.** Low-trust and lint-flagged writes land pending
  verification (`brain verify`); in `enforce` mode they are excluded from recall
  until approved.
- **Anomaly detection.** `brain audit` flags write bursts, low-trust cliques, and
  quietly-reinforced unverified memories (runs as `brain sleep` Phase 0).
- **Forensics + rollback.** An append-only `~/.brain/audit.log` (carried forward
  through restores) records every write, archival, and verification; `brain
  restore` rolls the whole brain back to a pre-attack snapshot.

`origin` is asserted by the writing agent, so this does not defend against a
fully hostile agent lying about provenance — but it holds for the dominant case
(an honest agent relaying poisoned content), and the entrenchment refusal and
lint hold regardless of the claimed origin.

## File-system safety

The `.brain/` tree and everything that writes into it (memorize, reinforce, pin,
forget, import) validate that resolved paths stay inside the brain directory,
including through symlinks (realpath checks); sync/import/export refuse `..`
traversal and never follow symlinks out of the tree; cloud snapshots are
extracted through a staging directory that drops symlink members.

## Hosted service: Brain Cloud & the connector

Brain Memory is **local-first** — by default your memories are plain files on your
own disk and never leave it. The hosted **Brain Cloud** sync hub and the **Claude
connector** (a remote MCP server) are entirely optional. When you do use them, this
is how your data is protected:

- **Encrypted at rest.** Brains stored in Brain Cloud are encrypted on disk with
  **AES-256-GCM** envelope encryption: each user's data is encrypted with a
  **per-user data key**, and that key is itself wrapped by a key held in a cloud
  **key management service (KMS)**, not on the server's disk. A stolen disk,
  backup, or snapshot yields no readable memories.
- **No plaintext on the connector.** The connector keeps each user's working copy
  in **RAM only** (a tmpfs, wiped on restart) — it is never written to the
  connector's disk.
- **Encrypted in transit.** All traffic to `api.brainmemory.ai` and the connector
  is HTTPS/TLS.
- **Strict tenant isolation.** Every cloud request is authorized against the
  authenticated user; one account can never read or overwrite another's brain.
- **Revocable sessions.** CLI sessions use **rotating refresh tokens with
  automatic reuse detection** — a replayed (stolen) token revokes the whole
  session family. You can log out a device, or **all** devices, at any time.
- **Verified-identity sign-in.** Connector and dashboard login is Google OAuth via
  Firebase; account-linking requires a **verified** email.
- **Least privilege.** The connector runs as an unprivileged, sandboxed service
  (systemd hardening: no new privileges, read-only filesystem, private tmp).

Because the cloud runs deterministic recall server-side, this is **server-side**
encryption at rest, not end-to-end encryption: the service necessarily processes
your memories in memory. If you require that the server never sees plaintext, keep
your brain **local-only** (the default) or use Git/export sync with a passphrase
(below) instead of Brain Cloud.

## Self-hosted store (`brain-store`)

`store/` contains a reference store server you can run yourself
(`store/SELF-HOSTING.md`). What it does and does not protect:

- **Tokens are never stored.** A token is 256 random bits, shown once; the server
  keeps its SHA-256 and compares in constant time. Tokens are never logged.
- **Failed logins are rate limited** per client address, and each user's request
  and upload rates are bounded.
- **Uploads are untrusted input.** Size is bounded before and while reading. The
  archive is inflated as a stream and only tar headers are examined, with bounds on
  inflated size and entry count, so a compression bomb cannot exhaust memory. The
  server never extracts an archive to disk.
- **Identifiers cannot leave the data directory.** User ids, brain ids and
  snapshot names are matched against strict patterns before any path is built.
- **Tenant isolation.** Another user's brain is indistinguishable from one that
  does not exist.
- **Optional encryption at rest** (AES-256-GCM, per-user key derived by
  HKDF-SHA256 from `STORE_ENCRYPTION_KEY`). This protects a stolen disk or backup.
  It is server-side encryption: the running server holds the key.
- **No TLS of its own.** The server speaks plain HTTP and binds to loopback by
  default. Terminate TLS in a reverse proxy; the provided Compose setup does.
- **Conditional writes.** The precondition check and the replacement of an archive
  happen under one in-process lock. Run one server process per data directory.

- **OpenID Connect sign-in is opt-in and narrow.** Only RS256 and ES256 are
  accepted; `none` and HMAC algorithms are refused, and the key type must agree
  with the algorithm named in the token. Issuer, audience, expiry and nonce are
  checked, the issuer must be reached over HTTPS, and its discovery document must
  name itself. A public issuer (Google) is refused unless an allow-list is set,
  and allow-lists only honour addresses the issuer marks verified.

The connector's `static` identity provider sends the pasted store token only to
the store named in `BRAIN_CLOUD_API_URL`, and refuses to start unless that address
is set explicitly. Its sign-in page loads nothing from other hosts and cannot be
framed. The token is kept with the refresh grant encrypted under
`CONNECTOR_STATE_KEY`; without that key it is held in memory only.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x | Yes |
| < 0.3 | No — please upgrade |

## Design Principles

- **No runtime dependencies** — Reduces supply chain attack surface
- **Local-first** — Sensitive data stays on disk by default; sync is opt-in
- **No stored credentials** — Git sync relies on the user's existing SSH keys or Git credential helpers; Brain Memory never stores auth tokens
