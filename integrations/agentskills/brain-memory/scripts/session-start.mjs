#!/usr/bin/env node
/**
 * Portable session-start helper for the brain-memory Agent Skill.
 *
 * Thin, dependency-free wrapper over the global `brain` CLI so any
 * agentskills.io host can fetch the budget-bounded session payload with one
 * spawn and no knowledge of the CLI's flags. Prints the JSON payload to stdout,
 * or `{}` if the brain isn't installed/initialized yet (never throws — a
 * missing brain must not break a host's session boot).
 *
 * Usage: node session-start.mjs [--project <name>]
 */

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const projectIdx = args.indexOf("--project");
const project = projectIdx !== -1 ? args[projectIdx + 1] : undefined;

const cliArgs = ["session-start"];
if (project) cliArgs.push("--project", project);

const res = spawnSync("brain", cliArgs, {
  encoding: "utf-8",
  env: { ...process.env, BRAIN_AGENT: process.env.BRAIN_AGENT || "agentskills" },
});

if (res.status === 0 && res.stdout) {
  process.stdout.write(res.stdout);
} else {
  // brain not installed, not initialized, or errored — degrade to an empty
  // payload so the host's session start is never blocked.
  process.stdout.write("{}\n");
}
