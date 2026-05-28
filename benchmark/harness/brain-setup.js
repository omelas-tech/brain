/**
 * Brain setup — creates isolated workspaces for benchmark runs.
 *
 * Each workspace gets its own HOME directory so agents cannot access
 * the user's real ~/.brain/ or global agent configs (~/.claude/CLAUDE.md, etc).
 * This ensures:
 *   - "without_brain" is truly brain-free (no contamination from personal memories)
 *   - "with_brain" only has the seeded benchmark memories
 *   - User's personal brain data is never read or modified
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const installer = require('../../src/installer');

/**
 * Create a clean, isolated workspace for a benchmark run.
 * Returns workDir (project files) and homeDir (isolated HOME).
 *
 * @param {string} scenarioName
 * @param {string} agentName
 * @param {string} variant - "with_brain" or "without_brain"
 * @param {number} [runIndex=0]
 * @returns {{ workDir: string, homeDir: string, brainDir: string|null }}
 */
function createWorkspace(scenarioName, agentName, variant, runIndex = 0) {
  const baseDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `brain-bench-${scenarioName}-${agentName}-${variant}-${runIndex}-`)
  );

  // Separate project dir and fake HOME dir
  const workDir = path.join(baseDir, 'project');
  const homeDir = path.join(baseDir, 'home');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  // Init git repo so agents trust the directory
  try {
    execFileSync('git', ['init'], { cwd: workDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'bench@test.local'], { cwd: workDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Benchmark'], { cwd: workDir, stdio: 'ignore' });
  } catch { /* git not strictly required */ }

  // Copy agent auth/config files from real HOME into isolated HOME
  // so agents can authenticate (API keys, settings, etc.)
  // but NOT brain data (~/.brain/) or brain prompts (~/.claude/CLAUDE.md etc.)
  copyAgentConfigs(homeDir, agentName);

  let brainDir = null;

  if (variant === 'with_brain') {
    // Initialize brain in the isolated HOME (homeDir/.brain/)
    const result = installer.initializeBrain(homeDir);
    brainDir = path.join(homeDir, '.brain');

    // Install agent prompts into the isolated HOME so the agent
    // reads the brain system prompt and commands
    installPromptsForAgent(homeDir, agentName);
  }

  return { workDir, homeDir, brainDir };
}

/**
 * Copy agent config directories from real HOME to isolated HOME.
 *
 * Copies the ENTIRE agent config dir (auth, settings, cache, etc.)
 * then strips brain-related files (CLAUDE.md brain section, brain commands).
 * This ensures auth works without leaking brain data.
 */
function copyAgentConfigs(homeDir, agentName) {
  const realHome = os.homedir();

  // Each agent's config directory
  const agentDirs = {
    claude: ['.claude'],
    gemini: ['.gemini'],
    codex: ['.codex'],
    // OpenCode keeps config in .config/opencode and credentials in .local/share/opencode.
    // We copy both so the custom provider entry in opencode.json is visible.
    opencode: ['.config/opencode', '.local/share/opencode', '.opencode'],
  };

  const dirs = agentDirs[agentName] || [];

  for (const dir of dirs) {
    const srcDir = path.join(realHome, dir);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(homeDir, dir);
    try {
      installer.copyDir(srcDir, destDir);
    } catch { /* skip if fails */ }

    // Strip brain-related content from the copied config
    stripBrainContent(destDir, agentName);
  }
}

/**
 * Remove brain-related files and content from a copied agent config dir.
 * Removes: brain commands, brain prompt sections from CLAUDE.md/GEMINI.md/AGENTS.md
 */
function stripBrainContent(configDir, agentName) {
  // Remove brain command directories
  const brainCommandPaths = [
    path.join(configDir, 'commands', 'brain'),
    path.join(configDir, 'skills', 'brain-init'),
    path.join(configDir, 'skills', 'brain-memorize'),
    path.join(configDir, 'skills', 'brain-remember'),
    path.join(configDir, 'skills', 'brain-status'),
  ];
  for (const p of brainCommandPaths) {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  }

  // Remove brain prompt sections from agent prompt files
  const promptFiles = {
    claude: 'CLAUDE.md',
    gemini: 'GEMINI.md',
    codex: 'AGENTS.md',
    opencode: 'AGENTS.md',
  };
  const promptFile = promptFiles[agentName];
  if (promptFile) {
    const promptPath = path.join(configDir, promptFile);
    if (fs.existsSync(promptPath)) {
      installer.removePromptSection(promptPath);
    }
  }

  // Remove project-level brain configs that might reference ~/.brain
  const projectDirs = path.join(configDir, 'projects');
  // Don't delete projects — they contain non-brain settings too
  // The brain prompt was already stripped above

  // Remove session history (may contain brain references)
  const historyPath = path.join(configDir, 'history.jsonl');
  if (fs.existsSync(historyPath)) {
    fs.unlinkSync(historyPath);
  }
}

/**
 * Build the env object for an agent subprocess.
 * Sets HOME to the isolated directory so the agent cannot access
 * the user's real ~/.brain/ or global configs.
 *
 * @param {string} homeDir - Isolated HOME directory
 * @param {Object} [extraEnv] - Additional env overrides (e.g. Ollama URLs)
 * @param {Object} [dotEnv] - API keys loaded from benchmark/.env
 * @returns {Object} Environment variables for the subprocess
 */
function buildAgentEnv(homeDir, extraEnv = {}, dotEnv = {}) {
  // Gemini CLI expects GEMINI_API_KEY (or GOOGLE_API_KEY).
  // Map GOOGLE_API_KEY → GEMINI_API_KEY so both are available.
  const resolvedEnv = { ...dotEnv };
  if (resolvedEnv.GOOGLE_API_KEY && !resolvedEnv.GEMINI_API_KEY) {
    resolvedEnv.GEMINI_API_KEY = resolvedEnv.GOOGLE_API_KEY;
  }

  return {
    ...process.env,
    HOME: homeDir,
    // API keys from .env file — ensures auth works despite HOME isolation
    ...resolvedEnv,
    // Mode-specific overrides (e.g. Ollama base URLs)
    ...extraEnv,
  };
}

/**
 * Install brain-memory prompts into the isolated HOME for a specific agent.
 */
function installPromptsForAgent(homeDir, agentName) {
  const runtimeMap = {
    claude: 'claude',
    gemini: 'gemini',
    codex: 'openai',
    opencode: 'opencode',
  };

  const runtimeKey = runtimeMap[agentName];
  if (!runtimeKey) return;

  const config = installer.RUNTIMES[runtimeKey];

  // Create the global config directory in the isolated HOME, preserving the
  // FULL relative path from real HOME (so `.config/opencode` ≠ `opencode`).
  const realHome = os.homedir();
  const relGlobal = path.relative(realHome, config.globalDir) || path.basename(config.globalDir);
  const globalDir = path.join(homeDir, relGlobal);
  fs.mkdirSync(globalDir, { recursive: true });

  // Copy brain commands
  const commandsSrc = path.join(installer.PACKAGE_ROOT, 'commands', 'brain');
  if (fs.existsSync(commandsSrc)) {
    if (config.commandStyle === 'skills') {
      const skillsDest = path.join(globalDir, config.commandsSubdir);
      installer.installSkills(commandsSrc, skillsDest);
    } else {
      const commandsDest = path.join(globalDir, config.commandsSubdir, 'brain');
      installer.copyDir(commandsSrc, commandsDest);
    }
  }

  // Inject the brain prompt into the global config dir
  installer.injectPrompt(globalDir, config.promptFile, config.promptSource);
}

/**
 * Copy scenario fixture files into the workspace.
 */
function copyFixtures(fixturesDir, workDir) {
  if (!fs.existsSync(fixturesDir)) return;

  const entries = fs.readdirSync(fixturesDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(fixturesDir, entry.name);
    const dest = path.join(workDir, entry.name);

    if (entry.isDirectory()) {
      installer.copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * Clean up a workspace after a benchmark run.
 */
function cleanupWorkspace(baseDir) {
  if (baseDir && baseDir.startsWith(os.tmpdir()) && fs.existsSync(baseDir)) {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // Retry once after a short delay — agent subprocesses may still be releasing file handles
      try {
        fs.rmSync(baseDir, { recursive: true, force: true });
      } catch { /* best-effort cleanup */ }
    }
  }
}

module.exports = {
  createWorkspace,
  buildAgentEnv,
  installPromptsForAgent,
  copyFixtures,
  cleanupWorkspace,
};
