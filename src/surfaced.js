/**
 * Brain Memory — Surfaced Ledger (citation lock)
 *
 * A receipt line (`◉ memory: "<title>" (…)`) tells the user a memory shaped an
 * answer. src/receipt.js guarantees the engine mints it; this module checks
 * the other half — that the agent only cites memories brain actually showed
 * it. Every read path (recall, session-start, prompt-recall) records what it
 * surfaced; `brain reinforce` records what was used; the Stop hook compares
 * the receipts in the final reply against the ledger.
 *
 * Device-local by design: `.local/` is excluded from git sync, cloud sync,
 * export and restore. What one machine's session saw says nothing about
 * another's, and the ledger is telemetry, not memory.
 *
 * Bounded: past MAX_LINES the file is trimmed to its newest KEEP_LINES. Every
 * write is best-effort — a full disk must never break recall.
 */

const fs = require('fs');
const path = require('path');

const LOCAL_DIR = '.local';
const LEDGER_FILE = 'surfaced.jsonl';
const MAX_LINES = 4000;
const KEEP_LINES = 2000;
// Receipts in a reply are matched against memories surfaced this session, or
// in this window when the reader could not name its session (a bare CLI call).
const UNSCOPED_WINDOW_MS = 12 * 3600 * 1000;

// Titles are not escaped in receipts (src/receipt.js), so match lazily up to
// the `" (` that opens the type segment.
const RECEIPT_RE = /◉ memory: "(.*?)" \(/g;

function ledgerPath(brainDir) {
  return path.join(brainDir, LOCAL_DIR, LEDGER_FILE);
}

/** The session id a CLI process can see, or null. Hooks pass theirs in. */
function envSession(env = process.env) {
  return env.BRAIN_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_SESSION_ID || null;
}

function append(brainDir, entries) {
  if (!entries.length) return;
  try {
    const file = ledgerPath(brainDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    trim(file);
  } catch (_) {
    // Telemetry only — never fail the read path that called us.
  }
}

function trim(file) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  if (lines.length <= MAX_LINES) return;
  fs.writeFileSync(file, lines.slice(-KEEP_LINES).join('\n') + '\n');
}

/**
 * Record memories a read path put in front of the agent.
 *
 * @param {string} brainDir
 * @param {Object} opts - { session, source, results: [{id, title, receipt}], now }
 */
function recordSurfaced(brainDir, { session, source, results, now }) {
  const ts = now || new Date().toISOString();
  append(brainDir, (results || []).filter((r) => r && r.id).map((r) => ({
    ts, kind: 'surfaced', session: session || null, source, id: r.id, title: receiptTitle(r.receipt) ?? r.title,
  })));
}

/** Record memories the agent reported using (`brain reinforce`). */
function recordUsed(brainDir, { session, ids, now }) {
  const ts = now || new Date().toISOString();
  append(brainDir, (ids || []).map((id) => ({ ts, kind: 'used', session: session || null, id })));
}

/** Record a reply that cited memories brain never surfaced. */
function recordViolation(brainDir, { session, titles, now }) {
  append(brainDir, [{ ts: now || new Date().toISOString(), kind: 'violation', session: session || null, titles }]);
}

/** Mark a session's violations as shown to the agent. */
function recordAck(brainDir, { session, now }) {
  append(brainDir, [{ ts: now || new Date().toISOString(), kind: 'ack', session: session || null }]);
}

function readLedger(brainDir) {
  try {
    return fs.readFileSync(ledgerPath(brainDir), 'utf-8').split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** The title inside a receipt line; null when it is not one. */
function receiptTitle(receipt) {
  if (typeof receipt !== 'string') return null;
  RECEIPT_RE.lastIndex = 0;
  const m = RECEIPT_RE.exec(receipt);
  return m ? m[1] : null;
}

/** Every receipt title cited in a reply. */
function citedTitles(text) {
  const titles = [];
  if (typeof text !== 'string') return titles;
  RECEIPT_RE.lastIndex = 0;
  let m;
  while ((m = RECEIPT_RE.exec(text)) !== null) titles.push(m[1]);
  return titles;
}

/**
 * Compare the receipts in a reply against what was surfaced to this session.
 *
 * @param {string} brainDir
 * @param {Object} opts - { session, text, nowMs }
 * @returns {{ cited: string[], unsurfaced: string[] }}
 */
function checkCitations(brainDir, { session, text, nowMs }) {
  const cited = citedTitles(text);
  if (!cited.length) return { cited, unsurfaced: [] };
  const now = nowMs ?? Date.now();
  const seen = new Set();
  for (const e of readLedger(brainDir)) {
    if (e.kind !== 'surfaced') continue;
    const sameSession = session && e.session === session;
    const unscoped = !e.session && now - Date.parse(e.ts) <= UNSCOPED_WINDOW_MS;
    if (sameSession || unscoped) seen.add(e.title);
  }
  return { cited, unsurfaced: [...new Set(cited.filter((t) => !seen.has(t)))] };
}

/** Violations recorded for a session since its last ack. */
function pendingViolations(brainDir, session) {
  if (!session) return [];
  let pending = [];
  for (const e of readLedger(brainDir)) {
    if (e.session !== session) continue;
    if (e.kind === 'ack') pending = [];
    else if (e.kind === 'violation') pending.push(...(e.titles || []));
  }
  return [...new Set(pending)];
}

/**
 * Surfaced vs used over a window — how much of what brain injects the agent
 * actually relies on. A low ratio means injection is mostly noise.
 */
function usageSummary(brainDir, { sinceMs }) {
  let surfaced = 0;
  let used = 0;
  const surfacedIds = new Set();
  const usedIds = new Set();
  for (const e of readLedger(brainDir)) {
    if (Date.parse(e.ts) < sinceMs) continue;
    if (e.kind === 'surfaced') { surfaced++; surfacedIds.add(e.id); }
    else if (e.kind === 'used') { used++; usedIds.add(e.id); }
  }
  const usedOfSurfaced = [...usedIds].filter((id) => surfacedIds.has(id)).length;
  return {
    surfaced,
    used,
    distinct_surfaced: surfacedIds.size,
    distinct_used_of_surfaced: usedOfSurfaced,
    use_rate: surfacedIds.size ? Math.round((usedOfSurfaced / surfacedIds.size) * 1000) / 1000 : null,
  };
}

module.exports = {
  LOCAL_DIR,
  envSession,
  recordSurfaced,
  recordUsed,
  recordViolation,
  recordAck,
  readLedger,
  receiptTitle,
  citedTitles,
  checkCitations,
  pendingViolations,
  usageSummary,
};
