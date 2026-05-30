const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

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
  gemini: {
    name: 'Gemini CLI',
    globalDir: path.join(os.homedir(), '.gemini'),
    localDir: '.gemini',
    commandsSubdir: 'commands',
    promptFile: 'GEMINI.md',
    promptSource: 'gemini.md',
    commandStyle: 'flat',
  },
  openai: {
    name: 'OpenAI Codex CLI',
    globalDir: path.join(os.homedir(), '.codex'),
    localDir: '.codex',
    commandsSubdir: 'skills',
    promptFile: 'AGENTS.md',
    promptSource: 'openai.md',
    commandStyle: 'skills',
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

function installSkills(commandsSrc, skillsDest) {
  const entries = fs.readdirSync(commandsSrc).filter((f) => f.endsWith('.md'));
  for (const file of entries) {
    const name = file.replace('.md', '');
    const skillDir = path.join(skillsDest, `brain-${name}`);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(
      path.join(commandsSrc, file),
      path.join(skillDir, 'SKILL.md')
    );
  }
}

function injectPrompt(targetDir, promptFile, promptSource) {
  const promptContent = fs.readFileSync(
    path.join(PACKAGE_ROOT, 'prompts', promptSource),
    'utf-8'
  );
  const targetPath = path.join(targetDir, promptFile);

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
        const skillsDir = path.join(targetDir, config.commandsSubdir);
        commandsFound = fs.existsSync(path.join(skillsDir, 'brain-init', 'SKILL.md'));
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

function removeCommands(targetDir, config) {
  const removed = [];

  if (config.commandStyle === 'skills') {
    const skillsDir = path.join(targetDir, config.commandsSubdir);
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

  const removedCommands = removeCommands(targetDir, config);
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
    const skillsDest = path.join(targetDir, config.commandsSubdir);
    // Clear stale brain-* skill dirs first so renamed/removed commands don't
    // linger across upgrades (e.g. brain-skill → brain-skills).
    if (fs.existsSync(skillsDest)) {
      for (const entry of fs.readdirSync(skillsDest)) {
        if (entry.startsWith('brain-')) {
          fs.rmSync(path.join(skillsDest, entry), { recursive: true, force: true });
        }
      }
    }
    installSkills(commandsSrc, skillsDest);
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
  const brainDir = path.join(overrideBase || os.homedir(), '.brain');

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
