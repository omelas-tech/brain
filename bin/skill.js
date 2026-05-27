#!/usr/bin/env node

/**
 * brain skill — manage procedural skills (CoALA Phase 2).
 *
 * Usage:
 *   brain skill list                    Advertised index (name + description)
 *   brain skill show <name>             Full SKILL.md (L1 disclosure)
 *   brain skill use <name> [--failed]   Record a use; success strengthens,
 *                                       --failed weakens (demotion feedback)
 *   brain skill remove <name>           Delete a skill
 *   brain skill add                     Create a skill from JSON on stdin:
 *                                       { name, description, triggers[], body }
 */

const fs = require('fs');
const {
  addSkill, listSkills, showSkill, useSkill, removeSkill,
} = require('../src/skills');

function emit(obj) { console.log(JSON.stringify(obj, null, 2)); }
function fail(obj) { console.error(JSON.stringify(obj)); process.exit(1); }
function done(result) { return result && result.error ? fail(result) : emit(result); }

const USAGE = 'Usage: brain skill <list|show <name>|use <name> [--failed]|add|remove <name>>';

function main(argv) {
  const args = argv || process.argv.slice(2);
  const action = args[0];
  const rest = args.slice(1);
  const firstName = rest.find((a) => !a.startsWith('--'));

  switch (action) {
    case 'list':
      return emit(listSkills(undefined));
    case 'show':
      if (!firstName) return fail({ error: USAGE });
      return done(showSkill(undefined, firstName));
    case 'use':
      if (!firstName) return fail({ error: USAGE });
      return done(useSkill(undefined, firstName, { failed: rest.includes('--failed') }));
    case 'remove':
      if (!firstName) return fail({ error: USAGE });
      return done(removeSkill(undefined, firstName));
    case 'add': {
      if (process.stdin.isTTY) return fail({ error: 'Pipe a skill JSON via stdin' });
      let input;
      try { input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8')); }
      catch (e) { return fail({ error: `Invalid JSON: ${e.message}` }); }
      return done(addSkill(undefined, input));
    }
    default:
      return fail({ error: USAGE });
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main };
