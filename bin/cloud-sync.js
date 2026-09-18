#!/usr/bin/env node

/**
 * brain cloud — CLI for syncing with Brain Cloud or a self-hosted brain-store
 *
 * Usage:
 *   brain cloud login [--api-url URL]   Authenticate via device code flow
 *   brain cloud login --api-url URL --token-stdin
 *                                       Authenticate to a self-hosted store with a token
 *   brain cloud logout                  Clear stored credentials
 *   brain cloud push [--force]          Upload ~/.brain/ to the cloud
 *   brain cloud pull                    Download from the cloud to ~/.brain/
 *   brain cloud status                  Show connection and sync status
 */

const cloud = require('../src/cloud-sync');
const { getBrainDir } = require('../src/index-manager');

// Resolved via getBrainDir so Cloud sync targets the same brain as the rest of
// the CLI, including a $BRAIN_DIR override (synced folder, git working copy, …).
const BRAIN_DIR = getBrainDir();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
brain cloud — Brain Cloud sync CLI

Commands:
  login [--api-url URL]   Authenticate via device code flow
  logout                  Clear stored credentials
  push [--force]          Upload ~/.brain/ to the cloud
  pull                    Download from the cloud to ~/.brain/
  status                  Show connection and sync status

Self-hosted store (brain-store):
  login --api-url URL --token-stdin    Read the token from standard input, e.g.
                                         pbpaste | brain cloud login --api-url URL --token-stdin
  login --api-url URL --token TOKEN    Pass the token as an argument (it lands in shell history)
  login --api-url URL                  With BRAIN_STORE_TOKEN set in the environment
  --allow-http                         Permit plain HTTP to a host other than this machine

push refuses to overwrite changes it has not pulled. --force uploads anyway.
`.trim());
    process.exit(0);
  }

  switch (command) {
    case 'login':
      await cmdLogin(args);
      break;
    case 'logout':
      cmdLogout();
      break;
    case 'push':
      await cmdPush(args);
      break;
    case 'pull':
      await cmdPull();
      break;
    case 'status':
      await cmdStatus();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

async function cmdLogin(args) {
  let apiUrl;
  const urlIdx = args.indexOf('--api-url');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    apiUrl = args[urlIdx + 1];
  }

  const token = await readToken(args);
  if (token) {
    const result = await cloud.loginWithToken(BRAIN_DIR, apiUrl, token, {
      allowHttp: args.includes('--allow-http'),
    });
    console.log(`✓ Logged in as ${result.user_email || 'unknown'}`);
    console.log(`  Brain ID: ${result.brain_id}`);
    console.log(`  API: ${result.api_url}`);
    return;
  }

  console.log('Requesting device code...');
  const loginInfo = await cloud.login(BRAIN_DIR, apiUrl);

  console.log();
  console.log('  Open this URL in your browser to log in:');
  console.log();
  console.log(`    ${loginInfo.verify_url}`);
  console.log();
  console.log(`  Your code: ${loginInfo.user_code}`);
  console.log();
  console.log(`  Waiting for approval (expires in ${Math.floor(loginInfo.expires_in / 60)} min)...`);

  await loginInfo.waitForApproval();

  const config = cloud.readConfig(BRAIN_DIR);
  console.log();
  console.log(`✓ Logged in as ${config.user_email || 'unknown'}`);
  if (config.brain_id) {
    console.log(`  Brain ID: ${config.brain_id}`);
  }
  console.log(`  API: ${config.api_url}`);
}

/**
 * A store token from --token-stdin, --token, or BRAIN_STORE_TOKEN, in that order.
 * Standard input is preferred: it keeps the token out of shell history and out of
 * the process list.
 */
async function readToken(args) {
  if (args.includes('--token-stdin')) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const token = Buffer.concat(chunks).toString('utf8').trim();
    if (!token) throw new Error('--token-stdin was given but standard input was empty.');
    return token;
  }
  const idx = args.indexOf('--token');
  if (idx !== -1) {
    if (!args[idx + 1]) throw new Error('--token needs a value.');
    return args[idx + 1];
  }
  return process.env.BRAIN_STORE_TOKEN || null;
}

function cmdLogout() {
  cloud.logout(BRAIN_DIR);
  console.log('✓ Logged out. Credentials cleared.');
}

async function cmdPush(args) {
  console.log('Packing ~/.brain/ ...');
  const result = await cloud.push(BRAIN_DIR, { force: args.includes('--force') });
  console.log();
  console.log('✓ Push complete!');
  console.log(`  Size:     ${formatBytes(result.size_bytes)}`);
  console.log(`  Files:    ${result.file_count}`);
  console.log(`  Checksum: ${result.checksum}`);
}

async function cmdPull() {
  console.log('Downloading from cloud...');
  const result = await cloud.pull(BRAIN_DIR);
  console.log();
  console.log('✓ Pull complete!');
  console.log(`  Size:     ${formatBytes(result.size_bytes)}`);
  if (result.checksum) {
    console.log(`  Checksum: ${result.checksum}`);
  }
}

async function cmdStatus() {
  const s = await cloud.status(BRAIN_DIR);

  if (!s.connected) {
    console.log('☁️  Not connected to Brain Cloud');
    console.log('   Run: brain cloud login');
    return;
  }

  console.log('☁️  Brain Cloud Status');
  console.log('─────────────────────────');
  console.log(`  API:          ${s.api_url}`);
  console.log(`  User:         ${s.user_email || 'unknown'}`);
  console.log(`  Brain ID:     ${s.brain_id || 'none'}`);
  if (s.brain_name) console.log(`  Brain Name:   ${s.brain_name}`);
  if (s.brain_size !== null) console.log(`  Cloud Size:   ${formatBytes(s.brain_size)}`);
  if (s.brain_files !== null) console.log(`  Cloud Files:  ${s.brain_files}`);
  console.log(`  Last Push:    ${s.last_push || 'never'}`);
  console.log(`  Last Pull:    ${s.last_pull || 'never'}`);
  console.log(`  Last Synced:  ${s.last_synced || 'never'}`);
  console.log(`  Connected:    ${s.connected_at || 'unknown'}`);
}

function formatBytes(bytes) {
  if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
