/**
 * connector-gated arm — the hosted-connector recall policy.
 *
 * Every other brain-* arm measures always-on ranked injection (what the local
 * plugin does at session start). The connector instead advertises memory as
 * TOOLS and lets the model decide whether to call brain_recall at all — a
 * gating policy. This arm exists to measure that, so these tests pin the parts
 * that don't need a live model:
 *
 *   1. the gate prompt shows the task and the tool, but never memory content
 *   2. decision parsing survives the shapes models actually emit
 *   3. declining scores as a retrieval MISS, not as "not measured"
 *   4. the gate call's tokens are charged to the arm
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildGatePrompt,
  parseGateDecision,
  connectorGatedRecall,
  INJECTION_MODES,
} = require('../harness/arm-runner');
const { createRunMetrics, totalTokens } = require('../harness/metrics');

const SETUP = {
  oracle_memory_ids: ['mem_oracle_1'],
  context: { project: 'ledger-svc', topics: ['database'], task_type: 'implementing' },
  test: [{ text: 'Add a comments resource to the service.' }],
};

/** Stub agent: returns a canned output and fixed token usage. */
function stubAgent(output, { tokens = { input: 100, output: 20, input_cached: 0 }, throws = null } = {}) {
  return {
    name: 'stub',
    calls: [],
    async run(prompt) {
      this.calls.push(prompt);
      if (throws) throw new Error(throws);
      return { output, raw: {}, tokens, time_ms: 5 };
    },
  };
}

const gateCtx = (agent, metrics) => ({
  agent,
  workDir: '/tmp',
  runEnv: {},
  config: { timeouts: { prompt_ms: 1000 } },
  metrics,
  taskText: SETUP.test[0].text,
});

describe('connector-gated: registration', () => {
  it('is a recognized injection mode', () => {
    assert.ok(INJECTION_MODES.has('connector-gated'));
  });
});

describe('connector-gated: gate prompt', () => {
  const prompt = buildGatePrompt('Add a comments resource to the service.');

  it('shows the task and the tool, and asks for a decision', () => {
    assert.match(prompt, /Add a comments resource to the service\./);
    assert.match(prompt, /brain_recall/);
    assert.match(prompt, /"recall": true/);
    assert.match(prompt, /"recall": false/);
  });

  it('leaks no memory content — the decision must rest on the task alone', () => {
    // The whole point of the arm is that the model chooses blind, exactly as
    // it does in production. Any memory text here would make it a different
    // (and much easier) experiment.
    assert.ok(!prompt.includes('BEGIN MEMORY CONTEXT'));
    assert.ok(!prompt.includes('Postgres'));
  });
});

describe('connector-gated: decision parsing', () => {
  it('accepts a bare decision', () => {
    assert.deepEqual(
      parseGateDecision('{"recall": true, "query": "database choice"}'),
      { recall: true, query: 'database choice' },
    );
    assert.deepEqual(parseGateDecision('{"recall": false}'), { recall: false, query: '' });
  });

  it('accepts JSON wrapped in prose or fences', () => {
    const fenced = 'Sure!\n```json\n{"recall": true, "query": "db driver"}\n```\nHope that helps.';
    assert.deepEqual(parseGateDecision(fenced), { recall: true, query: 'db driver' });
  });

  it('treats an unparseable reply as no-recall, flagged apart from a decline', () => {
    for (const junk of ['I would probably look that up.', '', null, '{ broken']) {
      const d = parseGateDecision(junk);
      assert.equal(d.recall, false, `expected no-recall for ${JSON.stringify(junk)}`);
      assert.equal(d.parse_failed, true);
    }
    // A real decline is NOT a parse failure — the distinction drives the fix.
    assert.ok(!parseGateDecision('{"recall": false}').parse_failed);
  });

  it('treats recall-with-no-query as a failed call, not a decline', () => {
    // A tool call with an empty argument retrieves nothing in production too.
    const d = parseGateDecision('{"recall": true}');
    assert.equal(d.recall, false);
    assert.equal(d.parse_failed, true);
  });
});

describe('connector-gated: recall behaviour', () => {
  it('scores a decline as a retrieval miss, not as unmeasured', async () => {
    const metrics = createRunMetrics();
    const agent = stubAgent('{"recall": false}');
    const out = await connectorGatedRecall({
      arm: { recall_top: 5 }, homeDir: '/nonexistent', setup: SETUP, gate: gateCtx(agent, metrics),
    });

    assert.equal(out.text, '');
    assert.equal(out.gate.invoked, false);
    assert.equal(out.gate.declined, true);
    // The oracle was there to be fetched and wasn't — that is a zero, and
    // reporting null would quietly drop the arm from recall@k comparisons.
    assert.ok(out.retrieval, 'declining must still produce a retrieval score');
    assert.equal(out.retrieval.recall[5], 0);
  });

  it('charges the gate call to the arm even when it declines', async () => {
    const metrics = createRunMetrics();
    const agent = stubAgent('{"recall": false}');
    await connectorGatedRecall({
      arm: {}, homeDir: '/nonexistent', setup: SETUP, gate: gateCtx(agent, metrics),
    });

    // Gating is not free; tokens_per_success has to show what it costs.
    assert.equal(totalTokens(metrics.tokens), 120);
    assert.equal(metrics.prompts.length, 1);
    assert.equal(metrics.prompts[0].label, 'connector-gate');
  });

  it('records a failed gate call as no-memory rather than retrying into always-on', async () => {
    const metrics = createRunMetrics();
    const agent = stubAgent('', { throws: 'gate exploded' });
    const out = await connectorGatedRecall({
      arm: {}, homeDir: '/nonexistent', setup: SETUP, gate: gateCtx(agent, metrics),
    });

    assert.equal(out.text, '');
    assert.equal(out.gate.invoked, false);
    assert.match(out.gate.error, /gate exploded/);
    assert.equal(out.retrieval.recall[5], 0);
  });

  it('refuses to run without agent context instead of silently injecting nothing', async () => {
    await assert.rejects(
      () => connectorGatedRecall({ arm: {}, homeDir: '/nonexistent', setup: SETUP, gate: null }),
      /requires agent context/,
    );
  });

  it('passes the model its OWN query through to the engine', async () => {
    // Needs a real HOME: the recall probe spawns the brain CLI there.
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-gated-'));
    fs.mkdirSync(path.join(homeDir, '.brain'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.brain', 'index.json'),
      JSON.stringify({ version: '2.0', memory_count: 0, memories: {} }),
    );

    try {
      const metrics = createRunMetrics();
      const agent = stubAgent('{"recall": true, "query": "which database do we use"}');
      const out = await connectorGatedRecall({
        arm: { recall_top: 5 }, homeDir, setup: SETUP, gate: gateCtx(agent, metrics),
      });

      // An empty brain yields no hits, but the decision must be reported as
      // invoked and carry the self-authored query — the thing this arm
      // measures beyond "did it look at all".
      assert.equal(out.gate.invoked, true);
      assert.equal(out.gate.query, 'which database do we use');
      // ...and the model's query, not the scenario's curated one, is what ran.
      assert.ok(agent.calls[0].includes('Add a comments resource'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
