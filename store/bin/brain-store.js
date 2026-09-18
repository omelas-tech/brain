#!/usr/bin/env node
'use strict';

/**
 * brain-store — self-hostable store for Brain Memory
 *
 *   brain-store serve                 Run the server
 *   brain-store user add <name>       Create a user and print their token (once)
 *   brain-store user list             List users
 *   brain-store user rotate <name>    Issue a new token; the old one stops working
 *   brain-store user remove <name>    Remove a user (--purge also deletes their data)
 *   brain-store keygen                Print a fresh encryption key
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { createStore, VERSION } = require('../server');
const { UserStore } = require('../lib/auth');
const { Storage, parseKey } = require('../lib/storage');

const HELP = `
brain-store ${VERSION} — self-hostable store for Brain Memory

Commands:
  serve [--port N] [--host H] [--data DIR]   Run the server
  user add <name> [--email E] [--data DIR]   Create a user; prints the token once
  user list [--data DIR]                     List users
  user rotate <name> [--data DIR]            Issue a new token for a user
  user remove <name> [--purge] [--data DIR]  Remove a user (--purge deletes their brains)
  keygen                                     Print a fresh encryption key

Environment (flags win over environment):
  STORE_DATA_DIR         Data directory            (default: ~/.brain-store)
  STORE_PORT             Port                      (default: 8787)
  STORE_HOST             Bind address              (default: 127.0.0.1)
  STORE_ENCRYPTION_KEY   32-byte key, hex or base64. Enables encryption at rest.
  STORE_MAX_UPLOAD_MB    Largest accepted archive  (default: 50)
  STORE_MAX_USER_MB      Storage per user, 0 = unlimited (default: 0)
  STORE_TRUST_PROXY      "1" when behind a reverse proxy that sets X-Forwarded-For
  STORE_OIDC_ISSUER      Accept OpenID Connect ID tokens from this issuer ...
  STORE_OIDC_AUDIENCE    ... issued to this client id. Users are created on first sign-in.
  STORE_OIDC_ALLOWED_DOMAINS, STORE_OIDC_ALLOWED_EMAILS
                         Comma-separated allow-lists. Required for a public issuer.
  STORE_QUIET            "1" to silence the request log

The server speaks plain HTTP. Put it behind a TLS-terminating reverse proxy
before exposing it beyond localhost. See SELF-HOSTING.md.
`.trim();

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function boolFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function dataDir(args) {
  return path.resolve(
    flag(args, '--data') || process.env.STORE_DATA_DIR || path.join(os.homedir(), '.brain-store')
  );
}

async function serve(args) {
  const dir = dataDir(args);
  const port = Number(flag(args, '--port') || process.env.STORE_PORT || 8787);
  const host = flag(args, '--host') || process.env.STORE_HOST || '127.0.0.1';
  const quiet = process.env.STORE_QUIET === '1';
  const encryptionKey = parseKey(process.env.STORE_ENCRYPTION_KEY);

  const oidc = process.env.STORE_OIDC_ISSUER
    ? {
      issuer: process.env.STORE_OIDC_ISSUER,
      audience: process.env.STORE_OIDC_AUDIENCE,
      allowedDomains: process.env.STORE_OIDC_ALLOWED_DOMAINS,
      allowedEmails: process.env.STORE_OIDC_ALLOWED_EMAILS,
    }
    : null;

  const store = createStore({
    dataDir: dir,
    encryptionKey,
    oidc,
    maxUploadBytes: Number(process.env.STORE_MAX_UPLOAD_MB || 50) * 1024 * 1024,
    maxUserBytes: Number(process.env.STORE_MAX_USER_MB || 0) * 1024 * 1024,
    trustProxy: process.env.STORE_TRUST_PROXY === '1',
    log: quiet ? null : (entry) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'),
  });

  const server = await store.listen(port, host);
  const bound = server.address();
  console.error(`brain-store ${VERSION} listening on http://${bound.address}:${bound.port}`);
  console.error(`  data: ${dir}`);
  console.error(`  encryption at rest: ${encryptionKey ? 'on' : 'off'}`);
  console.error(`  sign-in: static tokens${oidc ? ' + OpenID Connect (' + oidc.issuer + ')' : ''}`);
  console.error(`  users: ${store.users.list().length}`);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    console.error('  note: serving plain HTTP on a non-loopback address. Terminate TLS in front of this server.');
  }

  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function user(args) {
  const sub = args.shift();
  const dir = dataDir(args);
  const users = new UserStore(dir);

  if (sub === 'list') {
    const all = users.list();
    if (!all.length) return console.log('No users. Create one with: brain-store user add <name>');
    for (const u of all) console.log(`${u.id}\t${u.name}\t${u.email || '-'}\t${u.created_at}`);
    return;
  }

  if (sub === 'add') {
    const email = flag(args, '--email');
    const name = args.shift();
    if (!name) throw new Error('usage: brain-store user add <name> [--email E]');
    const created = users.add(name, email);
    // A first brain, so a client that logs in has something to sync to.
    new Storage(dir).createBrain(created.user.id, 'default');
    printToken(created, 'created');
    return;
  }

  if (sub === 'rotate') {
    const name = args.shift();
    if (!name) throw new Error('usage: brain-store user rotate <name>');
    printToken(users.rotate(name), 'rotated');
    return;
  }

  if (sub === 'remove') {
    const purge = boolFlag(args, '--purge');
    const name = args.shift();
    if (!name) throw new Error('usage: brain-store user remove <name> [--purge]');
    const removed = users.remove(name);
    if (purge) new Storage(dir).deleteUser(removed.id);
    console.log(`Removed ${removed.name} (${removed.id})${purge ? ' and deleted their brains' : '. Their brains were kept; add --purge to delete them'}.`);
    return;
  }

  throw new Error('usage: brain-store user add|list|rotate|remove');
}

function printToken(result, verb) {
  console.log(`User ${result.user.name} (${result.user.id}) ${verb}.`);
  console.log('');
  console.log('Token (shown once; the store keeps only a hash):');
  console.log('');
  console.log('  ' + result.token);
  console.log('');
  console.log('Connect a brain with:');
  console.log('  brain cloud login --api-url <store URL> --token-stdin');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === '--version' || command === '-v') return console.log(VERSION);
  if (command === 'serve') return serve(args);
  if (command === 'user') return user(args);
  if (command === 'keygen') return console.log(crypto.randomBytes(32).toString('hex'));

  console.error(`Unknown command: ${command}\n`);
  console.error(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error('Error: ' + err.message);
  process.exit(1);
});
