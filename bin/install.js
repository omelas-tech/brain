#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  RUNTIMES,
  installForRuntime,
  initializeBrain,
  detectInstallations,
  uninstallForRuntime,
  detectVersionManager,
} = require('../src/installer');

// Interfaces whose stdin has ended. Tracked here because question() on a
// closed interface throws on some Node versions and silently never calls back
// on others.
const ended = new WeakSet();

function createRL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.once('close', () => ended.add(rl));
  return rl;
}

// Resolves null when stdin ends before an answer arrives — closed stdin, or a
// pipe that ran dry. Agents and CI run this installer without a terminal; a
// question that never resolves lets the event loop drain, and the process exits
// 0 having installed nothing. Callers must handle null (take the default, or
// fail loudly) rather than treat it as an answer.
function ask(rl, question) {
  return new Promise((resolve) => {
    if (ended.has(rl)) {
      console.log(question);
      return resolve(null);
    }
    const onClose = () => {
      console.log('');
      resolve(null);
    };
    rl.once('close', onClose);
    rl.question(question, (answer) => {
      rl.removeListener('close', onClose);
      resolve(answer);
    });
  });
}

function assumeYes(flags) {
  return flags.has('yes') || flags.has('y');
}

function warnIfVersionManaged() {
  const vm = detectVersionManager();
  if (!vm) return;
  console.log(`
  ⚠ brain is installed under ${vm.manager} (Node ${vm.version}).
    The \`brain\` command exists for that Node version only. It disappears when your
    default version changes, and shells that don't load ${vm.manager} — agent hooks,
    GUI-launched agents, non-interactive shells — never see it. When agents can't find
    \`brain\` they fall back to editing memory files by hand, with no error.
    Install brain-memory with a system Node instead (Homebrew, apt, the nodejs.org
    installer), then run \`brain update\`.`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const subcommands = ['install', 'update', 'uninstall'];
  let subcommand = 'install';
  const flags = new Set();

  for (const arg of args) {
    const clean = arg.replace(/^--/, '');
    if (subcommands.includes(clean) && arg === clean) {
      // positional subcommand (no --)
      subcommand = clean;
    } else if (clean === 'update') {
      subcommand = 'update';
    } else if (clean === 'uninstall') {
      subcommand = 'uninstall';
    } else {
      flags.add(clean);
    }
  }

  return { subcommand, flags };
}

function resolveRuntimesFromFlags(flags) {
  const runtimes = [];
  if (flags.has('claude')) runtimes.push('claude');
  if (flags.has('openai') || flags.has('codex')) runtimes.push('openai');
  if (flags.has('opencode')) runtimes.push('opencode');
  if (flags.has('antigravity')) runtimes.push('antigravity');
  if (flags.has('copilot')) runtimes.push('copilot');
  if (flags.has('kilo')) runtimes.push('kilo');
  // --all installs the verified CLIs. Antigravity stays opt-in (--antigravity)
  // because its native paths are experimental / pending live verification.
  // Copilot's paths come from official GA docs but stay opt-in (--copilot)
  // until confirmed against a live install.
  if (flags.has('all')) return ['claude', 'openai', 'opencode'];
  return runtimes;
}

function resolveScopeFromFlags(flags) {
  if (flags.has('global')) return 'global';
  if (flags.has('local')) return 'local';
  return null;
}

// Kilo's global prompt must be listed in the `instructions` array of
// kilo.jsonc; the installer only edits that file when it can do so safely
// (strict JSON, no comments). Otherwise, tell the user the one manual step.
function warnIfManualRegistration(result, config) {
  const reg = result.promptRegistration;
  if (reg && reg.manual) {
    const configPath = `${config.globalDir}/${config.instructionsConfig}`;
    const promptPath = `${config.globalDir}/${config.promptFile}`;
    console.log(`    ⚠ Could not edit ${configPath} safely (${reg.reason}).`);
    console.log(`      Add "${promptPath}" to its "instructions" array to activate the global prompt.`);
  }
  const hooks = result.hooks;
  if (hooks && hooks.registered) {
    console.log(`    Hooks registered in ${hooks.path} (SessionStart, UserPromptSubmit, SessionEnd).`);
    console.log('      Run /hooks inside Codex once to review and trust them.');
  } else if (hooks && hooks.manual) {
    console.log(`    ⚠ Could not edit ${hooks.path} safely (${hooks.reason}).`);
    console.log('      Merge hooks/hooks.json from the brain-memory package into it by hand.');
  }
}

// ---------------------------------------------------------------------------
// Install (original behavior, refactored from main)
// ---------------------------------------------------------------------------
async function runInstall(flags) {
  let runtimes = resolveRuntimesFromFlags(flags);
  let scope = resolveScopeFromFlags(flags);

  const rl = createRL();

  try {
    // Interactive runtime selection
    if (runtimes.length === 0) {
      console.log(' Which runtimes would you like to install for?\n');
      console.log(' 1) Claude Code');
      console.log(' 2) OpenAI Codex CLI');
      console.log(' 3) OpenCode');
      console.log(' 4) GitHub Copilot CLI');
      console.log(' 5) Kilo');
      console.log(' 6) Google Antigravity (experimental)');
      console.log(' 7) All current CLIs (Claude Code + Codex + OpenCode)');
      console.log('');

      const choice = await ask(rl, ' Select (1/2/3/4/5/6/7): ');
      if (choice === null) {
        throw new Error(
          'no runtime selected and no terminal to ask on. Name one, e.g. `brain install --claude --global`.'
        );
      }
      switch (choice.trim()) {
        case '1':
          runtimes = ['claude'];
          break;
        case '2':
          runtimes = ['openai'];
          break;
        case '3':
          runtimes = ['opencode'];
          break;
        case '4':
          runtimes = ['copilot'];
          break;
        case '5':
          runtimes = ['kilo'];
          break;
        case '6':
          runtimes = ['antigravity'];
          break;
        case '7':
          runtimes = ['claude', 'openai', 'opencode'];
          break;
        default:
          console.log(' Invalid choice. Defaulting to Claude Code.');
          runtimes = ['claude'];
      }
    }

    // Interactive scope selection
    if (!scope) {
      console.log('\n Installation scope:\n');
      console.log(' 1) Global — Available in all projects (~/.claude/, ~/.codex/, ~/.config/opencode/, ~/.agents/skills/)');
      console.log(' 2) Local — This project only (./.claude/, ./.codex/, ./.opencode/, ./.agents/skills/)');
      console.log('');

      const choice = await ask(rl, ' Select (1/2): ');
      scope = choice !== null && choice.trim() === '2' ? 'local' : 'global';
    }

    // Initialize .brain structure? No answer takes the prompt's own default
    // (yes) — initializeBrain() never overwrites an existing brain.
    let initBrain = 'y';
    if (!assumeYes(flags)) {
      console.log('');
      const answer = await ask(rl, '  Initialize ~/.brain/ directory? (Y/n): ');
      if (answer !== null) initBrain = answer;
    }

    // Perform installation
    console.log('\n  Installing...');
    for (const runtime of runtimes) {
      const config = RUNTIMES[runtime];
      console.log(`\n  Installing for ${config.name} (${scope})...`);
      const result = installForRuntime(runtime, scope) || {};
      console.log(`    Done!`);
      warnIfManualRegistration(result, config);
    }

    // Initialize .brain if requested
    if (initBrain.trim().toLowerCase() !== 'n') {
      const result = initializeBrain();
      if (result.alreadyExists) {
        console.log('\n    ~/.brain/ already exists, skipping initialization.');
      } else {
        console.log('\n    ~/.brain/ initialized successfully.');
        console.log('');
        console.log('    Use /brain:sync to set up portable sync across devices.');
      }
    }

    console.log(`
  ✓ Installation complete!

  Available commands:
    /brain:remember      Recall relevant memories
    /brain:memorize      Store a new memory
    /brain:status        Brain overview dashboard
    /brain:pin           Pin (or unpin) a memory in the always-present tier
    /brain:forget        Decay, archive, or forensically erase (--deep) memories
    /brain:sync          Sync via Brain Cloud, Git remote, or export/import
    /brain:skills        Manage procedural skills
    /brain:sleep         Full maintenance cycle (usually automatic)

  Your brain is ready — recall and memorize happen automatically. Just start working,
  or run /brain:status to see an overview.
    `);
    warnIfVersionManaged();
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
async function runUpdate(flags) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
  );
  const version = pkg.version;

  console.log('  Detecting existing installations...\n');

  let detections = detectInstallations();

  // Filter by explicit flags if provided
  const filterRuntimes = resolveRuntimesFromFlags(flags);
  const filterScope = resolveScopeFromFlags(flags);
  if (filterRuntimes.length > 0) {
    detections = detections.filter((d) => filterRuntimes.includes(d.runtime));
  }
  if (filterScope) {
    detections = detections.filter((d) => d.scope === filterScope);
  }

  if (detections.length === 0) {
    console.log('  No existing brain-memory installations found.\n');
    console.log('  To install, run: npm install -g brain-memory && brain install');
    if (filterRuntimes.length > 0) {
      console.log(`  (Searched for: ${filterRuntimes.join(', ')})`);
    }
    return;
  }

  console.log(`  Found ${detections.length} installation(s):\n`);
  for (const d of detections) {
    const parts = [];
    if (d.commandsFound) parts.push('commands');
    if (d.promptFound) parts.push('prompt');
    if (d.hooksFound) parts.push('hooks');
    console.log(`    ${d.runtimeName} (${d.scope}) — ${parts.join(' + ')}`);
  }

  console.log('\n  Updating...');
  for (const d of detections) {
    console.log(`\n  Updating ${d.runtimeName} (${d.scope})...`);
    const result = installForRuntime(d.runtime, d.scope) || {};
    console.log('    Done!');
    warnIfManualRegistration(result, RUNTIMES[d.runtime]);
  }

  console.log(`\n  ✓ Updated to v${version}\n`);
  warnIfVersionManaged();
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------
async function runUninstall(flags) {
  console.log('  Detecting existing installations...\n');

  let detections = detectInstallations();

  // Filter by explicit flags if provided
  const filterRuntimes = resolveRuntimesFromFlags(flags);
  const filterScope = resolveScopeFromFlags(flags);
  if (filterRuntimes.length > 0) {
    detections = detections.filter((d) => filterRuntimes.includes(d.runtime));
  }
  if (filterScope) {
    detections = detections.filter((d) => d.scope === filterScope);
  }

  if (detections.length === 0) {
    console.log('  No existing brain-memory installations found. Nothing to uninstall.\n');
    return;
  }

  console.log(`  Will remove ${detections.length} installation(s):\n`);
  for (const d of detections) {
    const parts = [];
    if (d.commandsFound) parts.push('commands');
    if (d.promptFound) parts.push('prompt section');
    if (d.hooksFound) parts.push('hooks');
    console.log(`    ${d.runtimeName} (${d.scope}) — ${parts.join(' + ')}`);
  }

  // Confirm unless --yes. No answer (no terminal) is a no: removal is never
  // something to default into.
  if (!assumeYes(flags)) {
    const rl = createRL();
    try {
      console.log('');
      const answer = await ask(rl, '  Proceed? (y/N): ');
      if (answer === null) {
        console.log('  Cancelled — no terminal to confirm on. Pass --yes to uninstall non-interactively.\n');
        return;
      }
      if (answer.trim().toLowerCase() !== 'y') {
        console.log('\n  Cancelled.\n');
        return;
      }
    } finally {
      rl.close();
    }
  }

  console.log('\n  Uninstalling...');
  for (const d of detections) {
    console.log(`\n  Removing ${d.runtimeName} (${d.scope})...`);
    uninstallForRuntime(d.runtime, d.scope);
    console.log('    Done!');
  }

  // Handle .brain/ data
  const brainDir = path.join(os.homedir(), '.brain');
  if (fs.existsSync(brainDir)) {
    if (flags.has('delete-data')) {
      fs.rmSync(brainDir, { recursive: true, force: true });
      console.log('\n  Deleted ~/.brain/ directory.');
    } else if (!assumeYes(flags)) {
      const rl = createRL();
      try {
        console.log('');
        const answer = await ask(
          rl,
          '  Delete ~/.brain/ data directory? This removes all memories. (y/N): '
        );
        if (answer !== null && answer.trim().toLowerCase() === 'y') {
          fs.rmSync(brainDir, { recursive: true, force: true });
          console.log('  Deleted ~/.brain/ directory.');
        } else {
          console.log('  Kept ~/.brain/ directory (your memories are preserved).');
        }
      } finally {
        rl.close();
      }
    } else {
      console.log('\n  Kept ~/.brain/ directory (use --delete-data to remove memories).');
    }
  }

  console.log('\n  ✓ Uninstall complete.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   ◉  Brain Memory — Installer                        ║
║                                                      ║
║   Hierarchical memory system for AI coding agents    ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);

  const { subcommand, flags } = parseArgs(process.argv);

  switch (subcommand) {
    case 'update':
      await runUpdate(flags);
      break;
    case 'uninstall':
      await runUninstall(flags);
      break;
    default:
      await runInstall(flags);
      break;
  }
}

main().catch((err) => {
  console.error('Operation failed:', err.message);
  process.exit(1);
});
