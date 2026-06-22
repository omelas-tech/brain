/**
 * Tests for the post-hoc statistical analysis (harness/analyze.js).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeResults, renderAnalysisMarkdown } = require('../harness/analyze');

describe('Analyze', () => {
  const payload = {
    scenarios: [{
      scenario: 'scenario-A',
      results: {
        gemini: {
          'brain-full': {
            token_samples: [18000, 19000, 18500, 17800, 18200],
            success_rate: 0.8, completion_rate: 1,
            retrieval: { recall: { '5': 0.92 } }, tokens_per_success: 23000,
          },
          'context-dump-unbounded': {
            token_samples: [50000, 52000, 51000, 49000, 53000],
            success_rate: 0.2, completion_rate: 0.4,
            retrieval: null, tokens_per_success: null,
          },
          'no-memory': {
            token_samples: [18100, 18900, 18300, 17900, 18400],
            success_rate: 0.4, completion_rate: 1,
            retrieval: null, tokens_per_success: 45000,
          },
        },
      },
    }],
  };

  it('computes CIs, contrasts, and Holm correction', () => {
    const a = analyzeResults(payload, { reference: 'brain-full' });
    assert.equal(a.length, 1);
    const block = a[0];
    assert.equal(block.scenario, 'scenario-A');
    assert.equal(block.agent, 'gemini');
    assert.equal(block.arms.length, 3);
    assert.equal(block.contrasts.length, 2); // both baselines vs brain-full

    // brain-full vs unbounded dump: cleanly separated → small p, large effect
    const dump = block.contrasts.find((c) => c.arm === 'context-dump-unbounded');
    assert.ok(dump.p < 0.05, `expected p<0.05, got ${dump.p}`);
    assert.equal(dump.magnitude, 'large');
    assert.equal(typeof dump.adjusted, 'number');
    assert.equal(typeof dump.reject, 'boolean');

    // brain-full vs no-memory: overlapping token distributions → not significant
    const none = block.contrasts.find((c) => c.arm === 'no-memory');
    assert.ok(none.p > 0.05, `expected p>0.05, got ${none.p}`);

    // CI sanity
    const bf = block.arms.find((x) => x.arm === 'brain-full');
    assert.ok(bf.ci.lower <= bf.ci.point && bf.ci.point <= bf.ci.upper);
    assert.equal(bf.n, 5);
  });

  it('renders markdown with no infinity glyph and a single null symbol', () => {
    const md = renderAnalysisMarkdown(analyzeResults(payload));
    assert.ok(md.includes('scenario-A'));
    assert.ok(md.includes('Mann–Whitney'));
    assert.ok(md.includes('—'));   // null cell for tokens_per_success/recall on dump
    assert.ok(!md.includes('∞'));
  });
});
