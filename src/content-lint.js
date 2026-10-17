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
 *   authorization
 *              A claim that the agent may act without asking ("the user
 *              approved force-pushes", "no need to confirm deploys"). Never
 *              downgraded: a writer that invents permission is the failure
 *              this catches, and it happens without any attacker. Gated
 *              separately from injection by src/quarantine.js — even a
 *              user-origin claim needs the user's own words behind it.
 *   suspect    Directive/imperative content. Downgraded to advisory for
 *              type:preference and cognitive_type:procedural memories, which
 *              legitimately contain instructions ("always use 2-space
 *              indent", skill steps).
 *   advisory   Recorded in the audit trail, never quarantining.
 *
 * Pure and dependency-free; used at write time by bin/memorize.js.
 */

const SEVERITY_RANK = { none: 0, advisory: 1, suspect: 2, authorization: 3, injection: 4 };

// secret_exfil pairs a transfer verb with a credential noun. Both must be
// standalone prose words: a verb that is a code literal or half of a compound
// (`upload`, upload-artifact, post-install) is a name, not an action, and a
// compound noun (password-reset, token_count) names a feature, not a secret.
// Without this, ordinary engineering notes ("the password-reset email", "set
// the destination to `upload`, then the API key…") quarantine as injections.
// `.env` is matched on its own: it starts with a non-word char, so a leading
// \b would require a word char before the dot and never match it bare.
const EXFIL_VERB = '(?<![`_\\-/.])\\b(?:send|post|upload|forward|exfiltrate|transmit|email)(?:s|ed|ing)?\\b(?![`_\\-/])';
const EXFIL_SECRET = '(?:(?<![`_\\-/])\\b(?:token|password|secret|api.?key|credential|private.?key)s?\\b(?![`_\\-])|(?<![\\w.])\\.env\\b)';
const EXFIL_GAP = '[^\\n.]{0,80}';
const SECRET_EXFIL_RE = new RegExp(
  `${EXFIL_VERB}${EXFIL_GAP}${EXFIL_SECRET}|${EXFIL_SECRET}${EXFIL_GAP}${EXFIL_VERB}`,
  'i'
);

// authorization_claim has three shapes, each anchored on who is granting or
// being granted — never on the bare words "approved"/"authorized", which
// ordinary notes about OAuth, RBAC and review workflows are full of:
//   1. a principal granted an *action* ("the user approved force-pushing");
//      approving a design or a PR is a fact, not a permission, so an action
//      verb must follow within the sentence;
//   2. the agent is told it may act ("you are allowed to", "Claude is
//      permitted to");
//   3. confirmation is waived ("no need to ask", "pre-approved", "standing
//      permission", "skip the confirmation").
const AUTHZ_GRANTOR = '\\b(?:the\\s+)?(?:user|owner|maintainer|admin(?:istrator)?|i|we)\\b';
const AUTHZ_GRANT = '(?:\\s+(?:has|have|had))?(?:\\s+(?:already|explicitly))?\\s+(?:approved|authori[sz]ed|okayed|ok\'d|signed\\s+off\\s+on|green-?lit|allowed|permitted)\\b';
const AUTHZ_ACTION = '\\b(?:force[\\s-]?push\\w*|push\\w*|deploy\\w*|delet\\w*|drop\\w*|merg\\w*|releas\\w*|publish\\w*|pay\\w*|send\\w*|email\\w*|transfer\\w*|run\\w*|execut\\w*|install\\w*|wip\\w*|rotat\\w*|revok\\w*|purchas\\w*|spend\\w*|skip\\w*|bypass\\w*|disabl\\w*|overwrit\\w*|rm\\b)';
const AUTHZ_AGENT = '\\b(?:you|the\\s+(?:agent|assistant|bot)|claude|codex|gemini|agents?)\\s+(?:are|is|have\\s+been|has\\s+been)(?:\\s+(?:now|always|explicitly))?\\s+(?:allowed|authori[sz]ed|permitted|cleared|granted\\s+(?:permission|access))\\b';
const AUTHZ_WAIVER = '\\b(?:no\\s+need\\s+to|(?:do\\s+not|don\'t|doesn\'t|does\\s+not)\\s+need\\s+to|without\\s+needing\\s+to)\\s+(?:ask|confirm|check\\s+with|get\\s+(?:approval|permission|sign-?off))\\b' +
  // Predicate only, and not "pre-approved for": "deploys are pre-approved" is a
  // permission; "pre-approved for a mortgage" and "pre-approved offers" are not.
  '|\\b(?:is|are|was|were|be|been|now)\\s+pre-?(?:approved|authori[sz]ed)\\b(?!\\s+for\\b)' +
  '|\\b(?:standing|blanket)\\s+(?:permission|approval|authori[sz]ation)\\b' +
  '|\\bskip\\s+(?:the\\s+)?(?:confirmation|approval|permission)\\b';
const AUTHZ_RE = new RegExp(
  `${AUTHZ_GRANTOR}${AUTHZ_GRANT}[^\\n.]{0,60}${AUTHZ_ACTION}|${AUTHZ_AGENT}|${AUTHZ_WAIVER}`,
  'i'
);

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
    re: SECRET_EXFIL_RE,
  },
  {
    rule: 'authorization_claim',
    severity: 'authorization',
    re: AUTHZ_RE,
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
