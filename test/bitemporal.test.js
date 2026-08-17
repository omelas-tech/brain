/**
 * Bitemporal validity — valid time (when a fact was true) vs record time
 * (when the brain learned it), and the supersession safety rules that hang
 * off it.
 *
 * Three groups:
 *   1. the validity window itself (write, validate, demote, time-travel)
 *   2. ASI06: a quarantined write must not demote a trusted memory
 *   3. archival must withdraw the supersessions it imposed
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { writeIndex, readIndex } = require('../src/index-manager');
const { receiptFor } = require('../src/receipt');
const {
  temporalState, validityOf, validateValidity, supersessionInstant, parseInstant,
} = require('../src/temporal');

const MEMORIZE = path.join(__dirname, '..', 'bin', 'memorize.js');
const RECALL = path.join(__dirname, '..', 'bin', 'recall.js');
const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');
const FORGET = path.join(__dirname, '..', 'bin', 'forget.js');

let tmpDir;
let brainDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-bitemporal-'));
  brainDir = path.join(tmpDir, '.brain');
  fs.mkdirSync(brainDir, { recursive: true });
  writeIndex({ version: '2.0', memory_count: 0, memories: {} }, tmpDir);
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const env = () => ({ ...process.env, HOME: tmpDir, USERPROFILE: tmpDir, BRAIN_DIR: brainDir });

function memorize(mem) {
  const stdout = execFileSync('node', [MEMORIZE], {
    input: JSON.stringify({ memories: [mem] }),
    env: env(),
    encoding: 'utf-8',
  });
  return JSON.parse(stdout);
}

/** memorize expecting a non-zero exit; returns the parsed stderr payload. */
function memorizeExpectingFailure(mem) {
  try {
    execFileSync('node', [MEMORIZE], {
      input: JSON.stringify({ memories: [mem] }),
      env: env(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return JSON.parse(err.stderr);
  }
  throw new Error('expected memorize to fail');
}

function recall(query, extraArgs = []) {
  const stdout = execFileSync('node', [RECALL, query, '--top', '10', ...extraArgs], {
    env: env(), encoding: 'utf-8',
  });
  return JSON.parse(stdout);
}

function verify(...args) {
  const stdout = execFileSync('node', [VERIFY, ...args], { env: env(), encoding: 'utf-8' });
  return JSON.parse(stdout);
}

function readFrontmatter(relPath) {
  return fs.readFileSync(path.join(brainDir, relPath), 'utf-8');
}

const base = {
  type: 'decision',
  content: 'The team ships the service to a single cloud region.',
  origin: 'user',
};

// ---------------------------------------------------------------------------
// 1. The validity window
// ---------------------------------------------------------------------------

describe('temporal: validity window primitives', () => {
  it('treats the window as half-open [from, until)', () => {
    const mem = { valid_from: '2026-03-01T00:00:00Z', valid_until: '2026-06-01T00:00:00Z' };
    assert.equal(temporalState(mem, Date.parse('2026-02-28T23:59:59Z')), 'future');
    // The lower bound is inclusive...
    assert.equal(temporalState(mem, Date.parse('2026-03-01T00:00:00Z')), 'current');
    assert.equal(temporalState(mem, Date.parse('2026-05-31T23:59:59Z')), 'current');
    // ...the upper bound exclusive: a fact that stopped being true at an
    // instant is not true at that instant.
    assert.equal(temporalState(mem, Date.parse('2026-06-01T00:00:00Z')), 'expired');
  });

  it('treats an unbounded memory as always current', () => {
    assert.equal(temporalState({}, Date.now()), 'current');
    assert.deepEqual(validityOf({}), { from: null, until: null });
  });

  it('rejects an inverted or unparseable window', () => {
    assert.ok(validateValidity({ valid_from: '2026-06-01', valid_until: '2026-03-01' }).error);
    // Equal bounds describe an empty interval — nothing is ever true in it.
    assert.ok(validateValidity({ valid_from: '2026-06-01', valid_until: '2026-06-01' }).error);
    assert.ok(validateValidity({ valid_from: 'last tuesday' }).error);
    assert.equal(validateValidity({ valid_from: '2026-03-01', valid_until: '2026-06-01' }), null);
    assert.equal(validateValidity({}), null);
  });

  it('takes a successor start from valid_from, else the record time', () => {
    assert.equal(
      supersessionInstant({ valid_from: '2026-03-01T00:00:00Z', created: '2026-08-01T00:00:00Z' }),
      '2026-03-01T00:00:00.000Z',
    );
    assert.equal(
      supersessionInstant({ created: '2026-08-01T00:00:00Z' }),
      '2026-08-01T00:00:00.000Z',
    );
    assert.equal(supersessionInstant({}), null);
  });
});

describe('temporal: write path', () => {
  it('persists the window to frontmatter and the index', () => {
    const out = memorize({
      ...base,
      title: 'Kafka consumers run in the Frankfurt region',
      path: 'professional/projects/kafka-region.md',
      valid_from: '2026-03-01T00:00:00Z',
      valid_until: '2026-06-01T00:00:00Z',
    });

    const fm = readFrontmatter(out.stored[0].path);
    assert.match(fm, /valid_from: "2026-03-01T00:00:00Z"/);
    assert.match(fm, /valid_until: "2026-06-01T00:00:00Z"/);

    const entry = readIndex(tmpDir).memories[out.stored[0].id];
    assert.equal(entry.valid_from, '2026-03-01T00:00:00Z');
    assert.equal(entry.valid_until, '2026-06-01T00:00:00Z');
  });

  it('refuses an inverted window at write time', () => {
    const err = memorizeExpectingFailure({
      ...base,
      title: 'Inverted window',
      path: 'professional/projects/inverted.md',
      valid_from: '2026-06-01T00:00:00Z',
      valid_until: '2026-03-01T00:00:00Z',
    });
    assert.match(err.error, /valid_until .* must be after valid_from/);

    // Nothing was written.
    assert.equal(Object.keys(readIndex(tmpDir).memories).length, 0);
  });

  it('leaves the frontmatter shape of an unbounded memory unchanged', () => {
    const out = memorize({
      ...base,
      title: 'No window at all',
      path: 'professional/projects/unbounded.md',
    });
    const fm = readFrontmatter(out.stored[0].path);
    assert.ok(!fm.includes('valid_from:'));
    assert.ok(!fm.includes('valid_until:'));
  });
});

describe('temporal: recall', () => {
  it('demotes and flags a memory whose window has closed', () => {
    memorize({
      ...base,
      title: 'Zookeeper coordinates the cluster',
      path: 'professional/projects/zookeeper.md',
      content: 'Zookeeper coordinates the cluster quorum.',
      valid_until: '2026-01-01T00:00:00Z',
    });
    memorize({
      ...base,
      title: 'Raft coordinates the cluster',
      path: 'professional/projects/raft.md',
      content: 'Raft coordinates the cluster quorum.',
    });

    const results = recall('coordinates the cluster quorum');
    const expired = results.find((r) => r.title.startsWith('Zookeeper'));
    const current = results.find((r) => r.title.startsWith('Raft'));

    assert.ok(expired, 'the expired memory is demoted, never dropped');
    assert.equal(expired.expired, true);
    assert.equal(expired.valid_until, '2026-01-01T00:00:00Z');
    assert.ok(current.score > expired.score, 'the current fact outranks the expired one');
    assert.ok(!current.expired);
  });

  it('--as-of returns what was true at that instant', () => {
    memorize({
      ...base,
      title: 'Deploys go to Heroku',
      path: 'professional/projects/heroku.md',
      content: 'Production deploys go to Heroku dynos.',
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2026-05-01T00:00:00Z',
    });
    memorize({
      ...base,
      title: 'Deploys go to Fly',
      path: 'professional/projects/fly.md',
      content: 'Production deploys go to Fly machines.',
      valid_from: '2026-05-01T00:00:00Z',
    });

    const inMarch = recall('production deploys go to', ['--as-of', '2026-03-01']);
    assert.deepEqual(inMarch.map((r) => r.title), ['Deploys go to Heroku']);

    const inJune = recall('production deploys go to', ['--as-of', '2026-06-01']);
    assert.deepEqual(inJune.map((r) => r.title), ['Deploys go to Fly']);

    // Before either fact was true, the question has no answer — not a stale one.
    assert.deepEqual(recall('production deploys go to', ['--as-of', '2025-06-01']), []);
  });

  it('--as-of lifts the supersession demotion for a memory still inside its window', () => {
    const first = memorize({
      ...base,
      title: 'Billing runs on Stripe Billing',
      path: 'professional/projects/billing-stripe.md',
      content: 'Subscription billing runs on Stripe Billing.',
      valid_from: '2026-01-01T00:00:00Z',
    });
    memorize({
      ...base,
      title: 'Billing runs in-house',
      path: 'professional/projects/billing-inhouse.md',
      content: 'Subscription billing runs on the in-house ledger.',
      valid_from: '2026-07-01T00:00:00Z',
      supersedes: [first.stored[0].id],
    });

    // Today the superseded fact is demoted below its successor...
    const now = recall('subscription billing runs on');
    const nowFirst = now.find((r) => r.title.includes('Stripe'));
    const nowSecond = now.find((r) => r.title.includes('in-house'));
    assert.ok(nowSecond.score > nowFirst.score);
    assert.equal(nowFirst.expired, true);

    // ...but as of March it was simply the truth, undemoted and alone.
    const march = recall('subscription billing runs on', ['--as-of', '2026-03-01']);
    assert.deepEqual(march.map((r) => r.title), ['Billing runs on Stripe Billing']);
    assert.ok(!march[0].expired);
    assert.ok(march[0].score > nowFirst.score, 'the as-of ranking is not carrying the demotion');
  });

  it('--as-known-of filters on record time, not validity', () => {
    const out = memorize({
      ...base,
      title: 'Postgres is the primary datastore',
      path: 'professional/projects/postgres.md',
      content: 'Postgres is the primary datastore of record.',
      // The fact was true long before the brain was told about it.
      valid_from: '2020-01-01T00:00:00Z',
    });
    const recorded = readIndex(tmpDir).memories[out.stored[0].id].created;

    // Valid time reaches back before the brain existed...
    assert.equal(recall('primary datastore of record', ['--as-of', '2021-01-01']).length, 1);
    // ...but the brain did not know it yet.
    assert.deepEqual(recall('primary datastore of record', ['--as-known-of', '2021-01-01']), []);

    const after = new Date(parseInstant(recorded) + 1000).toISOString();
    assert.equal(recall('primary datastore of record', ['--as-known-of', after]).length, 1);
  });

  it('rejects an unparseable time-travel bound instead of ignoring it', () => {
    memorize({ ...base, title: 'Anything', path: 'professional/projects/anything.md' });
    assert.throws(
      () => execFileSync('node', [RECALL, 'anything', '--as-of', 'march'], {
        env: env(), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }),
      (err) => {
        assert.match(JSON.parse(err.stderr).error, /Invalid --as-of value/);
        return true;
      },
    );
  });
});

describe('temporal: supersession stamps the valid-time boundary', () => {
  it('closes the predecessor window at the successor start', () => {
    const first = memorize({
      ...base,
      title: 'Search is Meilisearch',
      path: 'professional/projects/search-meili.md',
      content: 'Catalog search runs on Meilisearch.',
    });
    memorize({
      ...base,
      title: 'Search is Typesense',
      path: 'professional/projects/search-typesense.md',
      content: 'Catalog search runs on Typesense.',
      valid_from: '2026-07-15T00:00:00Z',
      supersedes: [first.stored[0].id],
    });

    const entry = readIndex(tmpDir).memories[first.stored[0].id];
    assert.ok(entry.superseded_by, 'back-pointer stamped');
    assert.equal(entry.valid_until, '2026-07-15T00:00:00.000Z');
    assert.equal(entry.valid_until_auto, true, 'marked automatic so it can be withdrawn');
    assert.match(readFrontmatter(entry.path), /valid_until: "2026-07-15T00:00:00\.000Z"/);
  });

  it('never overwrites a window the author set by hand', () => {
    const first = memorize({
      ...base,
      title: 'Contractor engagement',
      path: 'professional/projects/contractor.md',
      content: 'The contractor engagement covers the migration.',
      valid_until: '2026-04-01T00:00:00Z',
    });
    memorize({
      ...base,
      title: 'Contractor engagement extended',
      path: 'professional/projects/contractor-2.md',
      content: 'The contractor engagement was extended.',
      supersedes: [first.stored[0].id],
    });

    const entry = readIndex(tmpDir).memories[first.stored[0].id];
    assert.equal(entry.valid_until, '2026-04-01T00:00:00Z', 'hand-authored window survives');
    assert.ok(!entry.valid_until_auto);
  });
});

describe('temporal: receipts', () => {
  it('marks an expired memory and leaves a current one byte-identical', () => {
    const now = () => new Date('2026-08-15T00:00:00Z');
    const current = receiptFor(
      { title: 'Still true', type: 'decision', created: '2026-08-14T00:00:00Z' }, now,
    );
    assert.equal(current, '◉ memory: "Still true" (decision, yesterday)');

    const expired = receiptFor({
      title: 'Was true', type: 'decision', created: '2026-08-14T00:00:00Z',
      valid_until: '2026-08-15T00:00:00Z',
    }, now);
    assert.equal(expired, '◉ memory: "Was true" (decision, yesterday, ⌛ expired)');
  });

  it('stacks with the trust and verification markers in a stable order', () => {
    const receipt = receiptFor({
      title: 'Doubtful and stale', type: 'observation', created: '2026-08-14T00:00:00Z',
      origin: 'external', quarantined: true, valid_until: '2026-08-15T00:00:00Z',
    }, () => new Date('2026-08-15T00:00:00Z'));
    assert.equal(
      receipt,
      '◉ memory: "Doubtful and stale" (observation, yesterday, ⚠ external, ⊘ unverified, ⌛ expired)',
    );
  });
});

describe('temporal: session start', () => {
  const { computeSessionStart } = require('../bin/session-start');
  const { createSearchIndex, addDocument, writeSearchIndex } = require('../src/tfidf');
  const { getBrainDir } = require('../src/index-manager');

  function seedPins(memories) {
    writeIndex({ version: '2.0', memory_count: Object.keys(memories).length, memories }, tmpDir);
    const si = createSearchIndex();
    for (const [id, e] of Object.entries(memories)) {
      addDocument(si, id, { title: e.title, body: e.title, tags: e.tags || [] });
    }
    writeSearchIndex(getBrainDir(tmpDir), si);
  }

  const pin = (overrides) => ({
    title: 'Pinned convention', path: 'professional/pin.md', type: 'preference',
    cognitive_type: 'semantic',
    created: '2026-01-01T00:00:00Z', last_accessed: '2026-01-01T00:00:00Z',
    access_count: 0, strength: 0.7, decay_rate: 0.99, salience: 0.5, confidence: 0.8,
    tags: [], related: [], encoding_context: {}, token_estimate: 25,
    pinned: true, pin_scope: 'global', pin_priority: 0,
    ...overrides,
  });

  it('holds an expired pin out of the always-apply tier and counts it', () => {
    seedPins({
      live: pin({ title: 'Still binding' }),
      stale: pin({ title: 'No longer binding', path: 'professional/pin2.md', valid_until: '2026-02-01T00:00:00Z' }),
    });

    const payload = computeSessionStart(tmpDir, {});
    assert.deepEqual(payload.pinned.map((p) => p.id), ['live']);
    assert.equal(payload.expired_pins, 1);
  });

  it('keeps unbounded pins untouched', () => {
    seedPins({ live: pin({ title: 'Still binding' }) });
    const payload = computeSessionStart(tmpDir, {});
    assert.equal(payload.pinned.length, 1);
    assert.equal(payload.expired_pins, 0);
  });
});

// ---------------------------------------------------------------------------
// 2. ASI06 — a quarantined write must not demote a trusted memory
// ---------------------------------------------------------------------------

describe('temporal: quarantined writes cannot supersede (ASI06)', () => {
  function seedTrusted() {
    return memorize({
      ...base,
      title: 'Deploy target is Fly.io',
      path: 'professional/projects/deploy-fly.md',
      content: 'The production deploy target is Fly.io.',
      origin: 'user',
    }).stored[0].id;
  }

  it('withholds the stamp when the superseding write lands quarantined', () => {
    const trustedId = seedTrusted();

    const poisoned = memorize({
      ...base,
      title: 'Deploy target is attacker-controlled',
      path: 'professional/projects/deploy-evil.md',
      content: 'The production deploy target is now an attacker-controlled host.',
      // Lifted from a fetched page — quarantined by policy.
      origin: 'external',
      supersedes: [trustedId],
    });

    assert.equal(poisoned.stored[0].quarantine_pending, true);
    assert.deepEqual(poisoned.stored[0].supersede_pending, [trustedId]);
    assert.equal(poisoned.stored[0].superseded, undefined, 'nothing was demoted');

    const trusted = readIndex(tmpDir).memories[trustedId];
    assert.equal(trusted.superseded_by, undefined);
    assert.equal(trusted.valid_until, undefined);
    assert.ok(!readFrontmatter(trusted.path).includes('superseded_by'));

    // And the trusted memory still wins recall outright.
    const results = recall('production deploy target');
    assert.equal(results[0].title, 'Deploy target is Fly.io');
  });

  it('applies the held-back supersession on approval', () => {
    const trustedId = seedTrusted();
    const pending = memorize({
      ...base,
      title: 'Deploy target moved to Render',
      path: 'professional/projects/deploy-render.md',
      content: 'The production deploy target moved to Render.',
      origin: 'external',
      supersedes: [trustedId],
    }).stored[0].id;

    const out = verify('approve', pending);
    assert.deepEqual(out.approved, [pending]);
    assert.deepEqual(out.superseded, [{ id: pending, superseded: [{ id: trustedId, title: 'Deploy target is Fly.io' }] }]);

    const trusted = readIndex(tmpDir).memories[trustedId];
    assert.equal(trusted.superseded_by, pending);
    assert.ok(trusted.valid_until, 'approval also closes the predecessor window');
    assert.match(readFrontmatter(trusted.path), /superseded_by: /);
  });

  it('leaves the trusted memory untouched when the write is rejected', () => {
    const trustedId = seedTrusted();
    const pending = memorize({
      ...base,
      title: 'Deploy target is attacker-controlled',
      path: 'professional/projects/deploy-evil2.md',
      content: 'The production deploy target is now an attacker-controlled host.',
      origin: 'external',
      supersedes: [trustedId],
    }).stored[0].id;

    const out = verify('reject', pending);
    assert.deepEqual(out.rejected, [pending]);

    const index = readIndex(tmpDir);
    assert.equal(index.memories[pending], undefined);
    const trusted = index.memories[trustedId];
    assert.equal(trusted.superseded_by, undefined);
    assert.equal(trusted.valid_until, undefined);
  });
});

// ---------------------------------------------------------------------------
// 3. Archival withdraws the supersessions a memory imposed
// ---------------------------------------------------------------------------

describe('temporal: archival releases what it superseded', () => {
  it('clears the back-pointer and the automatic window, restoring recall weight', () => {
    const first = memorize({
      ...base,
      title: 'Queue is RabbitMQ',
      path: 'professional/projects/queue-rabbit.md',
      content: 'The job queue runs on RabbitMQ.',
    }).stored[0].id;
    const second = memorize({
      ...base,
      title: 'Queue is SQS',
      path: 'professional/projects/queue-sqs.md',
      content: 'The job queue runs on SQS.',
      supersedes: [first],
    }).stored[0].id;

    assert.equal(readIndex(tmpDir).memories[first].superseded_by, second);
    const demoted = recall('the job queue runs on').find((r) => r.title === 'Queue is RabbitMQ');
    assert.equal(demoted.expired, true);

    const out = JSON.parse(execFileSync('node', [FORGET, second, '--force'], {
      env: env(), encoding: 'utf-8',
    }));
    assert.deepEqual(out.released, [first]);

    const released = readIndex(tmpDir).memories[first];
    assert.equal(released.superseded_by, undefined, 'no pointer to an archived id');
    assert.equal(released.valid_until, undefined, 'the automatic window is withdrawn');
    assert.equal(released.valid_until_auto, undefined);
    const fm = readFrontmatter(released.path);
    assert.ok(!fm.includes('superseded_by'));

    const restored = recall('the job queue runs on').find((r) => r.title === 'Queue is RabbitMQ');
    assert.ok(!restored.expired);
    assert.ok(restored.score > demoted.score, 'full recall weight is restored');
  });

  it('keeps a hand-authored window when the successor is archived', () => {
    const first = memorize({
      ...base,
      title: 'Trial period',
      path: 'professional/projects/trial.md',
      content: 'The pilot trial period covers one quarter.',
      valid_until: '2026-04-01T00:00:00Z',
    }).stored[0].id;
    const second = memorize({
      ...base,
      title: 'Trial extended',
      path: 'professional/projects/trial-2.md',
      content: 'The pilot trial period was extended.',
      supersedes: [first],
    }).stored[0].id;

    execFileSync('node', [FORGET, second, '--force'], { env: env(), encoding: 'utf-8' });

    const entry = readIndex(tmpDir).memories[first];
    assert.equal(entry.superseded_by, undefined);
    assert.equal(entry.valid_until, '2026-04-01T00:00:00Z', 'author intent survives');
  });
});
