const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  halfLife, median, collectIntervals, verdictFor,
} = require('../benchmark/harness/decay-calibration');

describe('decay-calibration: half-life', () => {
  it('converts a decay rate into days-to-half-strength', () => {
    // The shipped constants, so a change to them shows up as a test diff.
    assert.equal(Math.round(halfLife(0.995) * 10) / 10, 138.3);
    assert.equal(Math.round(halfLife(0.950) * 10) / 10, 13.5);
    assert.equal(Math.round(halfLife(0.997) * 10) / 10, 230.7);
  });

  it('treats a non-decaying rate as infinite', () => {
    assert.equal(halfLife(1), Infinity);
    assert.equal(halfLife(0), Infinity);
  });
});

describe('decay-calibration: median', () => {
  it('handles odd and even lengths', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });
  it('returns null for an empty set', () => {
    assert.equal(median([]), null);
  });
});

describe('decay-calibration: interval collection', () => {
  it('groups observed intervals by memory type', () => {
    const index = {
      memories: {
        a: {
          type: 'decision', decay_rate: 0.995,
          recall_history: [{ days_since_last: 10 }, { days_since_last: 20 }],
        },
        b: { type: 'learning', decay_rate: 0.99, recall_history: [{ days_since_last: 5 }] },
      },
    };
    const byType = collectIntervals(index);
    assert.deepEqual(byType.get('decision').intervals, [10, 20]);
    assert.deepEqual(byType.get('learning').intervals, [5]);
    assert.equal(byType.get('decision').memories, 1);
  });

  it('drops zero-day intervals', () => {
    // Two recalls in the same session say nothing about decay.
    const index = {
      memories: { a: { type: 'decision', decay_rate: 0.995, recall_history: [{ days_since_last: 0 }] } },
    };
    assert.deepEqual(collectIntervals(index).get('decision').intervals, []);
  });

  it('tolerates memories with no recall history', () => {
    const index = { memories: { a: { type: 'decision', decay_rate: 0.995 } } };
    const slot = collectIntervals(index).get('decision');
    assert.equal(slot.memories, 1);
    assert.deepEqual(slot.intervals, []);
  });
});

describe('decay-calibration: verdicts', () => {
  const slot = (rate, intervals) => ({ intervals, decayRates: [rate], memories: 1 });

  it('withholds a verdict below the minimum sample size', () => {
    // A "recommendation" off three points is how a hand-set constant gets
    // replaced by a worse one that merely sounds empirical.
    assert.equal(verdictFor(slot(0.995, [1, 2, 3]), 10), null);
  });

  it('flags decay that is too slow to matter', () => {
    const v = verdictFor(slot(0.995, Array(12).fill(2)), 10);
    assert.match(v.verdict, /too slow/);
    assert.ok(v.ratio < 0.25);
  });

  it('flags decay that outpaces real usefulness', () => {
    const v = verdictFor(slot(0.950, Array(12).fill(400)), 10);
    assert.match(v.verdict, /too fast/);
    assert.ok(v.ratio > 4);
  });

  it('reports consistency when interval and half-life agree', () => {
    const v = verdictFor(slot(0.995, Array(12).fill(140)), 10);
    assert.equal(v.verdict, 'consistent');
    assert.ok(Math.abs(v.ratio - 1) < 0.1);
  });
});
