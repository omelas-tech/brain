const fs = require('fs');
const path = require('path');
const os = require('os');

const { getBrainDir } = require('./index-manager');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Local-first integration targets, current as of mid-2026. The hosted MCP
// connector (Brain Cloud) is the universal path for everything else (Claude.ai,
// ChatGPT, mobile, Antigravity/Gemini-Enterprise via remote MCP); these are the
// CLIs where a native install adds the ambient zero-config loop MCP can't.
//
// `skillsGlobalDir`/`skillsLocalDir` decouple where skills land from where the
// prompt lands (Codex prompts go to ~/.codex/AGENTS.md but skills go to the
// cross-tool ~/.agents/skills/). `skillName: true` injects the `name:`
// frontmatter that Codex/Antigravity require to match the skill folder.
//
// Gemini CLI was retired 2026-06-18 (absorbed into Antigravity) and is removed.
const RUNTIMES = {
  claude: {
    name: 'Claude Code',
    globalDir: path.join(os.homedir(), '.claude'),
    localDir: '.claude',
    commandsSubdir: 'commands',
    promptFile: 'CLAUDE.md',
    promptSource: 'claude.md',
    commandStyle: 'flat',
  },
  openai: {
    name: 'OpenAI Codex CLI',
    globalDir: path.join(os.homedir(), '.codex'),
    localDir: '.codex',
    commandsSubdir: 'skills',
    // Codex reads skills from the cross-tool ~/.agents/skills/, NOT ~/.codex/skills/.
    skillsGlobalDir: path.join(os.homedir(), '.agents', 'skills'),
    skillsLocalDir: path.join('.agents', 'skills'),
    promptFile: 'AGENTS.md',
    promptSource: 'openai.md',
    commandStyle: 'skills',
    skillName: true,
  },
  antigravity: {
    name: 'Google Antigravity',
    // NB: Antigravity reuses ~/.gemini/ and reads GEMINI.md globally + Markdown
    // SKILL.md skills under ~/.gemini/skills/. These paths are community-sourced
    // (official docs are JS SPAs) — VERIFY against a live Antigravity install.
    globalDir: path.join(os.homedir(), '.gemini'),
    localDir: '.',
    commandsSubdir: 'skills',
    skillsGlobalDir: path.join(os.homedir(), '.gemini', 'skills'),
    skillsLocalDir: path.join('.agents', 'skills'),
    promptFile: 'GEMINI.md',
    promptSource: 'antigravity.md',
    commandStyle: 'skills',
    skillName: true,
  },
  opencode: {
    name: 'OpenCode',
    globalDir: path.join(os.homedir(), '.config', 'opencode'),
    localDir: '.opencode',
    commandsSubdir: 'commands',
    promptFile: 'AGENTS.md',
    promptSource: 'opencode.md',
    commandStyle: 'flat',
  },
};

/** Where skills install for a runtime+scope (decoupled from the prompt target). */
function skillsDestFor(config, scope) {
  if (scope === 'global') {
    return config.skillsGlobalDir || path.join(config.globalDir, config.commandsSubdir);
  }
  return config.skillsLocalDir || path.join(config.localDir, config.commandsSubdir);
}

const BRAIN_MARKER_START = '<!-- BRAIN-MEMORY-START -->';
const BRAIN_MARKER_END = '<!-- BRAIN-MEMORY-END -->';

function copyDir(src, dest, _depth = 0) {
  if (_depth > 20) {
    throw new Error(`copyDir: max depth (20) exceeded at ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, _depth + 1);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function installSkills(commandsSrc, skillsDest, addName = false) {
  const entries = fs.readdirSync(commandsSrc).filter((f) => f.endsWith('.md'));
  for (const file of entries) {
    const name = file.replace('.md', '');
    const skillFolder = `brain-${name}`;
    const skillDir = path.join(skillsDest, skillFolder);
    fs.mkdirSync(skillDir, { recursive: true });
    let content = fs.readFileSync(path.join(commandsSrc, file), 'utf-8');
    if (addName) content = ensureSkillName(content, skillFolder);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  }
}

/**
 * Codex and Antigravity require a `name:` frontmatter field that matches the
 * skill folder. The source command files only carry `description:`, so inject
 * `name:` as the first frontmatter field (idempotent — skips if already present).
 */
function ensureSkillName(content, name) {
  if (/^---\s*\n/.test(content)) {
    const end = content.indexOf('\n---', 3);
    const block = end !== -1 ? content.slice(0, end) : content;
    if (/^\s*name\s*:/m.test(block)) return content;
    return content.replace(/^---\s*\n/, `---\nname: ${name}\n`);
  }
  return `---\nname: ${name}\n---\n\n${content}`;
}

function injectPrompt(targetDir, promptFile, promptSource) {
  const promptContent = fs.readFileSync(
    path.join(PACKAGE_ROOT, 'prompts', promptSource),
    'utf-8'
  );
  const targetPath = path.join(targetDir, promptFile);
  // Ensure the prompt dir exists. Previously this was created as a side-effect
  // of installing commands/skills into the same dir; now that skills can land
  // elsewhere (e.g. Codex skills → ~/.agents/skills), the prompt dir (~/.codex)
  // must be created explicitly.
  fs.mkdirSync(targetDir, { recursive: true });

  const wrappedContent = `\n${BRAIN_MARKER_START}\n${promptContent}\n${BRAIN_MARKER_END}\n`;

  if (fs.existsSync(targetPath)) {
    let existing = fs.readFileSync(targetPath, 'utf-8');
    // Remove old brain section if present
    const startIdx = existing.indexOf(BRAIN_MARKER_START);
    const endIdx = existing.indexOf(BRAIN_MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
      existing =
        existing.substring(0, startIdx) +
        existing.substring(endIdx + BRAIN_MARKER_END.length);
    }
    fs.writeFileSync(targetPath, existing.trimEnd() + '\n' + wrappedContent);
  } else {
    fs.writeFileSync(targetPath, wrappedContent.trim() + '\n');
  }
}

function detectInstallations() {
  const results = [];
  for (const [runtime, config] of Object.entries(RUNTIMES)) {
    for (const scope of ['global', 'local']) {
      const targetDir = scope === 'global' ? config.globalDir : config.localDir;
      const promptTarget = scope === 'global' ? config.globalDir : '.';
      const promptPath = path.join(promptTarget, config.promptFile);

      // Check for command files/dirs
      let commandsFound = false;
      if (config.commandStyle === 'skills') {
        const skillsDir = skillsDestFor(config, scope);
        commandsFound = fs.existsSync(skillsDir) &&
          fs.readdirSync(skillsDir).some(
            (d) => d.startsWith('brain-') &&
              fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))
          );
      } else {
        const commandsDir = path.join(targetDir, config.commandsSubdir, 'brain');
        commandsFound = fs.existsSync(commandsDir) &&
          fs.readdirSync(commandsDir).some((f) => f.endsWith('.md'));
      }

      // Check for prompt markers
      let promptFound = false;
      if (fs.existsSync(promptPath)) {
        const content = fs.readFileSync(promptPath, 'utf-8');
        promptFound = content.includes(BRAIN_MARKER_START) && content.includes(BRAIN_MARKER_END);
      }

      if (commandsFound || promptFound) {
        results.push({
          runtime,
          scope,
          runtimeName: config.name,
          commandsFound,
          promptFound,
          targetDir,
          promptPath,
        });
      }
    }
  }
  return results;
}

function removePromptSection(promptPath) {
  if (!fs.existsSync(promptPath)) {
    return { removed: false, reason: 'file-not-found' };
  }

  const content = fs.readFileSync(promptPath, 'utf-8');
  const startIdx = content.indexOf(BRAIN_MARKER_START);
  const endIdx = content.indexOf(BRAIN_MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    return { removed: false, reason: 'no-markers' };
  }

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + BRAIN_MARKER_END.length);
  const remaining = (before + after).trim();

  if (remaining.length === 0) {
    fs.unlinkSync(promptPath);
    return { removed: true, fileDeleted: true };
  }

  fs.writeFileSync(promptPath, remaining + '\n');
  return { removed: true, fileDeleted: false };
}

function removeCommands(targetDir, config, scope = 'global') {
  const removed = [];

  if (config.commandStyle === 'skills') {
    // Honor an explicit skills override; otherwise resolve relative to the
    // passed targetDir (so callers that pass a custom targetDir still work).
    const override = scope === 'global' ? config.skillsGlobalDir : config.skillsLocalDir;
    const skillsDir = override || path.join(targetDir, config.commandsSubdir);
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir).filter((d) => d.startsWith('brain-'));
      for (const entry of entries) {
        const fullPath = path.join(skillsDir, entry);
        fs.rmSync(fullPath, { recursive: true, force: true });
        removed.push(fullPath);
      }
    }
  } else {
    const commandsDir = path.join(targetDir, config.commandsSubdir, 'brain');
    if (fs.existsSync(commandsDir)) {
      removed.push(commandsDir);
      fs.rmSync(commandsDir, { recursive: true, force: true });
    }
  }

  return removed;
}

function uninstallForRuntime(runtime, scope) {
  if (!Object.keys(RUNTIMES).includes(runtime)) {
    throw new Error(`Unknown runtime: ${runtime}. Valid: ${Object.keys(RUNTIMES).join(', ')}`);
  }
  if (scope !== 'global' && scope !== 'local') {
    throw new Error(`Invalid scope: ${scope}. Must be 'global' or 'local'.`);
  }
  const config = RUNTIMES[runtime];
  const targetDir = scope === 'global' ? config.globalDir : config.localDir;
  const promptTarget = scope === 'global' ? config.globalDir : '.';
  const promptPath = path.join(promptTarget, config.promptFile);

  const removedCommands = removeCommands(targetDir, config, scope);
  const promptResult = removePromptSection(promptPath);

  return { removedCommands, promptResult };
}

function installForRuntime(runtime, scope) {
  if (!Object.keys(RUNTIMES).includes(runtime)) {
    throw new Error(`Unknown runtime: ${runtime}. Valid: ${Object.keys(RUNTIMES).join(', ')}`);
  }
  if (scope !== 'global' && scope !== 'local') {
    throw new Error(`Invalid scope: ${scope}. Must be 'global' or 'local'.`);
  }
  const config = RUNTIMES[runtime];
  const targetDir = scope === 'global' ? config.globalDir : config.localDir;
  const commandsSrc = path.join(PACKAGE_ROOT, 'commands', 'brain');

  if (config.commandStyle === 'skills') {
    const skillsDest = skillsDestFor(config, scope);
    // Clear stale brain-* skill dirs first so renamed/removed commands don't
    // linger across upgrades (e.g. brain-skill → brain-skills).
    if (fs.existsSync(skillsDest)) {
      for (const entry of fs.readdirSync(skillsDest)) {
        if (entry.startsWith('brain-')) {
          fs.rmSync(path.join(skillsDest, entry), { recursive: true, force: true });
        }
      }
    }
    installSkills(commandsSrc, skillsDest, config.skillName);
  } else {
    const commandsDest = path.join(targetDir, config.commandsSubdir, 'brain');
    // Wipe the brain command dir before copying so renamed/removed commands
    // don't linger across upgrades. This is critical on case-insensitive
    // filesystems: a leftover skill.md (== SKILL.md) makes Claude Code treat
    // the whole dir as one skill and hides every /brain:* command.
    fs.rmSync(commandsDest, { recursive: true, force: true });
    copyDir(commandsSrc, commandsDest);
  }

  const promptTarget = scope === 'global' ? config.globalDir : '.';
  injectPrompt(promptTarget, config.promptFile, config.promptSource);
}

function initializeBrain(overrideBase) {
  // Honors $BRAIN_DIR (via getBrainDir) so a fresh brain is created wherever the
  // user points it — e.g. inside a Google Drive / Dropbox / iCloud synced folder.
  const brainDir = overrideBase ? path.join(overrideBase, '.brain') : getBrainDir();

  if (fs.existsSync(brainDir)) {
    return { alreadyExists: true };
  }

  const now = new Date().toISOString();

  // Create directories
  const categories = ['professional', 'personal', 'social', 'family', '_consolidated', '_archived'];
  for (const cat of categories) {
    fs.mkdirSync(path.join(brainDir, cat), { recursive: true });
  }

  // Create index.json
  const index = {
    version: 2,
    created: now,
    last_updated: now,
    memory_count: 0,
    memories: {},
    config: {
      max_depth: 6,
      consolidation_threshold: 0.3,
      decay_check_interval_days: 7,
      strength_boost_on_recall: 0.05,
      auto_consolidate: true,
      propagation_window_days: 7,
      association_config: {
        co_retrieval_boost: 0.10,
        link_decay_rate: 0.998,
        link_prune_threshold: 0.05,
        spreading_activation_depth: 2,
        spreading_activation_decay: 0.5,
      },
    },
  };
  fs.writeFileSync(
    path.join(brainDir, 'index.json'),
    JSON.stringify(index, null, 2) + '\n'
  );

  // Create associations.json
  fs.writeFileSync(
    path.join(brainDir, 'associations.json'),
    JSON.stringify({ version: 1, edges: {} }, null, 2) + '\n'
  );

  // Create contexts.json
  fs.writeFileSync(
    path.join(brainDir, 'contexts.json'),
    JSON.stringify({ version: 1, sessions: [] }, null, 2) + '\n'
  );

  // Create review-queue.json
  fs.writeFileSync(
    path.join(brainDir, 'review-queue.json'),
    JSON.stringify({ version: 1, items: [] }, null, 2) + '\n'
  );

  // Create _archived/index.json
  fs.writeFileSync(
    path.join(brainDir, '_archived', 'index.json'),
    JSON.stringify({ version: 1, archived_count: 0, memories: {} }, null, 2) + '\n'
  );

  // Create search-index.json (TF-IDF)
  fs.writeFileSync(
    path.join(brainDir, 'search-index.json'),
    JSON.stringify({ version: 1, doc_count: 0, documents: {}, df: {} }, null, 2) + '\n'
  );

  // Load category descriptions from template
  const templatePath = path.join(PACKAGE_ROOT, 'templates', 'default-categories.json');
  let template = { top_categories: [] };
  if (fs.existsSync(templatePath)) {
    template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
  }

  // Create _meta.json for each category
  const mainCategories = ['professional', 'personal', 'social', 'family'];
  for (const cat of mainCategories) {
    const templateCat = template.top_categories.find((c) => c.name === cat) || {};
    const meta = {
      category: cat,
      description: templateCat.description || cat,
      created: now,
      memory_count: 0,
      subcategories: [],
    };
    fs.writeFileSync(
      path.join(brainDir, cat, '_meta.json'),
      JSON.stringify(meta, null, 2) + '\n'
    );
  }

  // Create _meta.json for special directories
  for (const special of ['_consolidated', '_archived']) {
    const meta = {
      category: special,
      description:
        special === '_consolidated'
          ? 'Merged memories from consolidation operations'
          : 'Archived memories preserved for recovery',
      created: now,
      memory_count: 0,
      subcategories: [],
    };
    fs.writeFileSync(
      path.join(brainDir, special, '_meta.json'),
      JSON.stringify(meta, null, 2) + '\n'
    );
  }

  return { alreadyExists: false, brainDir };
}

module.exports = {
  RUNTIMES,
  BRAIN_MARKER_START,
  BRAIN_MARKER_END,
  PACKAGE_ROOT,
  copyDir,
  installSkills,
  injectPrompt,
  installForRuntime,
  initializeBrain,
  detectInstallations,
  removePromptSection,
  removeCommands,
  uninstallForRuntime,
};
