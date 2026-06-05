// Coverage for the reference-erasure helpers in index-manager
// (removeEdgesForMemory, removeFromReviewQueue, …). These power the deep
// forensic-erasure path now exposed as `/brain:forget --deep` (formerly the
// standalone `/brain:sunshine` command, removed in the six-verb refactor).
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  removeEdgesForMemory,
  removeFromReviewQueue,
  readAssociations,
  writeAssociations,
  readReviewQueue,
  writeReviewQueue,
} = require('../src/index-manager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-sunshine-'));
  fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ===========================================================================
// removeEdgesForMemory
// ===========================================================================
describe('removeEdgesForMemory', () => {
  it('removes outgoing edges for the target memory', () => {
    const assoc = {
      edges: {
        a: { b: { weight: 0.5 }, c: { weight: 0.3 } },
        b: { a: { weight: 0.5 } },
        c: { a: { weight: 0.3 } },
      },
    };
    removeEdgesForMemory(assoc, 'a');
    assert.equal(assoc.edges.a, undefined);
  });

  it('removes incoming edges from other memories', () => {
    const assoc = {
      edges: {
        a: { b: { weight: 0.5 }, c: { weight: 0.3 } },
        b: { a: { weight: 0.5 }, c: { weight: 0.2 } },
        c: { a: { weight: 0.3 } },
      },
    };
    removeEdgesForMemory(assoc, 'a');
    // b should still have edge to c but not to a
    assert.equal(assoc.edges.b.a, undefined);
    assert.ok(assoc.edges.b.c);
    // c had only edge to a, so c's map should be cleaned up
    assert.equal(assoc.edges.c, undefined);
  });

  it('cleans up empty neighbor maps', () => {
    const assoc = {
      edges: {
        a: { b: { weight: 0.5 } },
        b: { a: { weight: 0.5 } },
      },
    };
    removeEdgesForMemory(assoc, 'a');
    // b only had edge to a, so b's map should be gone
    assert.equal(assoc.edges.b, undefined);
    assert.deepEqual(assoc.edges, {});
  });

  it('handles null associations gracefully', () => {
    assert.equal(removeEdgesForMemory(null, 'a'), null);
  });

  it('handles associations with no edges', () => {
    const assoc = { edges: {} };
    removeEdgesForMemory(assoc, 'a');
    assert.deepEqual(assoc.edges, {});
  });

  it('handles missing edges object', () => {
    const assoc = {};
    removeEdgesForMemory(assoc, 'a');
    assert.deepEqual(assoc, {});
  });

  it('is a no-op when memory has no edges', () => {
    const assoc = {
      edges: {
        b: { c: { weight: 0.5 } },
        c: { b: { weight: 0.5 } },
      },
    };
    removeEdgesForMemory(assoc, 'a');
    // b<->c edges should remain untouched
    assert.ok(assoc.edges.b.c);
    assert.ok(assoc.edges.c.b);
  });

  it('preserves unrelated edges', () => {
    const assoc = {
      edges: {
        a: { b: { weight: 0.5 } },
        b: { a: { weight: 0.5 }, c: { weight: 0.7 } },
        c: { b: { weight: 0.7 }, d: { weight: 0.3 } },
        d: { c: { weight: 0.3 } },
      },
    };
    removeEdgesForMemory(assoc, 'a');
    // b->c, c->b, c->d, d->c should all remain
    assert.ok(assoc.edges.b.c);
    assert.ok(assoc.edges.c.b);
    assert.ok(assoc.edges.c.d);
    assert.ok(assoc.edges.d.c);
    assert.equal(assoc.edges.b.a, undefined);
  });

  it('round-trips through file I/O', () => {
    setup();
    try {
      const assoc = {
        version: 1,
        edges: {
          a: { b: { weight: 0.5 }, c: { weight: 0.3 } },
          b: { a: { weight: 0.5 } },
          c: { a: { weight: 0.3 }, b: { weight: 0.2 } },
        },
      };
      writeAssociations(assoc, tmpDir);
      const loaded = readAssociations(tmpDir);
      removeEdgesForMemory(loaded, 'a');
      writeAssociations(loaded, tmpDir);
      const result = readAssociations(tmpDir);
      assert.equal(result.edges.a, undefined);
      assert.equal(result.edges.b, undefined); // b only had a
      assert.ok(result.edges.c.b); // c->b remains
      assert.equal(result.edges.c.a, undefined);
    } finally {
      teardown();
    }
  });
});

// ===========================================================================
// removeFromReviewQueue
// ===========================================================================
describe('removeFromReviewQueue', () => {
  it('removes the matching memory from items', () => {
    const queue = {
      version: 1,
      items: [
        { memory_id: 'm1', next_review: '2026-02-20', interval_days: 7 },
        { memory_id: 'm2', next_review: '2026-02-22', interval_days: 14 },
        { memory_id: 'm3', next_review: '2026-02-25', interval_days: 7 },
      ],
    };
    removeFromReviewQueue(queue, 'm2');
    assert.equal(queue.items.length, 2);
    assert.ok(queue.items.every((item) => item.memory_id !== 'm2'));
  });

  it('is a no-op when memory is not in queue', () => {
    const queue = {
      version: 1,
      items: [
        { memory_id: 'm1', next_review: '2026-02-20' },
      ],
    };
    removeFromReviewQueue(queue, 'nonexistent');
    assert.equal(queue.items.length, 1);
  });

  it('handles empty items array', () => {
    const queue = { version: 1, items: [] };
    removeFromReviewQueue(queue, 'm1');
    assert.deepEqual(queue.items, []);
  });

  it('handles null queue gracefully', () => {
    assert.equal(removeFromReviewQueue(null, 'm1'), null);
  });

  it('handles queue without items array', () => {
    const queue = { version: 1 };
    const result = removeFromReviewQueue(queue, 'm1');
    assert.deepEqual(result, { version: 1 });
  });

  it('removes all duplicates if memory appears multiple times', () => {
    const queue = {
      version: 1,
      items: [
        { memory_id: 'm1', next_review: '2026-02-20' },
        { memory_id: 'm1', next_review: '2026-03-01' },
        { memory_id: 'm2', next_review: '2026-02-22' },
      ],
    };
    removeFromReviewQueue(queue, 'm1');
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].memory_id, 'm2');
  });

  it('round-trips through file I/O', () => {
    setup();
    try {
      const queue = {
        version: 1,
        items: [
          { memory_id: 'm1', next_review: '2026-02-20', interval_days: 7, ease_factor: 2.5, review_count: 2 },
          { memory_id: 'm2', next_review: '2026-02-22', interval_days: 14, ease_factor: 2.5, review_count: 5 },
        ],
      };
      writeReviewQueue(queue, tmpDir);
      const loaded = readReviewQueue(tmpDir);
      removeFromReviewQueue(loaded, 'm1');
      writeReviewQueue(loaded, tmpDir);
      const result = readReviewQueue(tmpDir);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].memory_id, 'm2');
    } finally {
      teardown();
    }
  });
});
