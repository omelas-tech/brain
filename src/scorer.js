/**
 * Brain Memory — Scoring Utilities
 *
 * Computes effective memory strength after decay, relevance scoring,
 * spreading activation, context matching, spaced reinforcement,
 * and composite recall scores. Used by hooks and can be imported
 * by external tools.
 */

/**
 * Compute the effective (decayed) strength of a memory.
 *
 * @param {number} baseStrength - Original strength (0.0-1.0)
 * @param {number} decayRate - Daily decay factor (e.g., 0.995)
 * @param {string|Date} lastAccessed - ISO timestamp of last access
 * @param {boolean} [exempt=false] - CoALA Phase 1: pinned/stable memories are
 *   decay-exempt — their strength never fades (semantic "stable" property).
 * @returns {number} Effective strength after decay
 */
function computeDecayedStrength(baseStrength, decayRate, lastAccessed, exempt = false) {
  if (exempt) return baseStrength;
  const lastDate = new Date(lastAccessed);
  const now = new Date();
  const daysElapsed = (now - lastDate) / (1000 * 60 * 60 * 24);
  return baseStrength * Math.pow(decayRate, daysElapsed);
}

/**
 * Compute recency bonus — linear decay over one year.
 *
 * @param {string|Date} lastAccessed - ISO timestamp of last access
 * @returns {number} Recency bonus (0.0-1.0)
 */
function computeRecencyBonus(lastAccessed) {
  const lastDate = new Date(lastAccessed);
  const now = new Date();
  const daysElapsed = (now - lastDate) / (1000 * 60 * 60 * 24);
  return Math.min(1.0, Math.max(0, 1 - daysElapsed / 365));
}

/**
 * Compute the composite recall score for a memory (v4 formula).
 *
 * Weights: relevance 0.38, decayed_strength 0.18, recency 0.08,
 *          spreading_bonus 0.14, context_match 0.14, salience 0.08
 *
 * Falls back gracefully when newer fields are absent by
 * renormalizing weights to available terms.
 *
 * @param {number} relevance - Query relevance (0.0-1.0)
 * @param {number} decayedStrength - Effective strength after decay
 * @param {number} recencyBonus - Recency bonus
 * @param {Object} [extras] - Optional v2-v4 scoring components
 * @param {number} [extras.spreadingBonus] - Spreading activation bonus (0.0-1.0)
 * @param {number} [extras.contextMatch] - Context match score (0.0-1.0)
 * @param {number} [extras.salience] - Emotional/motivational salience (0.0-1.0)
 * @returns {number} Composite score
 */
function computeRecallScore(relevance, decayedStrength, recencyBonus, extras = {}) {
  // Full v4 weights
  const weights = {
    relevance: 0.38,
    decayedStrength: 0.18,
    recencyBonus: 0.08,
    spreadingBonus: 0.14,
    contextMatch: 0.14,
    salience: 0.08,
  };

  const values = {
    relevance,
    decayedStrength,
    recencyBonus,
  };

  // Add optional components if provided
  if (extras.spreadingBonus != null) values.spreadingBonus = extras.spreadingBonus;
  if (extras.contextMatch != null) values.contextMatch = extras.contextMatch;
  if (extras.salience != null) values.salience = extras.salience;

  // Renormalize weights to available terms
  let totalWeight = 0;
  for (const key of Object.keys(values)) {
    totalWeight += weights[key];
  }

  let score = 0;
  for (const key of Object.keys(values)) {
    score += (weights[key] / totalWeight) * values[key];
  }

  return score;
}

// --- Phase 1: Spreading Activation ---

/**
 * Compute spreading activation bonus for a memory reached via association links.
 *
 * Traverses associations up to maxDepth hops. For each path from a scored memory
 * to a candidate, the bonus is: parent_score * link_weight * (0.5 ^ hop).
 * Takes the maximum bonus across all paths.
 *
 * @param {string} memoryId - The candidate memory ID
 * @param {Object[]} scoredMemories - Array of {id, score} from initial scoring
 * @param {Object} associations - The associations graph
 * @param {number} [maxDepth=2] - Maximum hop depth
 * @returns {number} Spreading activation bonus (0.0-1.0)
 */
function computeSpreadingActivation(memoryId, scoredMemories, associations, maxDepth = 2) {
  if (!associations || !associations.edges) return 0;

  const edges = associations.edges;
  let maxBonus = 0;

  for (const source of scoredMemories) {
    if (source.id === memoryId) continue;
    if (source.score <= 0.3) continue;

    // BFS up to maxDepth hops
    const visited = new Set([source.id]);
    let frontier = [{ id: source.id, accumulator: source.score }];

    for (let hop = 1; hop <= maxDepth; hop++) {
      const nextFrontier = [];
      const dampening = Math.pow(0.5, hop);
      for (const node of frontier) {
        const neighbors = edges[node.id];
        if (!neighbors) continue;

        for (const neighborId in neighbors) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const bonus = node.accumulator * neighbors[neighborId].weight * dampening;

          if (neighborId === memoryId) {
            maxBonus = Math.max(maxBonus, bonus);
          }

          nextFrontier.push({ id: neighborId, accumulator: bonus });
        }
      }
      frontier = nextFrontier;
    }
  }

  return Math.min(1.0, maxBonus);
}

/**
 * Discover candidate memories reachable via spreading activation that weren't
 * in the initial result set.
 *
 * @param {Object[]} scoredMemories - Array of {id, score} from initial scoring
 * @param {Object} associations - The associations graph
 * @param {number} [maxDepth=2] - Maximum hop depth
 * @param {number} [minBonus=0.05] - Minimum bonus to include
 * @returns {Object[]} Array of {id, spreadingBonus} for new candidates
 */
function discoverViaActivation(scoredMemories, associations, maxDepth = 2, minBonus = 0.05) {
  if (!associations || !associations.edges) return [];

  const scoredIds = new Set(scoredMemories.map((m) => m.id));
  const candidates = {};

  for (const source of scoredMemories) {
    if (source.score <= 0.3) continue;

    const visited = new Set([source.id]);
    let frontier = [{ id: source.id, accumulator: source.score }];

    for (let hop = 1; hop <= maxDepth; hop++) {
      const nextFrontier = [];
      for (const node of frontier) {
        const neighbors = associations.edges[node.id];
        if (!neighbors) continue;

        for (const [neighborId, edge] of Object.entries(neighbors)) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const bonus = node.accumulator * edge.weight * Math.pow(0.5, hop);
          nextFrontier.push({ id: neighborId, accumulator: bonus });

          if (!scoredIds.has(neighborId) && bonus >= minBonus) {
            candidates[neighborId] = Math.max(candidates[neighborId] || 0, bonus);
          }
        }
      }
      frontier = nextFrontier;
    }
  }

  return Object.entries(candidates).map(([id, spreadingBonus]) => ({
    id,
    spreadingBonus,
  }));
}

// --- Phase 2: Context-Dependent Memory ---

/**
 * Compute context match score between encoding context and recall context.
 *
 * Formula: 0.3 * (project matches) + 0.4 * jaccard(topics) + 0.3 * (task_type matches)
 *
 * @param {Object} encodingCtx - Encoding context {project, topics, task_type}
 * @param {Object} recallCtx - Current recall context {project, topics, task_type}
 * @returns {number} Context match score (0.0-1.0)
 */
function computeContextMatch(encodingCtx, recallCtx) {
  if (!encodingCtx || !recallCtx) return 0;

  const projectMatch =
    encodingCtx.project && recallCtx.project && encodingCtx.project === recallCtx.project
      ? 1.0
      : 0.0;

  let topicJaccard = 0;
  if (encodingCtx.topics && recallCtx.topics) {
    const encTopics = new Set(encodingCtx.topics);
    const recTopics = new Set(recallCtx.topics);
    const intersection = [...encTopics].filter((t) => recTopics.has(t)).length;
    const union = new Set([...encTopics, ...recTopics]).size;
    topicJaccard = union > 0 ? intersection / union : 0;
  }

  const taskMatch =
    encodingCtx.task_type && recallCtx.task_type && encodingCtx.task_type === recallCtx.task_type
      ? 1.0
      : 0.0;

  return 0.3 * projectMatch + 0.4 * topicJaccard + 0.3 * taskMatch;
}

// --- Phase 2: Spaced Reinforcement ---

/**
 * Compute spaced reinforcement boost for a recall event.
 *
 * Uses spacing effect: memories recalled after longer intervals get larger boosts.
 * Uses diminishing returns: cramming produces smaller and smaller boosts.
 *
 * Formula:
 *   spacingMultiplier = min(3.0, 1.0 + log2(1 + daysSinceLastAccess))
 *   diminishingFactor = 1.0 / (1.0 + 0.1 * recallCount)
 *   boost = 0.05 * spacingMultiplier * diminishingFactor
 *
 * @param {number} daysSinceLastAccess - Days since last recall
 * @param {number} recallCount - Total prior recall count
 * @returns {number} Strength boost amount
 */
function computeSpacedBoost(daysSinceLastAccess, recallCount) {
  const spacingMultiplier = Math.min(3.0, 1.0 + Math.log2(1 + daysSinceLastAccess));
  const diminishingFactor = 1.0 / (1.0 + 0.1 * recallCount);
  return 0.05 * spacingMultiplier * diminishingFactor;
}

/**
 * Compute the reinforced strength after a recall event (v2 — spaced reinforcement).
 *
 * @param {number} currentStrength - Current base strength
 * @param {number} [daysSinceLastAccess] - Days since last recall (null for flat boost)
 * @param {number} [recallCount] - Total prior recall count
 * @returns {number} New base strength (capped at 1.0)
 */
function reinforceStrength(currentStrength, daysSinceLastAccess, recallCount) {
  // Backward-compatible: if no spacing info, use flat +0.05
  if (daysSinceLastAccess == null || recallCount == null) {
    return Math.min(1.0, currentStrength + 0.05);
  }
  const boost = computeSpacedBoost(daysSinceLastAccess, recallCount);
  return Math.min(1.0, currentStrength + boost);
}

/**
 * Improve a memory's decay rate after recall (it becomes more forgetting-resistant).
 *
 * Formula: new_decay_rate = decay_rate + 0.10 * (0.999 - decay_rate)
 *
 * @param {number} decayRate - Current daily decay rate
 * @returns {number} Improved decay rate (approaches 0.999 asymptotically)
 */
function improveDecayRate(decayRate) {
  return decayRate + 0.10 * (0.999 - decayRate);
}

/**
 * Compute consolidated strength from multiple source memories.
 *
 * @param {number[]} sourceStrengths - Strengths of source memories
 * @returns {number} Consolidated strength (capped at 1.0)
 */
function computeConsolidatedStrength(sourceStrengths) {
  // No sources to consolidate — Math.max(...[]) is -Infinity, so guard explicitly.
  if (!Array.isArray(sourceStrengths) || sourceStrengths.length === 0) return 0;
  const maxStrength = Math.max(...sourceStrengths);
  return Math.min(1.0, maxStrength + 0.15);
}

/**
 * Batch-compute spreading activation bonuses for all memories in a single pass.
 *
 * Instead of calling computeSpreadingActivation per-memory (O(N*M*E)),
 * this does one BFS per high-scoring source and collects bonuses for all
 * reachable targets at once (O(M*E)).
 *
 * @param {Object[]} scoredMemories - Array of {id, score}
 * @param {Object} associations - The associations graph
 * @param {number} [maxDepth=2] - Maximum hop depth
 * @returns {Object} Map of memoryId -> spreading activation bonus
 */
function computeSpreadingActivationBatch(scoredMemories, associations, maxDepth = 2) {
  if (!associations || !associations.edges) return {};

  const edges = associations.edges;
  const bonuses = {};

  for (const source of scoredMemories) {
    if (source.score <= 0.3) continue;

    const visited = new Set([source.id]);
    let frontier = [{ id: source.id, accumulator: source.score }];

    for (let hop = 1; hop <= maxDepth; hop++) {
      const nextFrontier = [];
      const dampening = Math.pow(0.5, hop);
      for (const node of frontier) {
        const neighbors = edges[node.id];
        if (!neighbors) continue;

        for (const neighborId in neighbors) {
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);

          const bonus = node.accumulator * neighbors[neighborId].weight * dampening;
          if (bonus > (bonuses[neighborId] || 0)) {
            bonuses[neighborId] = bonus;
          }

          nextFrontier.push({ id: neighborId, accumulator: bonus });
        }
      }
      frontier = nextFrontier;
    }
  }

  // Cap at 1.0
  for (const id in bonuses) {
    if (bonuses[id] > 1.0) bonuses[id] = 1.0;
  }

  return bonuses;
}

/**
 * Score and rank a list of memory entries for a given query.
 *
 * @param {Object[]} memories - Array of memory index entries
 * @param {Function} relevanceFn - Function(memory) => relevance score (0.0-1.0)
 * @param {Object} [options] - Optional scoring parameters
 * @param {Object} [options.associations] - Associations graph for spreading activation
 * @param {Object} [options.recallContext] - Current session context for context matching
 * @returns {Object[]} Scored and sorted memories (highest first)
 */
function rankMemories(memories, relevanceFn, options = {}) {
  // Guard every term against NaN (e.g. a missing/invalid last_accessed or
  // strength) — a single NaN score sorts non-deterministically and can outrank
  // valid results.
  const fin = (x) => (Number.isFinite(x) ? x : 0);

  // First pass: compute base scores
  const scored = memories.map((mem) => {
    const decayedStrength = fin(computeDecayedStrength(
      mem.strength,
      mem.decay_rate,
      mem.last_accessed,
      !!(mem.stable || mem.pinned) // pinned ⇒ implicitly stable (decay-exempt)
    ));
    const recencyBonus = fin(computeRecencyBonus(mem.last_accessed));
    const relevance = fin(relevanceFn(mem));

    return {
      ...mem,
      decayed_strength: decayedStrength,
      recency_bonus: recencyBonus,
      relevance: relevance,
      spreading_bonus: 0,
      context_match: 0,
    };
  });

  // Second pass: spreading activation (batch — single traversal for all memories)
  if (options.associations) {
    const scoredSummary = scored.map((m) => ({
      id: m.id,
      score: 0.55 * m.relevance + 0.30 * m.decayed_strength + 0.15 * m.recency_bonus,
    }));

    const bonuses = computeSpreadingActivationBatch(
      scoredSummary,
      options.associations
    );

    for (const mem of scored) {
      mem.spreading_bonus = bonuses[mem.id] || 0;
    }
  }

  // Third pass: context matching
  if (options.recallContext) {
    for (const mem of scored) {
      if (mem.encoding_context) {
        mem.context_match = computeContextMatch(mem.encoding_context, options.recallContext);
      }
    }
  }

  // Final score
  return scored
    .map((mem) => {
      const extras = {};
      if (mem.spreading_bonus > 0) extras.spreadingBonus = mem.spreading_bonus;
      if (mem.context_match > 0) extras.contextMatch = mem.context_match;
      if (mem.salience != null) extras.salience = mem.salience;

      const score = fin(computeRecallScore(
        mem.relevance,
        mem.decayed_strength,
        mem.recency_bonus,
        extras
      ));

      return {
        ...mem,
        decayed_strength: Math.round(mem.decayed_strength * 1000) / 1000,
        recency_bonus: Math.round(mem.recency_bonus * 1000) / 1000,
        relevance: Math.round(mem.relevance * 1000) / 1000,
        spreading_bonus: Math.round(mem.spreading_bonus * 1000) / 1000,
        context_match: Math.round(mem.context_match * 1000) / 1000,
        score: Math.round(score * 1000) / 1000,
      };
    })
    // Deterministic order: score desc, then id asc to break ties (scores are
    // rounded to 3dp, which manufactures ties at scale).
    .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

module.exports = {
  computeDecayedStrength,
  computeRecencyBonus,
  computeRecallScore,
  reinforceStrength,
  computeConsolidatedStrength,
  rankMemories,
  // Phase 1: Spreading Activation
  computeSpreadingActivation,
  computeSpreadingActivationBatch,
  discoverViaActivation,
  // Phase 2: Context & Spaced Reinforcement
  computeContextMatch,
  computeSpacedBoost,
  improveDecayRate,
};
