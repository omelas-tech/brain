#!/usr/bin/env node
/**
 * Seed a throwaway brain for one eval case.
 *
 * `claude plugin eval` runs every case with an empty temp HOME, so there is no
 * ~/.brain to recall from. Each case's scaffold script calls this with the
 * case's fixture: a JSON file `{ memories: [...], files: { "AGENTS.md": "…" } }`.
 * Memories go through the real write path (bin/memorize.js), so origin
 * clamps, lint and quarantine apply exactly as in production; `files` are
 * written into the run's workspace (the current directory).
 *
 * Usage: node seed.js <fixture.json>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('usage: seed.js <fixture.json>');
    process.exit(1);
  }
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const home = process.env.HOME || os.homedir();
  const brainDir = process.env.BRAIN_DIR || path.join(home, '.brain');

  require(path.join(PLUGIN_ROOT, 'src', 'installer.js')).initializeBrain(path.dirname(brainDir));

  if (fixture.memories && fixture.memories.length) {
    execFileSync(process.execPath, [path.join(PLUGIN_ROOT, 'bin', 'memorize.js')], {
      input: JSON.stringify({ memories: fixture.memories }),
      env: { ...process.env, BRAIN_DIR: brainDir },
      stdio: ['pipe', 'ignore', 'inherit'],
    });
  }

  for (const [rel, content] of Object.entries(fixture.files || {})) {
    const target = path.resolve(process.cwd(), rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

main();
