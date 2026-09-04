/**
 * Brain Memory — Sensitive-topic consent (per-fragment)
 *
 * Three tiers, deliberately matching the vocabulary of the largest deployed
 * consent model for assistant memory (Anthropic's, Aug 2026) so a brain is
 * interoperable with it rather than inventing a bespoke schema:
 *
 *   standard   Stored normally. The default.
 *   sensitive  Health, race, ethnicity, religious beliefs, politics, gender
 *              identity and similar. Excluded from storage unless the user has
 *              opted in (`sensitive_topics: true` in ~/.brain/config.json) —
 *              until then the write lands quarantined (`sensitive_opt_out`) and
 *              is hidden from recall and session-start. `brain verify approve`
 *              is per-item consent and lifts the exclusion for that memory.
 *              Never retroactive: opting in never rewrites what was refused.
 *   blocked    Government / national ID numbers, criminal history, immigration
 *              status. Refused at write time whatever the toggle says.
 *
 * The agent classifies (it read the conversation); the patterns here are a
 * backstop for the two tiers that must never depend on a caller's honesty.
 * They are narrow on purpose: a false "blocked" refuses a write the user asked
 * for, so only unambiguous identifiers and phrases qualify, and the sensitive
 * backstop flags rather than blocks. Nothing here is PII detection.
 */

const SENSITIVITY_LEVELS = ['standard', 'sensitive', 'blocked'];
const DEFAULT_SENSITIVITY = 'standard';
const SENSITIVE_OPT_OUT_REASON = 'sensitive_opt_out';

/** Category → description, as published. Kept as data so docs and prompts can cite it. */
const SENSITIVE_CATEGORIES = {
  health: 'physical or mental health, conditions, medication, treatment',
  race: 'race',
  ethnicity: 'ethnicity or national origin',
  religion: 'religious or philosophical beliefs',
  politics: 'political opinions or affiliation',
  gender_identity: 'gender identity or sexual orientation',
};

const BLOCKED_CATEGORIES = {
  government_id: 'social-security, passport, national-ID, tax or similar identification numbers',
  criminal_history: 'criminal history, charges, convictions',
  immigration_status: 'immigration or visa status',
};

// --- Backstop patterns ---

const BLOCKED_RULES = [
  // Structured identifiers: a US SSN, or an ID-word within a few tokens of a
  // 6-12 digit run (passport/national/tax IDs vary by country; the word makes
  // the digits unambiguous).
  { category: 'government_id', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    category: 'government_id',
    re: /\b(?:ssn|social\s+security|passport|national\s+id|tax\s+id|citizen\s+service|bsn|nino|sin)\b(?:\s+(?:number|no\.?|#))?[^\n\d]{0,20}\d(?:[\s-]?\d){5,11}\b/i,
  },
  { category: 'criminal_history', re: /\b(?:criminal\s+(?:record|history|charges?)|convicted\s+of|felony\s+conviction|misdemeanou?r\s+conviction|was\s+arrested\s+for|serv(?:ed|ing)\s+(?:time|a\s+sentence))\b/i },
  { category: 'immigration_status', re: /\b(?:immigration\s+status|visa\s+status|undocumented\s+immigrant|asylum\s+(?:seeker|claim|status)|deportation\s+order|green\s+card\s+(?:status|application)|overstayed\s+(?:a|the|my|their)\s+visa)\b/i },
];

const SENSITIVE_RULES = [
  { category: 'health', re: /\b(?:diagnos(?:ed|is)\s+with|my\s+(?:therapist|psychiatrist|oncologist|medication|diagnosis)|(?:takes?|taking|prescribed)\s+(?:antidepressants?|insulin|chemotherapy|adhd\s+medication)|mental\s+health\s+(?:condition|history|diagnosis)|(?:has|have|had)\s+(?:cancer|diabetes|epilepsy|hiv|depression|bipolar|schizophrenia|ptsd|anorexia|bulimia))\b/i },
  { category: 'race', re: /\b(?:racial\s+(?:identity|background)|(?:identif(?:y|ies)\s+as|is|am)\s+(?:black|white|asian|latino|latina|latinx|hispanic|indigenous|native\s+american|mixed[- ]race))\b/i },
  { category: 'ethnicity', re: /\b(?:ethnic(?:ity|\s+background)|(?:is|am|are)\s+(?:of\s+)?(?:kurdish|turkish|arab|jewish|romani|han\s+chinese|tamil|uyghur|persian|armenian|pashtun)\s*(?:descent|origin|heritage)?)\b/i },
  { category: 'religion', re: /\b(?:religious\s+(?:beliefs?|affiliation|background)|(?:is|am|are)\s+(?:a\s+)?(?:practi[sc]ing\s+)?(?:muslim|christian|catholic|protestant|jewish|hindu|buddhist|sikh|atheist|agnostic)\b|converted\s+to\s+(?:islam|christianity|judaism|buddhism|hinduism)|attends?\s+(?:church|mosque|synagogue|temple)\s+(?:every|weekly|regularly))/i },
  { category: 'politics', re: /\b(?:political\s+(?:views?|affiliation|opinions?|party)|vot(?:ed|es|ing)\s+(?:for|against)\s+(?:the\s+)?[A-Z][\w-]+|(?:is|am|are)\s+(?:a\s+)?(?:registered\s+)?(?:democrat|republican|conservative|liberal|socialist|libertarian|green\s+party\s+member)|member\s+of\s+(?:the\s+)?\w+\s+party)\b/i },
  { category: 'gender_identity', re: /\b(?:gender\s+identity|(?:is|am|are|identif(?:y|ies)\s+as)\s+(?:transgender|trans|non-?binary|genderfluid|genderqueer|gay|lesbian|bisexual|queer|asexual|pansexual)|sexual\s+orientation|came\s+out\s+as)\b/i },
];

function textOf(mem) {
  return `${(mem && mem.title) || ''}\n${(mem && mem.content) || ''}`;
}

/**
 * Backstop classification of a memory's text.
 *
 * @param {Object} mem - { title, content }
 * @returns {{ level: string, categories: string[] }}
 */
function classifySensitivity(mem) {
  const text = textOf(mem);
  const blocked = BLOCKED_RULES.filter((r) => r.re.test(text)).map((r) => r.category);
  if (blocked.length > 0) return { level: 'blocked', categories: [...new Set(blocked)] };
  const sensitive = SENSITIVE_RULES.filter((r) => r.re.test(text)).map((r) => r.category);
  if (sensitive.length > 0) return { level: 'sensitive', categories: [...new Set(sensitive)] };
  return { level: 'standard', categories: [] };
}

/**
 * Resolve the final sensitivity of a write and what to do with it.
 *
 * The caller's label can only raise the level (an agent may not call a match
 * for "criminal record" `standard`), and the backstop can only raise it too.
 *
 * @param {Object} mem - { title, content, sensitivity? }
 * @param {Object} config - brain config (sensitive_topics)
 * @returns {{ level, categories, action: 'store'|'quarantine'|'refuse', requested, error? }}
 */
function sensitivityDecision(mem, config) {
  const requested = mem && mem.sensitivity != null ? String(mem.sensitivity) : null;
  if (requested != null && !SENSITIVITY_LEVELS.includes(requested)) {
    return { error: `Unknown sensitivity "${requested}" (expected one of: ${SENSITIVITY_LEVELS.join(', ')})` };
  }
  const detected = classifySensitivity(mem);
  const rank = (l) => SENSITIVITY_LEVELS.indexOf(l);
  const level = rank(detected.level) > rank(requested || DEFAULT_SENSITIVITY) ? detected.level : (requested || DEFAULT_SENSITIVITY);

  let action = 'store';
  if (level === 'blocked') action = 'refuse';
  else if (level === 'sensitive' && !(config && config.sensitive_topics === true)) action = 'quarantine';

  return { level, categories: detected.categories, action, requested };
}

/**
 * Read-side gate: a sensitive memory is hidden from recall and session-start
 * unless the user opted in globally or approved this one (`vetted`).
 */
function isSensitiveHidden(entry, config) {
  if (!entry || entry.sensitivity !== 'sensitive') return false;
  if (config && config.sensitive_topics === true) return false;
  return !entry.vetted;
}

module.exports = {
  SENSITIVITY_LEVELS,
  DEFAULT_SENSITIVITY,
  SENSITIVE_OPT_OUT_REASON,
  SENSITIVE_CATEGORIES,
  BLOCKED_CATEGORIES,
  classifySensitivity,
  sensitivityDecision,
  isSensitiveHidden,
};
