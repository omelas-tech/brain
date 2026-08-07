/**
 * Brain Memory — Content Lint (OWASP ASI06: memory poisoning)
 *
 * A memory should record facts; a MemGhost-style payload is almost always
 * instruction-shaped ("always do X", "ignore previous instructions", "run
 * this command"). Origin labels are asserted by the caller, so an honest
 * agent relaying poisoned content can mislabel it — this lint catches the
 * payload shape itself, regardless of origin.
 *
 * Severity ladder:
 *   injection  Text that tries to steer the agent against the user. Never
 *              downgraded — no legitimate memory says "ignore previous
 *              instructions" or pipes a download into a shell.
 *   suspect    Directive/imperative content. Downgraded to advisory for
 *              type:preference and cognitive_type:procedural memories, which
 *              legitimately contain instructions ("always use 2-space
 *              indent", skill steps).
 *   advisory   Recorded in the audit trail, never quarantining.
 *
 * Pure and dependency-free; used at write time by bin/memorize.js.
 */

const SEVERITY_RANK = { none: 0, advisory: 1, suspect: 2, injection: 3 };

// Each rule: name, base severity, and a matcher over the combined text.
// Patterns are case-insensitive; `m` where line-anchoring matters.
const RULES = [
  {
    rule: 'injection_override',
    severity: 'injection',
    re: /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|rules?|context|prompts?)|\bnew\s+(?:system\s+)?instructions?\s*:|\byou\s+are\s+now\b|\bdo\s+not\s+(?:tell|inform|notify)\s+the\s+user\b|\bwithout\s+(?:asking|telling|informing)\s+the\s+user\b/i,
  },
  {
    rule: 'pipe_to_shell',
    severity: 'injection',
    re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i,
  },
  {
    rule: 'secret_exfil',
    severity: 'injection',
    re: /\b(?:send|post|upload|forward|exfiltrate|transmit|email)(?:s|ed|ing)?\b[^\n.]{0,80}\b(?:token|password|secret|api.?key|credential|private.?key|\.env)\b|\b(?:token|password|secret|api.?key|credential|private.?key)s?\b[^\n.]{0,80}\b(?:send|post|upload|forward|exfiltrate|transmit|email)(?:s|ed|ing)?\b/i,
  },
  {
    rule: 'imperative_directive',
    severity: 'suspect',
    re: /^(?:always|never|you\s+must|do\s+not|don't|make\s+sure\s+to|from\s+now\s+on|remember\s+to)\b/im,
  },
  {
    rule: 'command_execution',
    severity: 'suspect',
    re: /\b(?:run|execute)\b[^\n.]{0,60}\b(?:curl|wget|bash|sh\s+-c|npm\s+i(?:nstall)?|npx|pip\s+install|powershell)\b/i,
  },
  {
    rule: 'url_with_imperative',
    severity: 'suspect',
    re: null, // composite — handled in code below
  },
  {
    rule: 'tool_instruction',
    severity: 'suspect',
    re: /\b(?:use|call|invoke)\s+the\s+\w+\s+tool\b/i,
  },
];

const URL_RE = /https?:\/\/[^\s)"'<>]+/i;
const FETCH_VERB_RE = /\b(?:fetch|visit|open|download|navigate\s+to|go\s+to|send\s+to|post\s+to)\b/i;

// Memory shapes that legitimately contain instructions.
function isInstructionalShape(mem) {
  return mem.type === 'preference' || mem.cognitive_type === 'procedural';
}

/** First ~60 chars of the matched region, for the audit trail. */
function excerptAround(text, match) {
  if (!match) return '';
  const idx = text.toLowerCase().indexOf(match.toLowerCase());
  const start = Math.max(0, idx);
  return text.slice(start, start + 60).replace(/\s+/g, ' ').trim();
}

/**
 * Lint a memory's title + content for instruction-shaped payloads.
 *
 * @param {Object} mem - { title, content, type, cognitive_type }
 * @returns {{ flags: Array<{rule, severity, excerpt}>, severity: string }}
 *   `severity` is the highest flag severity ('none' when clean).
 */
function lintMemoryContent(mem) {
  const text = `${mem.title || ''}\n${mem.content || ''}`;
  const downgrade = isInstructionalShape(mem);
  const flags = [];

  for (const r of RULES) {
    let matched = null;
    if (r.rule === 'url_with_imperative') {
      if (URL_RE.test(text) && FETCH_VERB_RE.test(text)) {
        matched = (text.match(URL_RE) || [''])[0];
      }
    } else {
      const m = text.match(r.re);
      if (m) matched = m[0];
    }
    if (!matched) continue;

    // Injection rules are never downgraded; suspect rules become advisory for
    // instruction-shaped memory types.
    const severity = r.severity === 'suspect' && downgrade ? 'advisory' : r.severity;
    flags.push({ rule: r.rule, severity, excerpt: excerptAround(text, matched) });
  }

  const severity = flags.reduce(
    (top, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[top] ? f.severity : top),
    'none'
  );
  return { flags, severity };
}

module.exports = { lintMemoryContent, RULES, SEVERITY_RANK };
