/**
 * Brain Memory — Anomalous-Write Detection (OWASP ASI06: forensics)
 *
 * The detection half of the poisoning defense: provenance clamps and trust
 * weighting bound what a planted memory can claim; this module notices the
 * write *patterns* an attack leaves behind, so `brain restore` has a trigger.
 *
 * Three deterministic detectors over audit.log + index.json + associations.json:
 *   write_burst          Unusually many writes from one origin in a window.
 *   low_trust_clique     Co-tagged clusters of low-trust memories — planted
 *                        writes auto-link via tag_overlap edges and would
 *                        self-amplify through spreading activation.
 *   reinforced_low_trust Low-trust memories quietly accumulating recall
 *                        reinforcement without ever being verified.
 *
 * Origin-based quarantine is write-time only; findings here are the ONLY
 * retroactive path to flagging, and --apply is capped so an audit run can
 * never silently vanish a large slice of the brain.
 */

const { isLowTrust } = require('./provenance');
const { readAudit } = require('./audit');
const { listPending, applyQuarantine } = require('./quarantine');

// Writes-per-window ceilings by origin. Low-trust origins get tight budgets;
// agent-inferred is the ambient default and gets headroom.
const BURST_THRESHOLDS = {
  external: 5,
  'tool-output': 10,
  'agent-inferred': 30,
};

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_MAX_APPLY = 20;

/**
 * Sliding-window write bursts per origin over `memorize` audit events.
 *
 * @param {Object[]} auditEvents - Records from readAudit (oldest first)
 * @param {Object} [opts] - { windowHours }
 * @returns {Object[]} [{ kind:'write_burst', origin, count, threshold, window_start, ids }]
 */
function detectWriteBursts(auditEvents, opts = {}) {
  const windowMs = (opts.windowHours || DEFAULT_WINDOW_HOURS) * 3600 * 1000;
  const byOrigin = new Map();
  for (const rec of auditEvents) {
    if (rec.event !== 'memorize' || !rec.ts) continue;
    const t = Date.parse(rec.ts);
    if (Number.isNaN(t)) continue;
    const origin = rec.origin || 'agent-inferred';
    if (!byOrigin.has(origin)) byOrigin.set(origin, []);
    byOrigin.get(origin).push({ t, ts: rec.ts, id: rec.id });
  }

  const findings = [];
  for (const [origin, writes] of byOrigin) {
    const threshold = BURST_THRESHOLDS[origin];
    if (!threshold) continue; // user writes are never a burst
    writes.sort((a, b) => a.t - b.t);
    // Slide a window over the sorted writes; report the densest violation once.
    let best = null;
    let lo = 0;
    for (let hi = 0; hi < writes.length; hi++) {
      while (writes[hi].t - writes[lo].t > windowMs) lo++;
      const count = hi - lo + 1;
      if (count > threshold && (!best || count > best.count)) {
        best = { lo, hi, count };
      }
    }
    if (best) {
      findings.push({
        kind: 'write_burst',
        origin,
        count: best.count,
        threshold,
        window_start: writes[best.lo].ts,
        ids: writes.slice(best.lo, best.hi + 1).map((w) => w.id).filter(Boolean),
      });
    }
  }
  return findings;
}

/**
 * Connected components of tag_overlap edges whose endpoints are BOTH
 * low-trust and unvetted — the shape a batch of co-tagged planted writes
 * leaves in the association graph.
 *
 * @param {Object} index - Parsed index.json
 * @param {Object} associations - Parsed associations.json
 * @param {Object} [opts] - { minSize }
 * @returns {Object[]} [{ kind:'low_trust_clique', size, ids, shared_tags }]
 */
function detectLowTrustCliques(index, associations, opts = {}) {
  const minSize = opts.minSize || 3;
  const memories = (index && index.memories) || {};
  const edges = (associations && associations.edges) || {};

  const suspicious = (id) => {
    const e = memories[id];
    return e && isLowTrust(e.origin) && !e.vetted;
  };

  // Adjacency restricted to tag_overlap edges between suspicious nodes.
  const adj = new Map();
  for (const [src, targets] of Object.entries(edges)) {
    if (!suspicious(src)) continue;
    for (const [dst, edge] of Object.entries(targets)) {
      if (edge.origin !== 'tag_overlap' || !suspicious(dst)) continue;
      if (!adj.has(src)) adj.set(src, new Set());
      if (!adj.has(dst)) adj.set(dst, new Set());
      adj.get(src).add(dst);
      adj.get(dst).add(src);
    }
  }

  const seen = new Set();
  const findings = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const component = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      component.push(id);
      for (const next of adj.get(id) || []) {
        if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    if (component.length < minSize) continue;

    const tagCounts = new Map();
    for (const id of component) {
      for (const tag of (memories[id].tags || [])) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const shared = [...tagCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
      .slice(0, 5);

    findings.push({
      kind: 'low_trust_clique',
      size: component.length,
      ids: component.sort(),
      shared_tags: shared,
    });
  }
  return findings;
}

/**
 * Low-trust memories that keep getting recalled and reinforced without ever
 * being verified — quiet entrenchment through use.
 *
 * @param {Object} index - Parsed index.json
 * @param {Object} [opts] - { minAccess }
 * @returns {Object[]} [{ kind:'reinforced_low_trust', id, origin, access_count }]
 */
function detectReinforcedLowTrust(index, opts = {}) {
  const minAccess = opts.minAccess || 5;
  const findings = [];
  for (const [id, entry] of Object.entries((index && index.memories) || {})) {
    if (!isLowTrust(entry.origin)) continue;
    if (entry.vetted || entry.pinned) continue;
    if ((entry.access_count || 0) < minAccess) continue;
    findings.push({
      kind: 'reinforced_low_trust',
      id,
      origin: entry.origin,
      access_count: entry.access_count,
    });
  }
  return findings.sort((a, b) => b.access_count - a.access_count);
}

/**
 * Run all detectors and (optionally) quarantine the flagged memories.
 *
 * `proposed_quarantine` is the union of finding ids minus vetted, pinned,
 * user-origin, and already-quarantined entries. With `apply`, at most
 * `maxApply` ids are flagged per run (`truncated: true` reports the cut) —
 * an audit can propose broadly but never mass-quarantine.
 *
 * @param {string} brainDir - Path to ~/.brain/
 * @param {Object} deps - { index, associations, appendAudit, writeIndex } injected by the CLI
 * @param {Object} [opts] - { windowHours, apply, maxApply, now }
 * @returns {Object} { generated_at, window_hours, findings, pending_verification,
 *                     proposed_quarantine, applied?, truncated }
 */
function runAudit(brainDir, deps, opts = {}) {
  const windowHours = opts.windowHours || DEFAULT_WINDOW_HOURS;
  const maxApply = opts.maxApply || DEFAULT_MAX_APPLY;
  const now = opts.now || new Date().toISOString();
  const { index, associations } = deps;

  const sinceIso = new Date(Date.parse(now) - windowHours * 3600 * 1000).toISOString();
  const auditEvents = readAudit(brainDir, { since: sinceIso, events: ['memorize'] });

  const findings = [
    ...detectWriteBursts(auditEvents, { windowHours }),
    ...detectLowTrustCliques(index, associations),
    ...detectReinforcedLowTrust(index),
  ];

  const memories = (index && index.memories) || {};
  const proposed = new Set();
  for (const f of findings) {
    for (const id of f.ids || (f.id ? [f.id] : [])) {
      const e = memories[id];
      if (!e) continue;
      if (e.vetted || e.pinned || e.quarantined) continue;
      if (e.origin === 'user') continue;
      proposed.add(id);
    }
  }
  const proposedList = [...proposed].sort();

  const result = {
    generated_at: now,
    window_hours: windowHours,
    findings,
    pending_verification: listPending(index).length,
    proposed_quarantine: proposedList,
    truncated: false,
  };

  if (opts.apply && proposedList.length > 0) {
    const toApply = proposedList.slice(0, maxApply);
    result.truncated = proposedList.length > maxApply;
    result.applied = [];
    for (const id of toApply) {
      const reasons = findings
        .filter((f) => (f.ids || [f.id]).includes(id))
        .map((f) => `anomaly:${f.kind}`);
      const r = applyQuarantine(brainDir, index, id, [...new Set(reasons)], now);
      if (!r.error) {
        result.applied.push(id);
        deps.appendAudit(brainDir, {
          ts: now, event: 'audit_quarantine', id, reasons: [...new Set(reasons)],
        });
      }
    }
    if (result.applied.length > 0) deps.writeIndex(index);
    result.pending_verification = listPending(index).length;
  }

  return result;
}

module.exports = {
  detectWriteBursts,
  detectLowTrustCliques,
  detectReinforcedLowTrust,
  runAudit,
  BURST_THRESHOLDS,
};
