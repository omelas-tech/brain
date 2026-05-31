const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  tokenize,
  stem,
  termFrequencies,
  computeTfidfVector,
  cosineSimilarity,
  buildMemoryText,
  createSearchIndex,
  addDocument,
  removeDocument,
  search,
  rebuildIndex,
  readSearchIndex,
  writeSearchIndex,
} = require('../src/tfidf');

// ===========================================================================
// stem
// ===========================================================================
describe('stem', () => {
  it('strips common suffixes', () => {
    assert.equal(stem('connections'), 'connect');
    assert.equal(stem('pooling'), 'pool');
    assert.equal(stem('implementing'), 'implement');
    assert.equal(stem('validation'), 'valid');
    assert.equal(stem('handlers'), 'handler');
    assert.equal(stem('queries'), 'quer');
  });

  it('preserves short words', () => {
    assert.equal(stem('api'), 'api');
    assert.equal(stem('db'), 'db');
    assert.equal(stem('go'), 'go');
  });

  it('preserves words where suffix is part of stem', () => {
    assert.equal(stem('express'), 'express');
    assert.equal(stem('process'), 'process');
    assert.equal(stem('async'), 'async');
    assert.equal(stem('pool'), 'pool');
  });
});

// ===========================================================================
// tokenize
// ===========================================================================
describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    const tokens = tokenize('Hello World');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
  });

  it('removes stopwords', () => {
    const tokens = tokenize('the quick brown fox is a very fast animal');
    assert.ok(!tokens.includes('the'));
    assert.ok(!tokens.includes('is'));
    assert.ok(!tokens.includes('a'));
    assert.ok(!tokens.includes('very'));
    assert.ok(tokens.includes('quick'));
  });

  it('strips punctuation and stems', () => {
    const tokens = tokenize('async/await, express.Router()');
    assert.ok(tokens.includes('async'));
    assert.ok(tokens.includes('express'));
    assert.ok(tokens.includes(stem('router')));
  });

  it('applies stemming', () => {
    const tokens = tokenize('connections pooling');
    assert.ok(tokens.includes(stem('connections')));
    assert.ok(tokens.includes(stem('pooling')));
  });

  it('returns empty array for null/empty input', () => {
    assert.deepEqual(tokenize(null), []);
    assert.deepEqual(tokenize(''), []);
  });

  it('filters single-character tokens', () => {
    const tokens = tokenize('a b c long word');
    assert.ok(!tokens.includes('b'));
    assert.ok(!tokens.includes('c'));
  });
});

// ===========================================================================
// termFrequencies
// ===========================================================================
describe('termFrequencies', () => {
  it('counts occurrences', () => {
    const tf = termFrequencies(['pool', 'connect', 'pool', 'query', 'pool']);
    assert.equal(tf.pool, 3);
    assert.equal(tf.connect, 1);
    assert.equal(tf.query, 1);
  });

  it('returns empty object for empty array', () => {
    assert.deepEqual(termFrequencies([]), {});
  });
});

// ===========================================================================
// cosineSimilarity
// ===========================================================================
describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = { pool: 0.5, connect: 0.3 };
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 0.001);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = { pool: 1.0 };
    const b = { express: 1.0 };
    assert.equal(cosineSimilarity(a, b), 0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const a = { pool: 0.5, connect: 0.3, query: 0.2 };
    const b = { pool: 0.4, express: 0.6 };
    const sim = cosineSimilarity(a, b);
    assert.ok(sim > 0);
    assert.ok(sim < 1);
  });

  it('handles empty vectors', () => {
    assert.equal(cosineSimilarity({}, { pool: 1.0 }), 0);
    assert.equal(cosineSimilarity({}, {}), 0);
  });
});

// ===========================================================================
// buildMemoryText
// ===========================================================================
describe('buildMemoryText', () => {
  it('combines title (3x), tags (2x), body (1x)', () => {
    const text = buildMemoryText({
      title: 'Database Pattern',
      body: 'Use connection pooling.',
      tags: ['database', 'postgres'],
    });
    // Title appears 3 times
    const titleCount = (text.match(/Database Pattern/g) || []).length;
    assert.equal(titleCount, 3);
    // Tags appear 2 times
    const tagCount = (text.match(/database/g) || []).length;
    assert.ok(tagCount >= 2);
  });

  it('handles missing fields gracefully', () => {
    const text = buildMemoryText({});
    assert.equal(text, '');
  });
});

// ===========================================================================
// Search Index CRUD
// ===========================================================================
describe('Search Index CRUD', () => {
  it('addDocument increases doc_count and updates df', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', {
      title: 'Database Connection Pooling',
      body: 'Use pg pool with release pattern.',
      tags: ['database', 'postgres'],
    });

    assert.equal(idx.doc_count, 1);
    assert.ok(idx.documents['mem_001']);
    assert.ok(idx.documents['mem_001'].length > 0);
    assert.ok(idx.df[stem('pool')] >= 1);
    assert.ok(idx.df[stem('database')] >= 1);
  });

  it('removeDocument decrements doc_count and df', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', {
      title: 'Database Pooling',
      body: 'Pool connections.',
      tags: ['database'],
    });
    addDocument(idx, 'mem_002', {
      title: 'Express Routes',
      body: 'Router pattern.',
      tags: ['express'],
    });

    assert.equal(idx.doc_count, 2);
    removeDocument(idx, 'mem_001');
    assert.equal(idx.doc_count, 1);
    assert.equal(idx.documents['mem_001'], undefined);
    // 'express' terms should still be in df
    assert.ok(idx.df['express'] >= 1);
  });

  it('addDocument replaces existing document on re-index', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', { title: 'Old Title', tags: ['old'] });
    addDocument(idx, 'mem_001', { title: 'New Title', tags: ['new'] });

    assert.equal(idx.doc_count, 1);
  });

  it('removeDocument is a no-op for unknown ID', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', { title: 'Test' });
    removeDocument(idx, 'nonexistent');
    assert.equal(idx.doc_count, 1);
  });
});

// ===========================================================================
// search
// ===========================================================================
describe('search', () => {
  it('returns relevance scores for matching documents', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_db', {
      title: 'Database Connection Pooling',
      body: 'Use pg pool. Connection pooling with release.',
      tags: ['database', 'postgres', 'pooling'],
    });
    addDocument(idx, 'mem_auth', {
      title: 'Authentication Strategy',
      body: 'JWT tokens with refresh rotation.',
      tags: ['auth', 'jwt', 'security'],
    });
    addDocument(idx, 'mem_route', {
      title: 'Express Router Pattern',
      body: 'Modular routes with async handlers.',
      tags: ['express', 'router'],
    });

    const scores = search(idx, 'database connection pooling');
    assert.ok(scores['mem_db'] > 0, 'Should match database memory');
    assert.ok((scores['mem_auth'] || 0) < scores['mem_db'], 'DB memory should score higher than auth');
  });

  it('returns empty for no matches', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', { title: 'Database Pooling', tags: ['database'] });
    const scores = search(idx, 'quantum physics');
    assert.equal(Object.keys(scores).length, 0);
  });

  it('returns empty for empty index', () => {
    const idx = createSearchIndex();
    const scores = search(idx, 'anything');
    assert.deepEqual(scores, {});
  });

  it('returns empty for empty query', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', { title: 'Test' });
    const scores = search(idx, '');
    assert.deepEqual(scores, {});
  });

  it('ranks more relevant documents higher', () => {
    const idx = createSearchIndex();
    addDocument(idx, 'mem_pool', {
      title: 'Connection Pool Pattern',
      body: 'Pool connections. Release after query. Pool size 10.',
      tags: ['pool', 'database'],
    });
    addDocument(idx, 'mem_mention', {
      title: 'API Design Notes',
      body: 'Consider connection limits for the pool.',
      tags: ['api'],
    });

    const scores = search(idx, 'connection pool');
    assert.ok(scores['mem_pool'] > scores['mem_mention'],
      `Pool memory (${scores['mem_pool']}) should score higher than mention (${scores['mem_mention']})`);
  });
});

// ===========================================================================
// File I/O
// ===========================================================================
describe('Search Index file I/O', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-tfidf-'));
    fs.mkdirSync(path.join(tmpDir, '.brain'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips through write and read', () => {
    const brainDir = path.join(tmpDir, '.brain');
    const idx = createSearchIndex();
    addDocument(idx, 'mem_001', { title: 'Test Memory', tags: ['test'] });

    writeSearchIndex(brainDir, idx);
    const loaded = readSearchIndex(brainDir);

    assert.equal(loaded.doc_count, 1);
    assert.ok(loaded.documents['mem_001']);
  });

  it('readSearchIndex returns null when file missing', () => {
    const brainDir = path.join(tmpDir, '.brain');
    assert.equal(readSearchIndex(brainDir), null);
  });
});

// ===========================================================================
// rebuildIndex
// ===========================================================================
describe('rebuildIndex', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-rebuild-'));
    const brainDir = path.join(tmpDir, '.brain');
    fs.mkdirSync(path.join(brainDir, 'professional', 'learning'), { recursive: true });

    // Create a memory file
    fs.writeFileSync(path.join(brainDir, 'professional', 'learning', 'test.md'), [
      '---',
      'id: "mem_test_001"',
      'type: "learning"',
      '---',
      '',
      '# Database Connection Pooling',
      '',
      'Use pg pool with parameterized queries.',
    ].join('\n'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds index from memory files on disk', () => {
    const brainDir = path.join(tmpDir, '.brain');
    const index = {
      memories: {
        'mem_test_001': {
          path: 'professional/learning/test.md',
          title: 'Database Connection Pooling',
          tags: ['database', 'pooling'],
        },
      },
    };

    const searchIndex = rebuildIndex(brainDir, index);
    assert.equal(searchIndex.doc_count, 1);
    assert.ok(searchIndex.documents['mem_test_001']);

    // Should be searchable
    const scores = search(searchIndex, 'database pooling');
    assert.ok(scores['mem_test_001'] > 0);
  });

  it('handles missing memory files gracefully', () => {
    const brainDir = path.join(tmpDir, '.brain');
    const index = {
      memories: {
        'mem_missing': {
          path: 'nonexistent/path.md',
          title: 'Missing Memory',
          tags: ['test'],
        },
      },
    };

    const searchIndex = rebuildIndex(brainDir, index);
    assert.equal(searchIndex.doc_count, 1);
    // Still indexed from title/tags even though file is missing
    const scores = search(searchIndex, 'missing memory');
    assert.ok(scores['mem_missing'] > 0);
  });
});

// ===========================================================================
// buildMemoryText — field weighting & the content branch
// ===========================================================================
describe('buildMemoryText', () => {
  it('repeats the title 3x and tags 2x for weighting', () => {
    const text = buildMemoryText({ title: 'alpha', tags: ['beta'], body: 'gamma' });
    assert.equal((text.match(/alpha/g) || []).length, 3);
    assert.equal((text.match(/beta/g) || []).length, 2);
    assert.equal((text.match(/gamma/g) || []).length, 1);
  });

  it('appends content only when it differs from body', () => {
    const differs = buildMemoryText({ title: 't', body: 'body-text', content: 'extra-content' });
    assert.ok(differs.includes('extra-content'));

    const same = buildMemoryText({ title: 't', body: 'identical', content: 'identical' });
    // 'identical' appears once (as body), not duplicated as content.
    assert.equal((same.match(/identical/g) || []).length, 1);
  });

  it('handles a content-only memory with no title/body/tags', () => {
    assert.equal(buildMemoryText({ content: 'lonely' }), 'lonely');
    assert.equal(buildMemoryText({}), '');
  });
});

// ===========================================================================
// cosineSimilarity — correctness & degenerate vectors
// ===========================================================================
describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    assert.ok(Math.abs(cosineSimilarity({ a: 1, b: 2 }, { a: 1, b: 2 }) - 1) < 1e-9);
    assert.equal(cosineSimilarity({ a: 1 }, { b: 1 }), 0);
  });
  it('is 0 when either vector is empty (no division by zero)', () => {
    assert.equal(cosineSimilarity({}, { a: 1 }), 0);
    assert.equal(cosineSimilarity({ a: 1 }, {}), 0);
  });
});

// ===========================================================================
// readSearchIndex — corruption surfaces, absence is null
// ===========================================================================
describe('tfidf.readSearchIndex error handling', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-tfidf-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns null when the index file is absent', () => {
    assert.equal(readSearchIndex(dir), null);
  });
  it('round-trips a written index and throws on corrupt JSON', () => {
    const si = createSearchIndex();
    addDocument(si, 'm1', { title: 'hello world', body: '', tags: [] });
    writeSearchIndex(dir, si);
    assert.equal(readSearchIndex(dir).doc_count, 1);

    fs.writeFileSync(path.join(dir, 'search-index.json'), '{ corrupt');
    assert.throws(() => readSearchIndex(dir));
  });
});

// ===========================================================================
// tokenize — guards
// ===========================================================================
describe('tokenize guards', () => {
  it('returns an empty array for empty/undefined/null input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(undefined), []);
    assert.deepEqual(tokenize(null), []);
  });
  it('drops a string that is entirely stopwords', () => {
    assert.deepEqual(tokenize('the and of a to'), []);
  });
});
