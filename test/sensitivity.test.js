const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SENSITIVITY_LEVELS,
  SENSITIVE_OPT_OUT_REASON,
  SENSITIVE_CATEGORIES,
  BLOCKED_CATEGORIES,
  classifySensitivity,
  sensitivityDecision,
  isSensitiveHidden,
} = require('../src/sensitivity');

describe('sensitivity taxonomy', () => {
  it('has three ordered tiers and the published category lists', () => {
    assert.deepEqual(SENSITIVITY_LEVELS, ['standard', 'sensitive', 'blocked']);
    assert.deepEqual(Object.keys(SENSITIVE_CATEGORIES), ['health', 'race', 'ethnicity', 'religion', 'politics', 'gender_identity']);
    assert.deepEqual(Object.keys(BLOCKED_CATEGORIES), ['government_id', 'criminal_history', 'immigration_status']);
    assert.equal(SENSITIVE_OPT_OUT_REASON, 'sensitive_opt_out');
  });
});

describe('classifySensitivity (backstop)', () => {
  const blocked = [
    ['SSN 123-45-6789 on file', 'government_id'],
    ['Passport number: AB 123 456 789 for the visa run', 'government_id'],
    ['Client has a criminal record from 2019', 'criminal_history'],
    ['He was arrested for fraud last year', 'criminal_history'],
    ['Her immigration status is pending', 'immigration_status'],
    ['They overstayed their visa in 2024', 'immigration_status'],
  ];
  for (const [text, category] of blocked) {
    it(`blocks: ${text}`, () => {
      const r = classifySensitivity({ title: 't', content: text });
      assert.equal(r.level, 'blocked');
      assert.deepEqual(r.categories, [category]);
    });
  }

  const sensitive = [
    ['User was diagnosed with ADHD in 2022', 'health'],
    ['Takes insulin twice a day', 'health'],
    ['User identifies as Black and cares about representation', 'race'],
    ['Partner is of Kurdish descent', 'ethnicity'],
    ['User is a practising Muslim; avoid scheduling during Friday prayers', 'religion'],
    ['Voted for the Greens in the last election', 'politics'],
    ['User is non-binary and uses they/them', 'gender_identity'],
  ];
  for (const [text, category] of sensitive) {
    it(`flags sensitive: ${text}`, () => {
      const r = classifySensitivity({ title: 't', content: text });
      assert.equal(r.level, 'sensitive');
      assert.ok(r.categories.includes(category), r.categories.join(','));
    });
  }

  it('leaves ordinary engineering content standard', () => {
    const texts = [
      'We chose pgbouncer in transaction mode for the API.',
      'Deploy target moved from Heroku to Fly on 2026-03-01.',
      'Prefers 2-space indent and trailing commas.',
      'The health endpoint returns 503 when the DB is down.',
      'Race condition in the token refresh path — fixed with a mutex.',
      'Run the migration with a 30s timeout and check the party column.',
      'Meeting with Sam on Thursday about the visa pipeline for the HR product.',
    ];
    for (const text of texts) {
      assert.equal(classifySensitivity({ title: 'note', content: text }).level, 'standard', text);
    }
  });

  it('returns blocked when both tiers match', () => {
    const r = classifySensitivity({ content: 'diagnosed with PTSD after serving a sentence' });
    assert.equal(r.level, 'blocked');
  });
});

describe('sensitivityDecision', () => {
  const on = { sensitive_topics: true };
  const off = { sensitive_topics: false };

  it('stores standard content regardless of the toggle', () => {
    for (const config of [on, off, {}]) {
      const d = sensitivityDecision({ content: 'use pgbouncer' }, config);
      assert.deepEqual([d.level, d.action], ['standard', 'store']);
    }
  });

  it('quarantines declared-sensitive content until the user opts in', () => {
    const mem = { content: 'prefers morning meetings', sensitivity: 'sensitive' };
    assert.equal(sensitivityDecision(mem, off).action, 'quarantine');
    assert.equal(sensitivityDecision(mem, {}).action, 'quarantine');
    assert.equal(sensitivityDecision(mem, on).action, 'store');
    assert.equal(sensitivityDecision(mem, on).level, 'sensitive');
  });

  it('lets the backstop raise but never lower the caller\'s label', () => {
    const raised = sensitivityDecision({ content: 'User was diagnosed with ADHD', sensitivity: 'standard' }, on);
    assert.equal(raised.level, 'sensitive');
    assert.equal(raised.requested, 'standard');
    const kept = sensitivityDecision({ content: 'likes tea', sensitivity: 'sensitive' }, on);
    assert.equal(kept.level, 'sensitive');
    const blocked = sensitivityDecision({ content: 'SSN 123-45-6789', sensitivity: 'standard' }, on);
    assert.deepEqual([blocked.level, blocked.action], ['blocked', 'refuse']);
  });

  it('refuses blocked content whatever the toggle says, and rejects unknown labels', () => {
    assert.equal(sensitivityDecision({ content: 'x', sensitivity: 'blocked' }, on).action, 'refuse');
    assert.match(sensitivityDecision({ content: 'x', sensitivity: 'secret' }, on).error, /Unknown sensitivity "secret"/);
  });
});

describe('isSensitiveHidden (read-side gate)', () => {
  it('hides sensitive entries unless opted in globally or vetted individually', () => {
    const entry = { sensitivity: 'sensitive' };
    assert.equal(isSensitiveHidden(entry, {}), true);
    assert.equal(isSensitiveHidden(entry, { sensitive_topics: false }), true);
    assert.equal(isSensitiveHidden(entry, { sensitive_topics: true }), false);
    assert.equal(isSensitiveHidden({ ...entry, vetted: true }, {}), false);
    assert.equal(isSensitiveHidden({ title: 'plain' }, {}), false);
    assert.equal(isSensitiveHidden(null, {}), false);
  });
});
