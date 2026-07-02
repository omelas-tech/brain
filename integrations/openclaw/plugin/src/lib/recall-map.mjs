/**
 * recall-map — maps `brain recall` output rows onto the memory_search result
 * shape OpenClaw agents already know from memory-core (a JSON payload with a
 * `results` array of `{path, title, score, snippet, ...}` rows).
 *
 * brain recall rows look like:
 *   {id, title, path, type, score, relevance, decayed_strength,
 *    context_match, spreading_bonus, confidence, tags}
 */

/**
 * @param {unknown} raw           Parsed JSON from `brain recall`.
 * @param {{minScore?: number, maxResults?: number}} [options]
 * @returns {{
 *   results: Array<Record<string, unknown>>,
 *   ids: string[],
 *   lowConfidenceIds: string[],
 * }}
 */
export function mapRecallResults(raw, options = {}) {
  const rows = Array.isArray(raw) ? raw : [];
  const minScore = typeof options.minScore === "number" ? options.minScore : undefined;
  const maxResults =
    typeof options.maxResults === "number" && options.maxResults > 0 ? options.maxResults : undefined;

  const results = [];
  const ids = [];
  const lowConfidenceIds = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = /** @type {Record<string, any>} */ (row);
    const score = typeof record.score === "number" ? record.score : 0;
    if (minScore !== undefined && score < minScore) continue;
    const id = typeof record.id === "string" ? record.id : undefined;
    const confidence = typeof record.confidence === "number" ? record.confidence : undefined;
    const result = {
      corpus: "brain",
      id,
      path: typeof record.path === "string" ? record.path : "",
      title: typeof record.title === "string" ? record.title : id || "memory",
      kind: typeof record.type === "string" ? record.type : "memory",
      score,
      snippet: buildSnippet(record),
      // Extra brain-specific scoring detail, useful for the model's judgment.
      confidence,
      tags: Array.isArray(record.tags) ? record.tags.filter((t) => typeof t === "string") : [],
    };
    results.push(result);
    if (id) {
      ids.push(id);
      if (confidence !== undefined && confidence < 0.5) lowConfidenceIds.push(id);
    }
    if (maxResults !== undefined && results.length >= maxResults) break;
  }
  return { results, ids, lowConfidenceIds };
}

/** @param {Record<string, any>} record */
function buildSnippet(record) {
  const parts = [];
  if (typeof record.type === "string") parts.push(record.type);
  if (typeof record.relevance === "number") parts.push(`relevance ${record.relevance.toFixed(2)}`);
  if (typeof record.decayed_strength === "number") {
    parts.push(`strength ${record.decayed_strength.toFixed(2)}`);
  }
  if (typeof record.context_match === "number" && record.context_match > 0) {
    parts.push(`context ${record.context_match.toFixed(2)}`);
  }
  if (typeof record.confidence === "number" && record.confidence < 0.5) {
    parts.push(`LOW CONFIDENCE ${record.confidence.toFixed(2)}`);
  }
  const detail = parts.join(" · ");
  return detail
    ? `${detail} — read full memory with memory_get path="${record.path}"`
    : `read full memory with memory_get path="${record.path}"`;
}
