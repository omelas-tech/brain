/**
 * Recall probe — shells out to `brain recall` and `brain session-start`
 * in an isolated HOME, parses the JSON, computes Recall@k against oracle IDs.
 *
 * Decouples *retrieval* failure (the memory system didn't surface the right
 * memory) from *application* failure (it did, but the agent didn't use it).
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRAIN_BIN = path.join(__dirname, '..', '..', 'bin', 'brain.js');

/** Read a memory file's body (everything after the YAML frontmatter). */
function readMemoryBody(homeDir, relPath) {
  if (!relPath) return '';
  try {
    const raw = fs.readFileSync(path.join(homeDir, '.brain', relPath), 'utf-8');
    const fmEnd = raw.indexOf('---', raw.indexOf('---') + 3);
    return (fmEnd !== -1 ? raw.slice(fmEnd + 3) : raw).trim();
  } catch { return ''; }
}

/**
 * Run `brain recall <query>` in the given isolated HOME and return parsed JSON.
 *
 * @param {Object} params
 * @param {string} params.homeDir - Isolated HOME containing .brain/
 * @param {string} params.query - Recall query
 * @param {string} [params.project] - Project context
 * @param {string} [params.task] - Task type
 * @param {string} [params.topics] - Comma-separated topics
 * @param {number} [params.top] - Top-k cutoff (default 10)
 * @returns {Promise<Array<{id: string, score: number, type: string, ...}>>}
 */
function recall({ homeDir, query, project, task, topics, top = 10 }) {
  return new Promise((resolve, reject) => {
    const args = [BRAIN_BIN, 'recall', query, '--top', String(top)];
    if (project) args.push('--project', project);
    if (task) args.push('--task', task);
    if (topics) args.push('--topics', topics);

    execFile('node', args, {
      cwd: homeDir,
      env: { ...process.env, HOME: homeDir },
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`brain recall failed: ${stderr || err.message}`));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error(`brain recall JSON parse: ${e.message} — ${stdout.slice(0, 200)}`)); }
    });
  });
}

/**
 * Run `brain session-start --project P` in the given isolated HOME.
 * This is the deterministic budget-bounded payload the agent should
 * actually see — what brain ships in production.
 *
 * @returns {Promise<Object>} The session-start payload
 */
function sessionStart({ homeDir, project, topics, task, top }) {
  return new Promise((resolve, reject) => {
    const args = [BRAIN_BIN, 'session-start'];
    if (project) args.push('--project', project);
    if (topics) args.push('--topics', topics);
    if (task) args.push('--task', task);
    if (top) args.push('--top', String(top));

    execFile('node', args, {
      cwd: homeDir,
      env: { ...process.env, HOME: homeDir },
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`brain session-start failed: ${stderr || err.message}`));
      try {
        const payload = JSON.parse(stdout);
        // Production session-start returns context_recall as a budget-bounded
        // INDEX (title/score, no body) because a live agent recalls full content
        // on demand. A single-shot benchmark agent can't — and the retriever
        // baseline arms inject full bodies — so to keep the arms apples-to-apples
        // we enrich the recalled set with the same content the agent would get if
        // it followed the recall. (pinned already carries `content`.)
        for (const m of payload.context_recall || []) {
          if (!m.content) m.content = readMemoryBody(homeDir, m.path);
        }
        resolve(payload);
      } catch (e) { reject(new Error(`session-start JSON parse: ${e.message} — ${stdout.slice(0, 200)}`)); }
    });
  });
}

/**
 * Compute Recall@k and NDCG@k for a recall result against oracle IDs.
 *
 * @param {Array<{id: string}>} ranked - Output of recall()
 * @param {string[]} oracleIds - Memory IDs that SHOULD be retrieved
 * @param {number[]} ks - Cutoffs to report (e.g. [1, 3, 5, 10])
 * @returns {{ recall: Object<number, number>, ndcg: Object<number, number>, ranks: number[], hits: string[] }}
 */
function scoreRetrieval(ranked, oracleIds, ks = [1, 3, 5, 10]) {
  const idToRank = new Map();
  ranked.forEach((r, i) => idToRank.set(r.id, i + 1));

  const ranks = oracleIds.map((id) => idToRank.get(id) || Infinity);
  const hits = oracleIds.filter((id) => idToRank.has(id));

  const recall = {};
  const ndcg = {};

  for (const k of ks) {
    const found = oracleIds.filter((id) => (idToRank.get(id) || Infinity) <= k).length;
    recall[k] = oracleIds.length > 0 ? Math.round((found / oracleIds.length) * 1000) / 1000 : 1;

    // NDCG: ideal DCG when all oracle items appear at top positions
    let dcg = 0;
    for (let i = 0; i < Math.min(k, ranked.length); i++) {
      if (oracleIds.includes(ranked[i].id)) dcg += 1 / Math.log2(i + 2);
    }
    let idcg = 0;
    for (let i = 0; i < Math.min(k, oracleIds.length); i++) idcg += 1 / Math.log2(i + 2);
    ndcg[k] = idcg > 0 ? Math.round((dcg / idcg) * 1000) / 1000 : 0;
  }

  return { recall, ndcg, ranks, hits };
}

/**
 * Build a human-readable memory context block from a session-start payload.
 * This is what gets prepended to the agent prompt in the brain-real arm.
 *
 * Mirrors how the production session-start hook injects context (see
 * prompts/*.md and hooks/) — concise, no verbatim file contents.
 */
function formatSessionStartForPrompt(payload) {
  if (!payload || payload.memory_count === 0) return '';

  const lines = ['Based on your project memory, you recall:\n'];

  if (payload.pinned && payload.pinned.length > 0) {
    lines.push('Always-on conventions (pinned):');
    for (const p of payload.pinned) {
      lines.push(`  • ${p.title || p.id}: ${p.content || p.body || ''}`.trim());
    }
    lines.push('');
  }

  if (payload.skills_index && payload.skills_index.length > 0) {
    lines.push('Available skills (load full SKILL.md when needed):');
    for (const s of payload.skills_index) {
      lines.push(`  • ${s.name}: ${s.description || ''}`.trim());
    }
    lines.push('');
  }

  if (payload.context_recall && payload.context_recall.length > 0) {
    lines.push('Relevant memories for this project:');
    for (const m of payload.context_recall) {
      const verb = TYPE_VERBS[m.type] || 'You noted';
      const detail = m.content || m.body || '';
      const head = m.title || m.id;
      lines.push(detail ? `  • ${verb} — ${head}: ${detail}` : `  • ${verb}: ${head}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const TYPE_VERBS = {
  decision: 'You decided',
  preference: 'You prefer',
  learning: 'You learned',
  insight: 'You realized',
  experience: 'You experienced',
  goal: 'Your goal is',
  observation: 'You noticed',
  relationship: 'You noted',
};

module.exports = { recall, sessionStart, scoreRetrieval, formatSessionStartForPrompt };
