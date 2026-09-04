/**
 * Plugin packaging — the repo root is a Claude Code + Codex plugin and a
 * marketplace for two plugins (brain, brain-cloud). These tests keep the four
 * manifests consistent with each other, with package.json, and with the files
 * they point at, so a rename or version bump can't ship a broken plugin.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const pkg = read('package.json');
const claudePlugin = read('.claude-plugin/plugin.json');
const claudeMarket = read('.claude-plugin/marketplace.json');
const codexPlugin = read('.codex-plugin/plugin.json');
const codexMarket = read('.agents/plugins/marketplace.json');
const cloudClaude = read('integrations/brain-cloud-plugin/.claude-plugin/plugin.json');
const cloudCodex = read('integrations/brain-cloud-plugin/.codex-plugin/plugin.json');
const hooks = read('hooks/hooks.json');

const CONNECTOR_URL = 'https://mcp.brainmemory.ai/mcp';
const KNOWN_HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop',
]);

describe('root plugin manifests', () => {
  it('is named "brain" so commands stay /brain:* on both hosts', () => {
    assert.equal(claudePlugin.name, 'brain');
    assert.equal(codexPlugin.name, 'brain');
  });

  it('carries the package version in every manifest and marketplace entry', () => {
    assert.equal(claudePlugin.version, pkg.version);
    assert.equal(codexPlugin.version, pkg.version);
    const entry = claudeMarket.plugins.find((p) => p.name === 'brain');
    assert.equal(entry.version, pkg.version);
  });

  it('points at existing commands, hooks, skills and icon assets', () => {
    assert.ok(exists(claudePlugin.commands));
    const commands = fs.readdirSync(path.join(ROOT, claudePlugin.commands)).filter((f) => f.endsWith('.md'));
    assert.ok(commands.length >= 10, `expected the /brain:* command set, found ${commands.length}`);
    assert.ok(exists(claudePlugin.hooks));
    assert.equal(codexPlugin.hooks, claudePlugin.hooks, 'both hosts share one hooks.json');
    assert.ok(exists(path.join(codexPlugin.skills, 'brain-memory', 'SKILL.md')));
    assert.ok(exists(codexPlugin.interface.composerIcon));
    assert.ok(exists(codexPlugin.interface.logo));
  });

  it('bundles a `brain` shim so plugin-only installs can call the CLI', () => {
    const shim = path.join(ROOT, 'bin', 'brain');
    assert.ok(fs.existsSync(shim));
    assert.ok(fs.statSync(shim).mode & 0o111, 'bin/brain must be executable');
    assert.match(fs.readFileSync(shim, 'utf-8'), /brain\.js/);
  });
});

describe('hooks/hooks.json', () => {
  it('only uses known events and command hooks rooted at ${CLAUDE_PLUGIN_ROOT}', () => {
    for (const [event, groups] of Object.entries(hooks.hooks)) {
      assert.ok(KNOWN_HOOK_EVENTS.has(event), `unknown hook event ${event}`);
      for (const group of groups) {
        for (const hook of group.hooks) {
          assert.equal(hook.type, 'command');
          const match = hook.command.match(/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[\w-]+\.mjs)"$/);
          assert.ok(match, `command must be node "\${CLAUDE_PLUGIN_ROOT}/hooks/<script>.mjs": ${hook.command}`);
          assert.ok(exists(match[1]), `${match[1]} missing`);
          assert.ok(Number.isInteger(hook.timeout) && hook.timeout > 0);
        }
      }
    }
  });

  it('keeps SessionEnd inside the 3s ceiling Codex allows', () => {
    for (const group of hooks.hooks.SessionEnd) {
      for (const hook of group.hooks) assert.ok(hook.timeout <= 3);
    }
  });
});

describe('marketplaces', () => {
  it('list the same plugins for Claude Code and Codex/ChatGPT', () => {
    const claudeNames = claudeMarket.plugins.map((p) => p.name).sort();
    const codexNames = codexMarket.plugins.map((p) => p.name).sort();
    assert.deepEqual(claudeNames, ['brain', 'brain-cloud']);
    assert.deepEqual(codexNames, claudeNames);
  });

  it('resolve every source to a directory holding both manifests', () => {
    const sources = [
      ...claudeMarket.plugins.map((p) => p.source),
      ...codexMarket.plugins.map((p) => p.source.path),
    ];
    for (const source of sources) {
      assert.ok(exists(path.join(source, '.claude-plugin', 'plugin.json')), `${source} lacks .claude-plugin`);
      assert.ok(exists(path.join(source, '.codex-plugin', 'plugin.json')), `${source} lacks .codex-plugin`);
    }
  });

  it('names the Claude marketplace after the npm package', () => {
    assert.equal(claudeMarket.name, pkg.name);
    assert.equal(codexMarket.name, pkg.name);
  });
});

describe('brain-cloud plugin', () => {
  it('declares only the hosted connector, identically for both hosts', () => {
    for (const manifest of [cloudClaude, cloudCodex]) {
      assert.equal(manifest.name, 'brain-cloud');
      assert.deepEqual(Object.keys(manifest.mcpServers), ['brain']);
      assert.equal(manifest.mcpServers.brain.type, 'http');
      assert.equal(manifest.mcpServers.brain.url, CONNECTOR_URL);
      assert.equal(manifest.commands, undefined);
      assert.equal(manifest.hooks, undefined);
    }
    assert.equal(cloudClaude.version, cloudCodex.version);
    const entry = claudeMarket.plugins.find((p) => p.name === 'brain-cloud');
    assert.equal(entry.version, cloudClaude.version);
  });
});
