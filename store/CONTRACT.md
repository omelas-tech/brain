# The Brain store contract

**Version 1.1** · Status: draft

This document specifies the HTTP interface between a Brain client and a remote
store. A client is anything that reads or writes a brain over the network: the
`brain` command line, the MCP connector, or a tool you write. A store is any
server that implements this document.

Two stores implement it today: `brain-store` in this directory, and the hosted
Brain Cloud service. The [conformance suite](conformance/) checks an
implementation against this document over HTTP and knows nothing about how the
store is built. [`openapi.yaml`](openapi.yaml) describes the same interface in
machine-readable form. Where the two disagree, this document is correct.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. Model

A **brain** is one person's memory: a directory of Markdown files with YAML
frontmatter, plus index files. A store holds each brain as a single
**archive**: a gzip-compressed tar file of that directory.

The store treats the archive as opaque. It MUST NOT need to read the memories
inside it, and MUST return exactly the bytes it was given. The one thing a
store derives from the contents is the number of regular-file entries in the
archive, reported as `file_count`.

Every brain belongs to exactly one user. A store MUST NOT let one user observe
that another user's brain exists.

A store MAY encrypt archives at rest. Checksums, sizes and file counts always
describe the archive as the client sent it, never the stored form.

## 2. Conventions

- Requests and responses are JSON (`application/json`) unless stated otherwise.
- An error is a JSON object with a string `error` member, and an HTTP status
  that reflects the failure. Clients MUST NOT parse the text of `error`.
- A **checksum** is the lowercase hexadecimal SHA-256 of the archive bytes.
- Brain identifiers are UUIDs.
- Timestamps are RFC 3339 strings in UTC.

## 3. Authentication

Every endpoint except `GET /health` requires `Authorization: Bearer <token>`. A
missing, malformed, unknown or expired token MUST yield `401`.

How a client obtains a token is outside the core contract. A store advertises
what it supports in the `capabilities` array of `GET /health`:

| Capability | Meaning |
|---|---|
| `static-token` | The operator issues long-lived tokens out of band. There is nothing to refresh. |
| `device-code` | The store implements the device-code login endpoints (`POST /auth/device/request`, `POST /auth/device/poll`, `POST /auth/refresh`). |
| `oidc` | The store accepts an OpenID Connect ID token from an issuer its operator configured as the bearer token, and creates the user on first sight. |

A store that lacks a capability MUST answer its endpoints with `404`.

Tokens are credentials. A store MUST NOT log them, and SHOULD store only a hash
of a static token. A client MUST NOT send a token over plain HTTP to a host
other than the local machine unless the user has explicitly allowed it.

## 4. Endpoints

### 4.1 `GET /health`

No authentication. `200` with:

```json
{ "status": "ok", "contract": "1.1", "capabilities": ["static-token", "conditional-sync"] }
```

`contract` is the highest version of this document the store implements. A
store that omits it implements version 1. Additional members are allowed.

### 4.2 `GET /auth/me`

`200` with `{ "user": { "id": "...", "email": "..." }, "storage_used": 12345 }`.
`user` MAY carry further members.

### 4.3 `GET /api/brains`

`200` with a JSON array of [brain records](#5-the-brain-record) owned by the
caller, oldest first. An account with no brains yields `[]`.

### 4.4 `POST /api/brains`

Body: `{ "name": "work" }`. The body, and `name`, are optional; the default name
is `default`. `201` with the new brain record. `403` when the account may not
create another brain.

### 4.5 `GET /api/brains/{id}`

`200` with the brain record. `404` when the brain does not exist or belongs to
someone else. `400` or `404` for a malformed identifier.

### 4.6 `DELETE /api/brains/{id}`

Removes the brain, its archive and its snapshots. `204`, or `200`.

### 4.7 `PUT /api/brains/{id}/sync` — upload

The body is `multipart/form-data` with one file field named `brain` that holds
the archive.

On success, `200` with:

```json
{ "size_bytes": 48211, "file_count": 132, "checksum": "9f2c…" }
```

and, from version 1.1, an `ETag` header carrying the same checksum.

Before replacing a stored archive, the store MUST keep the previous one as a
[snapshot](#49-snapshots). The replacement MUST be atomic: a concurrent download
sees the old archive or the new one, never a mixture, and a failed upload
leaves the old archive in place.

**The empty-push guard.** If the uploaded archive contains no regular files and
the stored brain has five or more, the store MUST refuse with `409` unless the
request carries `?force=true`. This protects against a freshly initialised
client overwriting a populated brain.

Other failures: `400` when the `brain` field is missing; `413` when the archive
exceeds the store's size limit or the account's quota; `429` when rate limited,
with a `Retry-After` header.

**Conditional upload (1.1).** Two clients that share a brain can otherwise
overwrite each other without noticing. A client SHOULD therefore make its
uploads conditional:

| Request header | Store behaviour |
|---|---|
| `If-Match: "<checksum>"` | Proceed only if the stored archive has that checksum. Otherwise `412`. A brain with no archive yet never matches. |
| `If-Match: *` | Proceed only if some archive is stored. |
| `If-None-Match: *` | Proceed only if no archive is stored yet. Otherwise `412`. |
| neither | Proceed unconditionally. This is version 1 behaviour and remains valid. |

A `412` response changes nothing. Its body carries the checksum the store
currently holds, so the client can tell what it is missing:

```json
{ "error": "precondition failed: …", "current_checksum": "41ab…" }
```

The precondition check and the replacement MUST be a single atomic step. When
two uploads carry the same `If-Match`, exactly one succeeds.

`?force=true` overrides only the empty-push guard. To overwrite on purpose, a
client omits `If-Match`.

**Archive validation (1.1).** The store MUST reject an upload that is not a
gzip-compressed tar archive with `400`, and SHOULD bound the inflated size and
the number of entries it is willing to examine.

### 4.8 `GET /api/brains/{id}/sync` — download

`200` with the archive as `application/gzip`, and an `X-Checksum` header. `404`
when nothing has been uploaded yet.

From version 1.1 the response also carries `ETag: "<checksum>"`, and the store
honours `If-None-Match`: when it names the stored checksum, the answer is `304`
with no body.

With `?version=<name>`, the response is that [snapshot](#49-snapshots) instead.
`404` when there is no such snapshot. The store MUST reject a name that is not
one it issued; in particular a name MUST NOT be able to address a file outside
the brain's snapshots.

### 4.9 Snapshots

`GET /api/brains/{id}/versions` → `200` with:

```json
{ "versions": [ { "version": "20260918T101500.123000000.tar.gz", "date": "2026-09-18T10:15:00Z" } ], "total": 1 }
```

newest first. `version` is an opaque name; `date` is optional. A store keeps at
least the most recent snapshot and MAY prune older ones.

`POST /api/brains/{id}/versions/{version}/restore` makes that snapshot the live
archive, first keeping the current archive as a new snapshot. `200` with
`{ "restored_version": "<name>" }`. `404` when there is no such snapshot. From
version 1.1 a restore honours `If-Match` exactly as an upload does.

## 5. The brain record

```json
{
  "id": "0b5f6c1e-6f0e-4a57-9d0a-4a1f2f1c9e11",
  "name": "default",
  "size_bytes": 48211,
  "file_count": 132,
  "checksum": "9f2c…",
  "last_synced_at": "2026-09-18T10:15:00Z",
  "created_at": "2026-09-01T08:00:00Z"
}
```

`checksum` and `last_synced_at` are `null` until the first upload. Additional
members are allowed.

## 6. What a client does

**Pull.** Download; if the client already has the archive with that checksum,
send `If-None-Match` and treat `304` as "nothing to do". Remember the checksum
of what was pulled as the brain's *base*.

**Push.** Upload with `If-Match: "<base>"`. On `200`, the returned checksum
becomes the new base. On `412`, pull first, then push again. A client that
writes small changes (a single new memory) SHOULD do this automatically; a
client acting on a whole directory SHOULD tell the user and let them decide.

**First push.** With no base, either upload unconditionally or, to be safe
against a concurrent first writer, send `If-None-Match: *`.

Unpacking an archive is the client's responsibility, and a client MUST treat it
as untrusted input: extract to a staging directory, copy only regular files and
directories, never follow or create symbolic links, and never write outside the
brain directory.

## 7. Versions of this contract

- **1** — Everything above except the parts marked 1.1. This is what Brain Cloud
  served before September 2026.
- **1.1** — Adds `contract` and `capabilities` to `GET /health`, `ETag` and
  `If-None-Match` on download, `If-Match` and `If-None-Match: *` on upload and
  restore, `current_checksum` in the `412` body, and archive validation. A
  version 1 client works unchanged against a 1.1 store.

A per-memory interface, where a client reads and writes single files with
content-hash preconditions instead of whole archives, is planned as a separate
proposal. It is not part of this document.

## 8. Checking an implementation

```bash
STORE_URL=https://store.example STORE_TOKEN=… node --test store/conformance/
```

Set `STORE_TOKEN_2` to a second user's token to include the isolation tests, and
`STORE_CONTRACT=1` to check only version 1. The suite overwrites the brain it
works on. Use a disposable account.
