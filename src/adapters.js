/**
 * Brain Memory — Cross-vendor adapters (`brain port`)
 *
 * Pure conversions between brain memories and the formats other memory
 * systems read and write. No I/O here: bin/port.js loads memories, writes
 * files, and sends imports through `brain memorize`, so every import meets the
 * same origin policy, lint and quarantine as any other write.
 *
 * A brain memory, as these functions see it:
 *   { id, title, type, content, tags, created, origin }
 * Imports may also carry `saved` (YYYY-MM-DD): when the other system recorded
 * it. That is record time, not valid time, so it is never written as
 * `valid_from`; bin/port.js keeps it in the memory's `source`.
 *
 * Every target is lossier than brain. `FIDELITY` states, per target, which
 * fields survive a round trip, and test/adapters.test.js holds that table to
 * the code.
 *
 * Targets:
 *   claude-memory  Claude Code's file-based memory: one Markdown file per
 *                  memory with `name` / `description` / `metadata.type`
 *                  frontmatter, plus a MEMORY.md index of one-line pointers.
 *   markdown       One line per memory, `[YYYY-MM-DD] - <title>: <text>` — the
 *                  shape Claude.ai's memory import accepts as pasted text, and
 *                  readable anywhere else.
 *   agentcore      AWS Bedrock AgentCore Memory `BatchCreateMemoryRecords`
 *                  request bodies (≤100 records each, ≤16,000 chars of text per
 *                  record). Payloads only — no AWS SDK; send them with your own
 *                  credentials. Import reads the same shape, or the
 *                  `memoryRecordSummaries` a list/retrieve call returns.
 */

const BRAIN_TYPES = ['decision', 'insight', 'goal', 'experience', 'learning', 'relationship', 'preference', 'observation'];

// Claude Code's memory types are about *what the note is for*, not what kind
// of knowledge it is, so the mapping is many-to-one each way.
const TO_CLAUDE_TYPE = {
  preference: 'feedback',
  relationship: 'user',
  decision: 'project',
  goal: 'project',
  experience: 'project',
  insight: 'project',
  learning: 'project',
  observation: 'project',
};
const FROM_CLAUDE_TYPE = { user: 'relationship', feedback: 'preference', project: 'decision', reference: 'learning' };

const AGENTCORE_BATCH = 100;
const AGENTCORE_MAX_TEXT = 16000;

/** Fields that survive brain → target → brain. */
const FIDELITY = {
  'claude-memory': { title: true, content: true, type: 'mapped', tags: false, created: false },
  markdown: { title: true, content: 'single line', type: false, tags: false, created: 'date only' },
  agentcore: { title: true, content: 'up to 16,000 chars', type: true, tags: false, created: true },
};

function slug(text) {
  return String(text || 'memory').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'memory';
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function dateOnly(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Split `---\nfrontmatter\n---\nbody`; tolerant of a missing block. */
function splitFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: String(text) };
  const fm = {};
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    const nested = line.match(/^\s{2,}([\w-]+):\s*(.*)$/);
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (nested && parent) {
      fm[parent] = { ...(typeof fm[parent] === 'object' ? fm[parent] : {}), [nested[1]]: unquote(nested[2]) };
    } else if (top) {
      parent = top[2] === '' ? top[1] : null;
      fm[top[1]] = top[2] === '' ? {} : unquote(top[2]);
    }
  }
  return { fm, body: m[2] };
}

function unquote(v) {
  const s = String(v).trim();
  return /^".*"$|^'.*'$/.test(s) ? s.slice(1, -1) : s;
}

/* ─────────────────────────── claude-memory ─────────────────────────── */

function toClaudeMemory(memories) {
  const files = {};
  const index = ['# Memory Index', ''];
  const used = new Set();
  for (const m of memories) {
    let name = slug(m.title);
    for (let i = 2; used.has(name); i++) name = `${slug(m.title)}-${i}`;
    used.add(name);
    const description = oneLine(m.title).replace(/"/g, "'");
    files[`${name}.md`] = [
      '---',
      `name: ${name}`,
      `description: "${description}"`,
      'metadata:',
      `  type: ${TO_CLAUDE_TYPE[m.type] || 'project'}`,
      '---',
      '',
      String(m.content || '').trim(),
      '',
    ].join('\n');
    index.push(`- [${description}](${name}.md)`);
  }
  files['MEMORY.md'] = index.join('\n') + '\n';
  return { files };
}

/** @param {Object<string,string>} files - { "<name>.md": text }, MEMORY.md ignored */
function fromClaudeMemory(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    if (!file.endsWith('.md') || /(^|\/)MEMORY\.md$/.test(file)) continue;
    const { fm, body } = splitFrontmatter(text);
    const content = body.trim();
    if (!content) continue;
    const type = (fm.metadata && fm.metadata.type) || fm.type;
    out.push({
      title: oneLine(fm.description || fm.name || file.replace(/\.md$/, '')).slice(0, 120),
      type: FROM_CLAUDE_TYPE[type] || 'learning',
      content,
      tags: [],
    });
  }
  return out;
}

/* ─────────────────────────── markdown ─────────────────────────── */

function toMarkdown(memories) {
  const lines = memories.map((m) => {
    const date = dateOnly(m.created);
    const body = oneLine(m.content);
    return `${date ? `[${date}] - ` : '- '}${oneLine(m.title)}: ${body}`;
  });
  return { text: lines.join('\n') + '\n' };
}

const MD_LINE = /^(?:\[(\d{4}-\d{2}-\d{2})\]\s*-\s*|[-*]\s+)?(.+)$/;

function fromMarkdown(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(MD_LINE);
    if (!m) continue;
    const rest = m[2].trim();
    const colon = rest.indexOf(': ');
    const hasTitle = colon > 0 && colon <= 120;
    out.push({
      title: (hasTitle ? rest.slice(0, colon) : rest).slice(0, 120),
      type: 'learning',
      content: hasTitle ? rest.slice(colon + 2) : rest,
      tags: [],
      ...(m[1] ? { saved: m[1] } : {}),
    });
  }
  return out;
}

/* ─────────────────────────── agentcore ─────────────────────────── */

function toAgentCore(memories, { namespacePrefix = '/brain' } = {}) {
  const records = memories.map((m) => {
    const text = `${oneLine(m.title)}\n\n${String(m.content || '').trim()}`;
    const t = Date.parse(m.created);
    return {
      requestIdentifier: String(m.id || slug(m.title)).slice(0, 80),
      content: { text: text.slice(0, AGENTCORE_MAX_TEXT) },
      namespaces: [`${namespacePrefix}/${BRAIN_TYPES.includes(m.type) ? m.type : 'learning'}`],
      timestamp: Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000),
    };
  });
  const batches = [];
  for (let i = 0; i < records.length; i += AGENTCORE_BATCH) batches.push({ records: records.slice(i, i + AGENTCORE_BATCH) });
  const truncated = memories.filter((m) => `${oneLine(m.title)}\n\n${String(m.content || '').trim()}`.length > AGENTCORE_MAX_TEXT).length;
  return { batches, truncated };
}

/** Accepts `{batches:[{records}]}`, `{records}`, or `{memoryRecordSummaries}`. */
function fromAgentCore(json) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  const records = [
    ...((doc.batches || []).flatMap((b) => b.records || [])),
    ...(doc.records || []),
    ...(doc.memoryRecordSummaries || []),
  ];
  const out = [];
  for (const r of records) {
    const text = String((r.content && r.content.text) || '').trim();
    if (!text) continue;
    const [first, ...rest] = text.split(/\n\n/);
    const ns = (r.namespaces || [])[0] || '';
    const type = ns.split('/').pop();
    const ts = r.timestamp ?? r.createdAt;
    const iso = typeof ts === 'number' ? new Date(ts * 1000).toISOString() : (Date.parse(ts) ? new Date(ts).toISOString() : null);
    out.push({
      title: oneLine(first).slice(0, 120),
      type: BRAIN_TYPES.includes(type) ? type : 'learning',
      content: rest.length ? rest.join('\n\n') : text,
      tags: [],
      ...(iso ? { saved: iso.slice(0, 10) } : {}),
    });
  }
  return out;
}

const ADAPTERS = {
  'claude-memory': { exportTo: toClaudeMemory, importFrom: fromClaudeMemory, input: 'dir' },
  markdown: { exportTo: toMarkdown, importFrom: fromMarkdown, input: 'text' },
  agentcore: { exportTo: toAgentCore, importFrom: fromAgentCore, input: 'json' },
};

module.exports = {
  ADAPTERS,
  FIDELITY,
  toClaudeMemory,
  fromClaudeMemory,
  toMarkdown,
  fromMarkdown,
  toAgentCore,
  fromAgentCore,
  splitFrontmatter,
};
