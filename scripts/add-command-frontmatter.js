#!/usr/bin/env node
/**
 * Prepend YAML frontmatter (description + argument-hint) to each slash-command
 * file in commands/brain/. Current Claude Code requires a `description` field
 * for a .md file to register as a slash command; without it the command is
 * silently skipped. Idempotent — skips any file that already has frontmatter.
 */
const fs = require('fs');
const path = require('path');

const META = {
  'init.md':        { description: 'Initialize the brain memory structure' },
  'memorize.md':    { description: 'Store memories from the current conversation context', hint: '[topic]' },
  'remember.md':    { description: 'Recall relevant memories with spreading activation and context matching', hint: '[query]' },
  'review.md':      { description: 'Spaced-repetition review session for memories due for reinforcement', hint: '[scope]' },
  'explore.md':     { description: 'Browse the brain memory hierarchy', hint: '[category]' },
  'consolidate.md': { description: 'Merge related weak memories into stronger combined memories', hint: '[scope]' },
  'forget.md':      { description: 'Decay or archive memories', hint: '[target]' },
  'sunshine.md':    { description: 'Deep forensic erasure — trace and remove all references to a memory', hint: '[target]' },
  'sleep.md':       { description: 'Full maintenance cycle: replay, homeostasis, consolidation, pruning, dreaming', hint: '[scope]' },
  'status.md':      { description: 'Dashboard with brain health overview' },
  'sync.md':        { description: 'Sync memories via Git remote, Brain Cloud, or export/import', hint: '[subcommand]' },
  'pin.md':         { description: 'Pin a memory to the always-present tier', hint: '[id|query]' },
  'unpin.md':       { description: 'Remove a memory from the always-present tier', hint: '[id|query]' },
  'skill.md':       { description: 'Manage procedural skills (list, show, add, use, remove, export)', hint: '[subcommand]' },
};

const dir = path.join(__dirname, '..', 'commands', 'brain');
let changed = 0, skipped = 0;

for (const [file, meta] of Object.entries(META)) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) { console.warn(`! missing: ${file}`); continue; }
  const body = fs.readFileSync(p, 'utf8');
  if (body.startsWith('---\n')) { skipped++; console.log(`= already has frontmatter: ${file}`); continue; }

  let fm = '---\n';
  fm += `description: ${meta.description}\n`;
  if (meta.hint) fm += `argument-hint: "${meta.hint}"\n`;
  fm += '---\n\n';

  fs.writeFileSync(p, fm + body);
  changed++;
  console.log(`+ added frontmatter: ${file}`);
}

console.log(`\nDone — ${changed} updated, ${skipped} skipped.`);
