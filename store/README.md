# store/

The open interface between a Brain client and a remote store, and a small server
that implements it.

| | |
|---|---|
| [CONTRACT.md](CONTRACT.md) | The store contract, version 1.1. Start here if you want to write a store or a client. |
| [openapi.yaml](openapi.yaml) | The same interface, machine-readable. |
| [conformance/](conformance/) | A black-box test suite. Point it at any store over HTTP. |
| [server.js](server.js), [lib/](lib/), [bin/](bin/) | `brain-store`, the reference server. Node.js, no dependencies, files only. |
| [SELF-HOSTING.md](SELF-HOSTING.md) | Running your own store and MCP connector. |
| [deploy/](deploy/) | Docker Compose: store, connector and Caddy for TLS. Start from `env.example`. |

## Why a contract

A brain is a directory of plain files that belongs to one person. Syncing it
should not tie that person to one vendor. The contract is deliberately small: a
store keeps each brain as an opaque archive, never reads the memories inside it,
and returns exactly the bytes it was given. Two stores implement it today: this
one, and the hosted Brain Cloud service.

Version 1.1 adds conditional sync. Two clients that share a brain, such as a
laptop and an MCP connector, used to be able to overwrite each other without
noticing. A client now names the archive it started from (`If-Match`), and a store
that has moved on refuses the upload.

## Running the tests

```bash
npm run test:store          # reference server + conformance suite
npm run test:conformance    # conformance suite alone, against the reference server

# against any other store
STORE_URL=https://store.example.com STORE_TOKEN=… node --test store/conformance/
```

## Writing another implementation

You need the endpoints in CONTRACT.md §4 and nothing else. The conformance suite
tells you when you are done. If the contract is unclear or the suite is wrong,
open an issue: changes to the contract go through the `rfc` process described in
[GOVERNANCE.md](../GOVERNANCE.md).
