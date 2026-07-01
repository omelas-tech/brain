#!/usr/bin/env node
// Agentic release + changelog tool for brain-memory.
//
//   node scripts/release.mjs                 # generate the next changelog entry (agentic) + bump + tag
//   node scripts/release.mjs generate        # (same as default)
//   node scripts/release.mjs status          # show pending commits + next version
//   node scripts/release.mjs sync-web         # regenerate website/public/data/changelog.json from CHANGELOG.md
//
// Flags for generate:
//   --dry-run      classify + show the proposed entry, write nothing
//   --yes          accept the model's proposal without prompting (for agent/CI use)
//   --skip-claude  skip the model, enter the changelog by hand
//   --no-commit    write CHANGELOG.md + package.json but don't commit/tag
//   --since <ref>  compute the delta since <ref> instead of the last v* tag
//   --as <version> use an explicit next version instead of bumping the beta counter
//
// CHANGELOG.md (Keep a Changelog) is the source of truth. The website changelog
// page derives from it via website/scripts/build-changelog.mjs (run here and in
// the website build). Publishing to npm stays a separate, deliberate step.

import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createInterface } from "readline";
import { tmpdir } from "os";
import { classifyChanges, validate, CATEGORIES } from "./lib/claude-bump.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const pkgPath = join(repoRoot, "package.json");
const changelogPath = join(repoRoot, "CHANGELOG.md");
const buildChangelogScript = join(repoRoot, "website", "scripts", "build-changelog.mjs");

// ---------- small helpers ----------

function git(args, opts = {}) {
  const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", ...opts });
  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(" ")} failed: ${(res.stderr || "").trim()}`);
  }
  return (res.stdout || "").trim();
}

function readVersion() {
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function writeVersion(version) {
  const raw = readFileSync(pkgPath, "utf8");
  const next = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (next === raw) throw new Error("could not find version field in package.json");
  writeFileSync(pkgPath, next);
}

function lastTag() {
  const out = git(["tag", "--list", "v*", "--sort=-v:refname"], { allowFail: true });
  return out ? out.split("\n")[0].trim() : null;
}

/** Bump the -beta.N prerelease counter (the brain convention). */
function nextVersion(current) {
  const m = current.match(/^(\d+\.\d+\.\d+)-beta\.(\d+)$/);
  if (m) return `${m[1]}-beta.${Number(m[2]) + 1}`;
  const stable = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (stable) return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}`;
  throw new Error(`can't auto-bump version "${current}" — pass --as <version>`);
}

function computeDelta(sinceRef) {
  const range = sinceRef ? `${sinceRef}..HEAD` : "HEAD";
  const commits = git(["log", range, "--no-merges", "--pretty=%h%x09%s"], { allowFail: true });
  const diffstat = sinceRef
    ? git(["diff", "--shortstat", sinceRef, "HEAD"], { allowFail: true })
    : "";
  return { commits, diffstat };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function requireTTY(what) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `${what} needs an interactive terminal (stdin is not a TTY). ` +
        "Run this directly in your shell, or use --yes with a working `claude -p`."
    );
  }
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

// ---------- changelog formatting ----------

function formatEntry(version, date, changes) {
  const out = [`## [${version}] - ${date}`, ""];
  for (const cat of CATEGORIES) {
    const items = changes[cat];
    if (!items || !items.length) continue;
    out.push(`### ${cat}`, "");
    for (const item of items) out.push(`- ${item}`);
    out.push("");
  }
  return out.join("\n");
}

/** Insert a version block immediately below "## [Unreleased]" (or after the H1). */
function spliceEntry(md, block) {
  const lines = md.split("\n");
  let idx = lines.findIndex((l) => /^##\s+\[unreleased\]/i.test(l));
  if (idx !== -1) {
    // skip the blank line right after the Unreleased header
    let insertAt = idx + 1;
    if (lines[insertAt] === "") insertAt += 1;
    lines.splice(insertAt, 0, block);
    return lines.join("\n");
  }
  idx = lines.findIndex((l) => /^#\s+/.test(l));
  const insertAt = idx === -1 ? 0 : idx + 1;
  lines.splice(insertAt, 0, "", block);
  return lines.join("\n");
}

function renderProposal(version, summary, changes) {
  const lines = [`\n  v${version} — ${summary}\n`];
  for (const cat of CATEGORIES) {
    if (!changes[cat]?.length) continue;
    lines.push(`  ${cat}:`);
    for (const it of changes[cat]) lines.push(`    - ${it.replace(/\*\*/g, "").slice(0, 100)}`);
  }
  return lines.join("\n");
}

function syncWeb() {
  const res = spawnSync("node", [buildChangelogScript], { cwd: repoRoot, encoding: "utf8", stdio: "inherit" });
  if (res.status !== 0) console.warn("! website changelog sync failed (non-fatal)");
}

// ---------- manual fallback + edit ----------

async function manualProposal() {
  requireTTY("manual changelog entry");
  console.log("\nManual changelog entry. Enter items per category; blank line ends a category.");
  const summary = (await ask("Summary (<=80 chars): ")).trim() || "Maintenance release.";
  const changes = {};
  for (const cat of CATEGORIES) {
    const items = [];
    for (;;) {
      const line = (await ask(`  ${cat} item (blank to skip/next): `)).trim();
      if (!line) break;
      items.push(line);
    }
    if (items.length) changes[cat] = items;
  }
  if (!Object.keys(changes).length) changes.Changed = ["**Internal maintenance.** No user-facing changes."];
  return { summary, changes };
}

async function editProposal(proposal) {
  const tmp = join(tmpdir(), `brain-changelog-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify(proposal, null, 2));
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  spawnSync(editor, [tmp], { stdio: "inherit" });
  try {
    return validate(JSON.parse(readFileSync(tmp, "utf8")));
  } catch (e) {
    console.warn(`! edited JSON invalid (${e.message}); keeping previous.`);
    return proposal;
  }
}

// ---------- subcommands ----------

function cmdStatus() {
  const current = readVersion();
  const tag = lastTag();
  const { commits } = computeDelta(tag);
  console.log(`current version : ${current}`);
  console.log(`last release tag: ${tag || "(none)"}`);
  console.log(`next version    : ${nextVersion(current)}`);
  const n = commits ? commits.split("\n").length : 0;
  console.log(`pending commits : ${n}${tag ? ` since ${tag}` : ""}`);
  if (commits) console.log("\n" + commits.split("\n").map((l) => "  " + l).join("\n"));
}

async function cmdGenerate(flags) {
  const current = readVersion();
  const version = flags.as || nextVersion(current);
  const tag = flags.since || lastTag();
  const { commits, diffstat } = computeDelta(tag);

  if (!commits && !flags.skipClaude) {
    console.log(`No commits since ${tag || "start"} — nothing to release.`);
    return;
  }
  console.log(`Releasing ${current} → ${version} (delta since ${tag || "start"}, ${commits ? commits.split("\n").length : 0} commits)`);

  let proposal;
  if (flags.skipClaude) {
    proposal = await manualProposal();
  } else {
    process.stdout.write("Classifying changes with claude… ");
    const result = classifyChanges({ currentVersion: current, nextVersion: version, prevTag: tag, commits, diffstat });
    if (!result.ok) {
      console.log(`failed (${result.error}).`);
      if (flags.yes) {
        throw new Error(
          "classification failed and --yes is set (non-interactive). " +
            "Re-run in a terminal without --yes, or use --skip-claude to enter notes by hand."
        );
      }
      console.log("Falling back to manual entry.");
      proposal = await manualProposal();
    } else {
      console.log("done.");
      proposal = result.proposal;
    }
  }

  // confirm loop
  if (!flags.yes) {
    requireTTY("interactive review");
    for (;;) {
      console.log(renderProposal(version, proposal.summary, proposal.changes));
      const a = (await ask("\n[a]ccept / [e]dit / [r]egenerate / [m]anual / [q]uit: ")).trim().toLowerCase();
      if (a === "a" || a === "") break;
      if (a === "q") { console.log("Aborted."); return; }
      if (a === "e") { proposal = await editProposal(proposal); continue; }
      if (a === "m") { proposal = await manualProposal(); continue; }
      if (a === "r") {
        const result = classifyChanges({ currentVersion: current, nextVersion: version, prevTag: tag, commits, diffstat });
        if (result.ok) proposal = result.proposal;
        else console.log(`regenerate failed (${result.error}); keeping current.`);
        continue;
      }
    }
  }

  const date = today();
  const block = formatEntry(version, date, proposal.changes);

  if (flags.dryRun) {
    console.log("\n--- proposed CHANGELOG.md entry (dry run, nothing written) ---\n");
    console.log(block);
    return;
  }

  writeFileSync(changelogPath, spliceEntry(readFileSync(changelogPath, "utf8"), block));
  writeVersion(version);
  syncWeb();
  console.log(`\nWrote CHANGELOG.md entry, bumped package.json to ${version}, synced website feed.`);

  if (flags.noCommit) {
    console.log("--no-commit: staged nothing. Review, then commit + tag yourself.");
    return;
  }
  git(["add", "CHANGELOG.md", "package.json", "website/public/data/changelog.json"]);
  git(["commit", "-m", `chore(release): cut ${version}\n\n${proposal.summary}`]);
  git(["tag", "-a", `v${version}`, "-m", version]);
  console.log(`Committed and tagged v${version}.`);
  console.log(`Next: review, then publish — npm publish --tag beta && npm dist-tag add brain-memory@${version} latest && git push --follow-tags`);
}

// ---------- arg parsing ----------

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--yes") flags.yes = true;
    else if (a === "--skip-claude") flags.skipClaude = true;
    else if (a === "--no-commit") flags.noCommit = true;
    else if (a === "--since") flags.since = argv[++i];
    else if (a === "--as") flags.as = argv[++i];
  }
  return flags;
}

const argv = process.argv.slice(2);
const hasSub = argv[0] && !argv[0].startsWith("--");
const sub = hasSub ? argv[0] : "generate";
const flagArgs = hasSub ? argv.slice(1) : argv;

try {
  if (sub === "status") cmdStatus();
  else if (sub === "sync-web") syncWeb();
  else if (sub === "generate") await cmdGenerate(parseFlags(flagArgs));
  else {
    console.error(`unknown subcommand: ${sub}\nUsage: release.mjs [generate|status|sync-web] [flags]`);
    process.exit(1);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
