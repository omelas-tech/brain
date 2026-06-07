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

## Hosted service: Brain Cloud & the connector

Brain Memory is **local-first** — by default your memories are plain files on your
own disk and never leave it. The hosted **Brain Cloud** sync hub and the **Claude
connector** (a remote MCP server) are entirely optional. When you do use them, this
is how your data is protected:

- **Encrypted at rest.** Brains stored in Brain Cloud are encrypted on disk with
  **AES-256-GCM** using a **per-user key** (HKDF-derived from a server master key).
  A stolen disk, backup, or snapshot yields no readable memories.
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

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x (beta) | Yes |

## Design Principles

- **No runtime dependencies** — Reduces supply chain attack surface
- **Local-first** — Sensitive data stays on disk by default; sync is opt-in
- **No stored credentials** — Git sync relies on the user's existing SSH keys or Git credential helpers; Brain Memory never stores auth tokens
