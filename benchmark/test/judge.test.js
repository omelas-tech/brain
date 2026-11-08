const { describe, it } = require('node:test');
const assert = require('node:assert');
const { _extractJson: extractJson } = require('../harness/judge.js');

describe('judge extractJson', () => {
  it('parses plain and fenced JSON', () => {
    assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepStrictEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  });

  it('repairs a trailing comma before ] or } (seen from claude-haiku-5-5)', () => {
    const raw = '{"criteria":[{"n":1,"met":true,"evidence":"We use Postgres."},],"rationale":"ok",}';
    assert.deepStrictEqual(extractJson(raw), {
      criteria: [{ n: 1, met: true, evidence: 'We use Postgres.' }],
      rationale: 'ok',
    });
  });

  it('still throws on JSON that is broken in other ways', () => {
    assert.throws(() => extractJson('{"a": tru}'));
  });
});
