# Memory, reviewed in a pull request

Brain's git sync (`/brain:sync setup <url>`, then `brain sync push`) keeps `~/.brain/` in a
private repository. Every memory is a Markdown file, so a change to what your agents remember is
an ordinary diff.

[`brain-audit.yml`](brain-audit.yml) adds a check to that repository. On every push and pull
request it runs `brain audit` over the synced memory and writes a summary to the job page. The
check fails when the audit finds either of these:

- memories it would quarantine: write bursts, co-tagged low-trust cliques, quietly reinforced
  low-trust memories;
- **permission claims** ("pre-approved", "no need to confirm") that were never backed by your own
  words.

To use it, copy the file to `.github/workflows/brain-audit.yml` in the sync repository.
It only works with unencrypted sync, because with encryption on the repository holds ciphertext.
