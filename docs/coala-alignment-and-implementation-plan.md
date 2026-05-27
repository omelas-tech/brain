# Brain Memory × CoALA — Alignment Analysis & Implementation Plan

**Status:** Implemented (Phases 0–4 + Tier B §10.1–10.4) — 2026-05-27
**Date:** 2026-05-27
**Scope:** Close the gap between Brain Memory's current architecture and the CoALA four-memory model, so Brain becomes a *complete* agentic memory system rather than a deep but lopsided episodic engine.

---

## 1. Executive Summary

Brain Memory is, today, an exceptional **episodic** memory engine. It implements decay, spaced reinforcement, Hebbian association, spreading activation, consolidation, sleep-cycle reorganization, and forensic erasure — machinery that goes far beyond what any published framework describes for the *hardest* memory type to get right.

But measured against **CoALA** (Cognitive Architectures for Language Agents, Princeton), Brain has a structural blind spot: it borrows CoALA's taxonomy as a **metadata field** (`cognitive_type: episodic | semantic | procedural`) without implementing the distinct *access patterns* each type requires. All three cognitive types flow through one episodic store, differentiated only by small decay/strength parameter tweaks. The result:

- **Semantic memory** that should be *always present* in context is instead recall-gated and can silently fail to load.
- **Semantic facts** that should be *stable* nonetheless decay.
- **Procedural memory** that should be *executable with progressive disclosure* is merely a descriptive note.
- **Working memory** (the context window) is consumed by Brain's session-start injection with no *budget awareness*.

This document analyzes the gap, states the design rationale for each fix, and lays out a phased, back-compatible implementation plan. The central design move is to **decompose CoALA's monolithic "semantic memory" into two orthogonal properties** — `pinned` (always in context) and `stable` (never decays) — making Brain strictly *more* expressive than CoALA while staying true to its "file system IS the database" philosophy.

---

## 2. Background — The CoALA Four-Memory Model

CoALA maps an LLM agent's memory onto four types, by analogy to human memory:

| # | Type | Human analogy | Definition | Canonical implementation |
|---|------|---------------|------------|--------------------------|
| 1 | **Working** | Short-term / RAM | Everything the agent sees *right now*: conversation, system instructions, loaded files. Fast, volatile, size-limited. | The context window itself |
| 2 | **Semantic** | Factual knowledge | Facts, rules, conventions, documentation the agent knows *in general*. **Always present in context.** | A `CLAUDE.md` loaded at the start of every session |
| 3 | **Procedural** | Learned skills | *How* to do things — step-by-step workflows. Uses **progressive disclosure**: advertise a lightweight index → load full instructions on match → pull resources only at execution. | Agent Skills / `SKILL.md` folders |
| 4 | **Episodic** | Personal experience | A *distilled* record of past interactions, decisions, and what was learned. Not full transcripts — compressed, useful experience. Forgetting is an explicit engineering problem. | Cross-session auto-memory notes |

**Key CoALA insight:** not every agent needs all four. A reflex bot needs only working memory; a password-reset bot adds procedural; a *coding agent needs all four*. Brain targets coding agents — so all four matter.

**The architectural claim Brain currently under-honors:** these are *distinct subsystems with distinct access patterns*, not one store with four labels.

---

## 3. Current State — What Brain Memory Actually Is

Grounded in the implementation:

### 3.1 Write path — `bin/memorize.js`
- `TYPE_DEFAULTS` sets base strength/decay per memory type (decision 0.85/0.995 … observation 0.40/0.950).
- `COGNITIVE_ADJUSTMENTS` tweaks those by cognitive type:
  - `episodic`: strength +0.10, decay ×0.995 (higher initial, faster decay)
  - `semantic`: strength +0, decay ×1.0 (**default decay — i.e. it still decays**)
  - `procedural`: strength −0.10, decay ×1.003 (lower initial, slower decay)
- `buildMemoryFileContent()` / `buildIndexEntry()` write YAML frontmatter + index entry.

### 3.2 Read path — `bin/recall.js` → `src/scorer.js`
- `computeDecayedStrength(base, rate, lastAccessed)` = `base × rate^days`. **Applies to every memory, unconditionally.**
- `rankMemories()` composite v4 score weights: relevance 0.38, decayed-strength 0.18, recency 0.08, spreading 0.14, context 0.14, salience 0.08.
- Everything is **recall-gated**: a memory only enters context if TF-IDF + the composite score surface it.

### 3.3 State files — `src/index-manager.js`
- `index.json` — `{ version, memory_count, memories: {id → entry}, last_updated }`
- `associations.json` — Hebbian edge graph
- `contexts.json`, `review-queue.json`, `search-index.json`, `_archived/index.json`, per-dir `_meta.json`

### 3.4 Session injection — `hooks/session-start.md` + `prompts/{claude,gemini,openai,opencode}.md`
- No native session hooks exist; behavior is *embedded in the prompt* the agent reads at startup.
- Loads index, surfaces top 3–5 memories by effective strength, prints a 1–3 line status. **No token budget; no guaranteed-present layer.**

### 3.5 Maintenance — `commands/brain/sleep.md`
- 9 phases including **Semantic Crystallization** (extract generalizable knowledge from frequently-recalled episodic memories) — proving the "promote one memory type into another" pattern already exists.

---

## 4. Gap Analysis

### 4.1 Type-by-type

| CoALA type | Brain today | Verdict |
|---|---|---|
| **Working** | Fed at session start, but no context-budget awareness | ⚠️ Delegated correctly, but unmanaged |
| **Semantic (always-loaded)** | Recall-gated; can silently miss | ❌ Missing the defining property |
| **Semantic (stable/non-decaying)** | `decay ×1.0` → still decays | ❌ Facts fade |
| **Procedural (executable)** | Descriptive tag only; no progressive disclosure | ❌ Biggest gap |
| **Episodic** | Decay, reinforcement, association, spreading, consolidation, sleep, erasure | ✅✅ Over-delivers |

### 4.2 What Brain has that CoALA never mentions (keep — this is the moat)
Biological strength/decay · spaced reinforcement · associative network + Hebbian learning + spreading activation · context-dependent recall · salience & confidence · consolidation · sleep cycle (homeostasis, crystallization, REM dreaming, expertise detection) · forensic erasure · deterministic cross-agent TF-IDF recall · life-domain hierarchy · portable encrypted sync.

CoALA explicitly calls episodic *"the hardest type to get right"* and leaves forgetting as an open *"engineering problem."* Brain's entire moat is solving exactly that.

### 4.3 What CoALA describes that Brain lacks
1. **Procedural-as-executable-skills** with progressive disclosure.
2. **Semantic-as-always-present** knowledge layer.
3. **Semantic facts that don't decay.**
4. **Working-memory budget awareness.**

### 4.4 Root cause
Brain treats CoALA's taxonomy as **metadata, not architecture.** A semantic memory and an episodic memory differ only by decay parameters — not by how they are stored, retrieved, or surfaced. CoALA's thesis is that they should differ in *access pattern*. This document's plan introduces those missing access patterns.

---

## 5. Design Rationale

Five decisions shape the plan. Each is chosen to *extend* Brain's strengths, not bolt on a parallel system.

### 5.1 Decompose "semantic" into `pinned` + `stable` (orthogonal)
CoALA conflates two properties in "semantic memory": *always in context* and *never fades*. Brain can separate them:
- **`pinned`** → injected into working memory every session (the always-present property).
- **`stable`** → exempt from decay and pruning (the doesn't-fade property).
- A pinned memory is implicitly stable; a stable memory need not be pinned (a trusted fact you recall on demand but that never decays).

**Why:** this makes Brain *more* expressive than CoALA, fits the existing frontmatter model with two boolean flags, and lets users distinguish "this convention must always load" from "this fact is timeless but only relevant sometimes."

### 5.2 Pinning is the fix for the live reliability bug — so it ships first
Today a user who stores `"always use tabs"` as a `preference` reasonably expects it to apply, but it only loads if TF-IDF happens to surface it. That is a **trust failure in the core promise** of a memory system, not a missing nicety. Pinned-semantic is therefore the highest-value work and is sequenced immediately after the foundations.

### 5.3 "Brain is the brain; the host is the hands" for procedural memory
The host agent (Claude Code, Gemini CLI) *already has* a native Agent Skills primitive (`SKILL.md`). Re-implementing an execution engine inside Brain would duplicate well-supported infrastructure and create a maintenance burden with little differentiation.

**Decision:** Brain owns the *storage and distillation* of procedural knowledge (which procedures matter, learned across sessions) and serves them via progressive disclosure; it **optionally exports** them into the host's native skill format. Brain decides *what* to remember and *which skills are worth having*; the host executes. This mirrors the existing split where the agent decides *what* to memorize and the CLI handles *how* to persist it.

### 5.4 Learned skills, not just hand-authored ones (the novel contribution)
CoALA describes procedural memory as authored skills. Brain can do something CoALA does not: **crystallize procedural skills from repeated episodic experience** — detect that the same kind of task was solved the same way N times and distill it into a `SKILL.md`. This reuses the exact pattern already proven by the Semantic Crystallization sleep phase and is Brain's genuine value-add to the procedural layer.

### 5.5 Budget awareness, not context management
Brain should not manage the context window (that is the host's job, and CoALA agrees working memory is delegated). But Brain's always-present layer (pins + skills index) plus session recall *consume* working-memory budget. Brain must be **budget-aware** so it cannot bloat context. We use a cheap `chars/4` token heuristic computed at write time — **no tokenizer dependency**, honoring the "no runtime dependencies" principle.

### 5.6 Principles every change must respect
From `CLAUDE.md`:
1. File system IS the database — new state is plain JSON/Markdown, browseable.
2. Agent-driven intelligence — the agent decides *what*; CLIs handle *how*.
3. No runtime dependencies — pure file I/O, heuristic token counts.
4. Human-readable — YAML frontmatter + Markdown.
5. Git-friendly — all new files sync cleanly.
6. **Back-compatibility** — every new field is optional with a safe default; existing brains keep working untouched.

---

## 6. Implementation Plan

### CoALA-gap → phase map

| CoALA gap | Phase |
|---|---|
| Working-memory budget awareness | **0** |
| Semantic always-loaded (`pinned`) | **1** |
| Semantic non-decaying (`stable`) | **1** |
| Procedural executable + progressive disclosure | **2** |
| Procedural learned (crystallization) | **3** |
| Host-skill export bridge + hardening | **4** |

```
Phase 0 (budget substrate) ─┬─► Phase 1 (pins + stable)      first usable win, fixes live bug
                            └─► Phase 2 (skills storage) ─► Phase 3 (crystallization) ─► Phase 4 (export/polish)
```

---

### Phase 0 — Foundations: budget-aware working memory
*Closes CoALA type 1. Unblocks Phases 1–2.*

**New `~/.brain/config.json`** (created lazily, safe defaults):
```json
{
  "working_memory_budget_tokens": 3000,
  "pin_budget_tokens": 1500,
  "skills_index_budget_tokens": 800,
  "recall_budget_tokens": 700
}
```

**Token estimation (no dependency):** `Math.ceil(chars / 4)` computed at write time, stored as `token_estimate` on each index entry. Added in `buildIndexEntry()` (`bin/memorize.js`).

**New aggregator `bin/session-start.js` → `brain-session-start`:** one deterministic call returning the budget-bounded startup payload:
```json
{
  "memory_count": 0,
  "pinned": [{ "id": "", "title": "", "content": "", "tokens": 0 }],
  "skills_index": [{ "name": "", "description": "" }],
  "context_recall": [{ "id": "", "title": "", "score": 0 }],
  "due_for_review": 0,
  "low_confidence_alerts": [],
  "budget": { "used": 0, "cap": 3000 }
}
```
Selection order under budget: all global + current-project pins (by `pin_priority`, then strength) → skills-index summaries → top-K context recall. Reports included/excluded counts.

**Files:** `bin/session-start.js` (new) · `bin/memorize.js` (token estimate) · `src/index-manager.js` (config read/write helpers) · `hooks/session-start.md` + 4× `prompts/*.md` (call the aggregator) · `package.json` (bin map).

**Acceptance:**
- `brain-session-start` returns valid JSON within budget on an existing brain.
- Total injected tokens never exceed `working_memory_budget_tokens`; overflow is reported, not silently dropped.

---

### Phase 1 — Pinned semantic tier + stable flag
*Closes CoALA type 2 + 2b. Highest value — fixes the live reliability hole.*

**Schema additions** (frontmatter + index entry; all optional):
| Field | Default | Meaning |
|---|---|---|
| `pinned` | `false` | Always injected at session start |
| `pin_scope` | `"global"` | `"global"` always loads; `"project:<name>"` loads only in that project |
| `pin_priority` | `0` | Tie-break ordering under budget |
| `stable` | `false` | Decay-exempt; never pruned/archived |

**Decay exemption** — `src/scorer.js`:
```js
function computeDecayedStrength(base, rate, lastAccessed, stable = false) {
  if (stable) return base;          // stable facts do not fade
  const days = (Date.now() - new Date(lastAccessed)) / 86400000;
  return base * Math.pow(rate, days);
}
```
Rule: `pinned ⇒ stable`. In `commands/brain/sleep.md`, the Replay, Synaptic Homeostasis, and Prune phases **skip** `stable`/`pinned` memories (never scaled down, never pruned, never archived).

**New manifest `~/.brain/pinned.json`** — `{ version, pins: [{ id, scope, priority, token_estimate }] }`. Lets `brain-session-start` load pins without scanning all of `index.json`.

**CLIs:**
- `brain-pin <id> [--scope global|project:<name>] [--priority N]`
- `brain-unpin <id>`
- Extend `bin/memorize.js` payload to accept `"pinned": true, "pin_scope": "...", "stable": true` so a memory can be born pinned.

**Commands:** `commands/brain/pin.md`, `commands/brain/unpin.md` (new) · update `commands/brain/memorize.md` so the agent *proposes* pinning when content is a durable convention/preference (type ∈ {preference, decision, insight, relationship}, high confidence, low time-sensitivity).

**Acceptance:**
- A pinned `preference` appears in context every session regardless of recall score.
- It survives a simulated 2-year decay and a full `/brain:sleep` cycle with unchanged strength.
- Project-scoped pins do not load outside their project.

---

### Phase 2 — Procedural skills layer (executable + progressive disclosure)
*Closes CoALA type 3.*

**Storage `~/.brain/_skills/<skill-name>/SKILL.md`** — frontmatter:
```yaml
name: structured-code-review
description: One-paragraph advertised summary (~100 tokens) used for matching.
triggers: ["code review", "review PR", "audit changes"]
cognitive_type: procedural        # already gets decay ×1.003 (slow decay once established)
strength: 0.6
last_used: null
use_count: 0
```
Body = step-by-step instructions. Optional `resources/` subdir (templates, scripts) referenced by relative path — pulled only at execution.

**Index `~/.brain/skills-index.json`** — the lightweight advertised list (`name`, `description`, `triggers`, `path`, `strength`, `use_count`, `last_used`).

**Progressive disclosure — three levels (exactly as CoALA describes):**
1. **L0 (always):** session-start injects only index summaries (name + description), budget-capped by `skills_index_budget_tokens`.
2. **L1 (on match):** task matches a skill's triggers/description → agent reads full `SKILL.md`.
3. **L2 (on execution):** `resources/` loaded only when a step needs them.

**CLIs:** `brain-skill list | show <name> | use <name> | add | remove <name>`.
- `use` reinforces (strength boost + `use_count++` + `last_used`) — procedural memory strengthens with practice, matching the existing reinforcement model.

**Commands:** `commands/brain/skill.md` (new) · session-start injects L0 summaries alongside pins.

**Acceptance:**
- Session start shows skill *names + descriptions only* (~100 tok each), not full bodies.
- A matching task triggers a full `SKILL.md` read; a referenced template loads only at execution.
- `brain-skill use` increments usage and boosts strength deterministically.

---

### Phase 3 — Procedural crystallization (the learned-skills loop)
*Brain's novel contribution beyond CoALA.*

Add a **"Procedural Crystallization"** phase to `commands/brain/sleep.md`:
- Cluster procedural/experience episodic memories via existing tag overlap + association edges.
- When the same kind of task was solved the same way ≥ N times, propose distilling the cluster into a `SKILL.md` (agent-authored, user-confirmable — never silent).
- Reuses the established Semantic Crystallization pattern (episodic → semantic) for episodic → procedural.

**Files:** `commands/brain/sleep.md` (new phase) · reuse clustering in `src/scorer.js` / `src/index-manager.js`.

**Acceptance:** given ≥N similar procedural episodic memories, a sleep run proposes a concrete `SKILL.md` draft with steps drawn from the source memories.

---

### Phase 4 — Host bridge + hardening
- **`brain-skill export <name> --target claude|gemini`** — emit native `.claude/skills/<name>/SKILL.md` (or Gemini equivalent) so learned skills become directly executable by the host.
- **Sync:** add `pinned.json`, `skills-index.json`, `config.json`, and `_skills/` to the include/allowlists in `src/git-sync.js` and `src/export-import.js` (and cloud path in `src/cloud-sync.js`).
- **Tests** (`test/`): pin/unpin round-trip · decay exemption across a sleep cycle · progressive-disclosure level boundaries · budget capping and overflow reporting · crystallization proposal.
- **Docs:** `README.md` · all 4 `prompts/*.md` · `CLAUDE.md` / `GEMINI.md` / `AGENTS.md` · `CHANGELOG.md`.

---

## 7. Cross-Cutting Concerns

- **Back-compatibility:** all new fields optional with safe defaults (`pinned=false`, `stable=false`); new files (`config.json`, `pinned.json`, `skills-index.json`, `_skills/`) created lazily. A pre-existing brain works unchanged and gains nothing until the user opts in.
- **Determinism:** `brain-session-start` and `brain-skill` selection must be deterministic (sorted, tie-broken) to preserve cross-agent consistency — the same guarantee the recall engine already provides.
- **Security:** new write paths reuse `validateBrainPath()` and `atomicWriteSync()` from `src/index-manager.js`. `_skills/resources/` scripts are *referenced*, never auto-executed by Brain — execution is the host's decision.
- **Sync correctness:** verify encrypted export/import (`src/crypto.js`) round-trips the new files.

---

## 8. Risks & Open Questions

| Risk / question | Mitigation / note |
|---|---|
| Pin bloat silently shrinks usable context | Hard `pin_budget_tokens` cap; overflow reported in status, not dropped silently |
| `chars/4` token estimate drifts from real tokenizer | Acceptable for budgeting; conservative cap absorbs error; revisit only if it misbehaves |
| Duplicating host skills | Resolved by §5.3 — Brain stores/distills, host executes; export is opt-in |
| Crystallization produces low-quality skills | Always user-confirmable; never silent; N-threshold tunable |
| `stable` misused on genuinely volatile facts | Agent guidance in `memorize.md` restricts `stable` to high-confidence, time-insensitive facts |
| Open: should project-scoped pins auto-load in monorepo subprojects? | Defer; start with exact project-name match |

---

## 9. Outcome

When complete, Brain spans all four CoALA memory types with *distinct access patterns*, while keeping the episodic engine that is its moat:

- **Working** — budget-aware injection via `brain-session-start`.
- **Semantic** — `pinned` (always present) + `stable` (never decays), decomposed beyond CoALA.
- **Procedural** — `_skills/` with progressive disclosure, *learned* from episodic experience and exportable to the host.
- **Episodic** — unchanged and best-in-class.

Brain stops being "a great answer to one of CoALA's four questions" and becomes a complete, opinionated answer to all four.

---

## 10. Tier B — Extensions Beyond the Planned Phases

Phases 0–4 (§6) close the four CoALA *type* gaps. The transcript that motivated this work raises a second class of problems that those phases do **not** address — questions about memory *correctness and hygiene over time*. CoALA names them but offers no mechanism: *"What do you delete? When does information become obsolete? If a user changes jobs, do you keep the old project memories?"* and the observation that performance degrades when too much is "buried in the middle of the context window." These four extensions answer those questions. They are sequenced *after* Phases 0–1 because three of them depend on the `pinned`/`stable` substrate.

### 10.1 Obsolescence / context-shift detection
**Problem.** Decay handles *slow fade*, but not *abrupt relevance loss*. When a user changes jobs, switches stacks, or abandons a project, a whole cluster of memories becomes obsolete overnight — yet they may still carry high strength (recently accessed) and so keep surfacing. Decay is the wrong tool: the facts didn't gradually weaken, their *context* died.

**Design.** Add a **context-shift detector** to `commands/brain/sleep.md`, downstream of the existing context tracking in `contexts.json`:
- Detect when a project/role/domain present in older memories has been **absent from the last N sessions** (signal already available in `contexts.json`).
- Flag the affected memory cluster (by `encoding_context.project` + association edges) as *candidate-obsolete* — never auto-delete.
- Surface candidates in `/brain:review` and `/brain:status` for explicit user confirmation → archive (not erase; reversible via `_archived/`).
- **Interaction with `stable`:** `stable` exempts a memory from *decay*, not from *obsolescence* — a stable fact about a former employer is still obsolete. Context-shift can flag `stable` memories; only `pinned` (an explicit, active user choice) is exempt.

**Why not just faster decay.** Decay can't distinguish "I haven't touched this in a while" from "this world no longer exists." Obsolescence is a *context* judgment, not a *time* one.

### 10.2 Contradiction detection & resolution
**Problem.** This becomes **critical the moment `stable` ships** (Phase 1). A non-decaying fact that is *wrong* is more dangerous than a fading one — it never weakens out of contention on its own. If a user pins `"use tabs"` and later establishes `"use spaces"`, Brain must not silently serve both.

**Design.** At write time in `bin/memorize.js` (and as a sleep-phase sweep for existing memories):
- When a new memory's `(type, tags, encoding_context.project)` strongly overlaps an existing `pinned`/`stable` memory but the **content asserts the opposite**, raise a **contradiction candidate** rather than storing blindly.
- Resolution is **agent-mediated, user-confirmable** (consistent with §5.4's "never silent"): supersede (archive old, keep new), keep-both-scoped (e.g. per-project), or reject new.
- Record supersession as an association edge (`type: "supersedes"`) so history is auditable — Brain's git-friendliness means the old fact is never truly lost.

**Detection heuristic (no new dependency):** same TF-IDF/tag-overlap clustering already in `src/scorer.js` finds *candidate* conflicts; the *judgment* that two memories contradict is the agent's call, surfaced for confirmation. Brain finds suspects; the agent + user adjudicate.

### 10.3 Skill failure feedback (procedural demotion)
**Problem.** Phase 2's `brain-skill use` only *strengthens* a skill (use_count++, strength boost). But procedural memory should also **weaken on failure** — a crystallized skill (Phase 3) that produces a bad outcome should decay out of the advertised index, not entrench itself through mere invocation count.

**Design.** Extend the procedural layer with an outcome signal:
- `brain skill use <name> [--ok | --failed]` (default `--ok` for back-compat). `--failed` applies a strength penalty and increments a `fail_count`.
- A skill whose `fail_count / use_count` exceeds a threshold drops below the L0 advertisement cutoff (still on disk, just no longer auto-suggested) — the procedural analogue of archival.
- Pairs naturally with Phase 3: crystallized skills are *hypotheses*; the feedback loop is what validates or retires them. This is the difference between "learned a skill" and "learned a *good* skill."

**Why it matters.** Without a failure path, crystallization (§5.4) is a one-way ratchet that can only accumulate procedures, including bad ones. The demotion path is what makes "learned skills" trustworthy.

### 10.4 "Lost-in-the-middle" ordering of injected context
**Problem.** Phase 0 caps the *size* of the session-start payload. The transcript flags a distinct failure: models attend worst to content "buried in the middle" of a long context. Two payloads of identical token count can perform very differently depending on *ordering*.

**Design.** Make `brain-session-start` emit its budget-bounded payload in a **primacy/recency-aware order**, not just importance-descending:
- Highest-priority pins and the most relevant recalled memory go to the **edges** (start and end) of the injected block; lower-priority items fill the middle.
- Deterministic (sorted, tie-broken) to preserve cross-agent consistency (§7).
- Pure ordering change — zero new state, no token cost. A near-free reliability gain layered on Phase 0.

### 10.5 Tier B sequencing
```
Phase 0 ─► Phase 1 (pins + stable) ─┬─► 10.2 contradiction  (stable makes this urgent)
                                     ├─► 10.1 obsolescence   (reuses contexts.json)
                                     └─► 10.4 ordering        (free, layers on Phase 0)
Phase 2 ─► Phase 3 (crystallization) ─► 10.3 skill failure feedback
```
**Recommended insertion:** 10.4 folds into Phase 0 (it's an ordering tweak to the same payload). 10.2 should ship **with or immediately after** Phase 1 — it is a safety prerequisite for `stable`, not an enhancement. 10.1 and 10.3 are genuine follow-ons.

---

## 11. CLI Surface Consolidation (cross-cutting, decided)

**Decision (2026-05-27):** Before adding the new entry points the phases imply (`session-start`, `pin`/`unpin`, `skill`), collapse the multi-binary surface into a **single `brain` dispatcher** (`brain recall`, `brain memorize`, `brain pin`, `brain skill list`, …) — the git/docker/kubectl pattern. Chosen approach: **hard break** (appropriate pre-1.0 at `0.1.0-beta.14`).

**Rationale.** The current map is five top-level binaries (`brain-memory`, `brain-recall`, `brain-reinforce`, `brain-cloud`, `brain-memorize`); the phases would push this toward nine-plus, with inconsistent nesting (`brain-skill` would itself need subcommands). A single dispatcher makes `brain --help` the discovery surface, lets every new feature ship as a subcommand with no `package.json`/PATH churn, and reads better (`brain skill list` > `brain-skill list`).

**Implementation.**
- New `bin/brain.js` dispatcher: routes `recall|reinforce|memorize|cloud|session-start|pin|unpin|skill` by stripping the subcommand token and delegating; bare `brain` / `install|update|uninstall` route to the installer (preserves `npx brain-memory` via npm's single-bin fallback). Each `bin/*.js` stays directly runnable so existing tests (which `require` `src/` or run `node bin/*.js`) are unaffected.
- `package.json` `bin` reduces to `{ "brain": "bin/brain.js" }`.
- All CLI invocations in `prompts/*.md`, `commands/brain/*.md`, root agent files, and `README.md` migrate to `brain <subcommand>`. **Slash-command names** (`/brain:memorize`, Codex's `/brain-memorize`) and **skill-folder identifiers** are a separate namespace and are left unchanged.
- The internal `execSync('brain-cloud push')` in `bin/memorize.js` becomes `brain cloud push`.

**Consequence for the phase plan:** every "new `brain-X` CLI" in §6 is now a **`brain X` subcommand** of the dispatcher. The acceptance criteria are otherwise unchanged.
