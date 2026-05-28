/**
 * Agent registry — discovers which CLI tools are installed and provides
 * a unified interface for running prompts across agents.
 */

const claude = require('./claude');
const gemini = require('./gemini');
const codex = require('./codex');
const opencode = require('./opencode');

const ALL_AGENTS = [claude, gemini, codex, opencode];

/**
 * Detect which agents are installed and available.
 * @returns {Promise<Object[]>} Array of available agent modules
 */
async function detectAvailable() {
  const results = await Promise.all(
    ALL_AGENTS.map(async (agent) => {
      const available = await agent.isAvailable();
      return { agent, available };
    })
  );

  return results
    .filter((r) => r.available)
    .map((r) => r.agent);
}

/**
 * Get a specific agent by name.
 * @param {string} name - Agent name (claude, gemini, codex)
 * @returns {Object|null} Agent module or null
 */
function getAgent(name) {
  return ALL_AGENTS.find((a) => a.name === name) || null;
}

/**
 * Get all registered agent names.
 * @returns {string[]}
 */
function getAllNames() {
  return ALL_AGENTS.map((a) => a.name);
}

module.exports = { detectAvailable, getAgent, getAllNames, ALL_AGENTS };
