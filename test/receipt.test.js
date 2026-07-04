const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { receiptFor, ageLabel } = require('../src/receipt');

// Fixed reference clock so every age computation is deterministic.
const NOW = new Date('2026-07-04T12:00:00Z');
const nowFn = () => NOW;

/** ISO timestamp exactly `days` days before NOW. */
function daysAgo(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('ageLabel: boundary matrix', () => {
  const cases = [
    [0, 'today'],
    [1, 'yesterday'],
    [2, '2d ago'],
    [30, '30d ago'],
    [31, '1mo ago'],          // 31-364d switches to months, min 1
    [45, '1mo ago'],          // 45/30.44 = 1.48 → rounds to 1
    [61, '2mo ago'],
    [335, '11mo ago'],        // 335/30.44 = 11.0
    [364, '12mo ago'],        // last month-labelled day rounds up to 12mo
    [365, '1y ago'],          // 365+ switches to years, min 1
    [548, '2y ago'],          // 548/365.25 = 1.5 → rounds to 2
    [730, '2y ago'],
    [3653, '10y ago'],
  ];
  for (const [days, expected] of cases) {
    it(`${days}d → "${expected}"`, () => {
      assert.equal(ageLabel(daysAgo(days), NOW), expected);
    });
  }

  it('a future timestamp clamps to "today"', () => {
    assert.equal(ageLabel(daysAgo(-3), NOW), 'today');
  });

  it('returns null for an invalid timestamp', () => {
    assert.equal(ageLabel('not-a-date', NOW), null);
    assert.equal(ageLabel(undefined, NOW), null);
  });
});

describe('receiptFor: format', () => {
  it('mints the exact documented format', () => {
    const receipt = receiptFor(
      { title: 'Database pooling', type: 'learning', created: daysAgo(3) },
      nowFn
    );
    assert.equal(receipt, '◉ memory: "Database pooling" (learning, 3d ago)');
  });

  it('is deterministic for the same injected clock', () => {
    const mem = { title: 'X', type: 'decision', created: daysAgo(10) };
    assert.equal(receiptFor(mem, nowFn), receiptFor(mem, nowFn));
  });

  it('uses the title as-is, including embedded quotes', () => {
    const receipt = receiptFor(
      { title: 'Use "pg" pool, not knex', type: 'decision', created: daysAgo(0) },
      nowFn
    );
    assert.equal(receipt, '◉ memory: "Use "pg" pool, not knex" (decision, today)');
  });

  it('keeps an exactly-80-char title untouched', () => {
    const title = 'a'.repeat(80);
    const receipt = receiptFor({ title, type: 'insight', created: daysAgo(1) }, nowFn);
    assert.ok(receipt.includes(`"${title}"`));
  });

  it('truncates a >80-char title at 77 chars + ellipsis', () => {
    const title = 'b'.repeat(81);
    const receipt = receiptFor({ title, type: 'insight', created: daysAgo(1) }, nowFn);
    assert.equal(receipt, `◉ memory: "${'b'.repeat(77)}…" (insight, yesterday)`);
  });
});

describe('receiptFor: missing-field fallbacks', () => {
  it('falls back to last_accessed when created is absent', () => {
    const receipt = receiptFor(
      { title: 'Old habit', type: 'preference', last_accessed: daysAgo(2) },
      nowFn
    );
    assert.equal(receipt, '◉ memory: "Old habit" (preference, 2d ago)');
  });

  it('omits the age segment when neither timestamp parses', () => {
    const receipt = receiptFor({ title: 'Ageless', type: 'observation' }, nowFn);
    assert.equal(receipt, '◉ memory: "Ageless" (observation)');
  });

  it('defaults missing title and type to "memory"', () => {
    assert.equal(
      receiptFor({ created: daysAgo(0) }, nowFn),
      '◉ memory: "memory" (memory, today)'
    );
  });

  it('never throws on a null/empty memory', () => {
    assert.equal(receiptFor(null, nowFn), '◉ memory: "memory" (memory)');
    assert.equal(receiptFor({}, nowFn), '◉ memory: "memory" (memory)');
  });
});
