#!/usr/bin/env node
/* Diagnose the recall-collapse: is the search index fresh, and WHAT outranks the oracle? */
const os = require('os'), fs = require('fs'), path = require('path');
const installer = require('../../src/installer');
const { seedMemories } = require('./seeder');
const { generateDistractors, generateHardNegatives } = require('./distractors');
const { recall } = require('./recall-probe');
const { pinMemory } = require('../../src/pinning');

const SETUP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scenarios', 'scenario-A-noisy-folder', 'setup.json'), 'utf-8'));

async function main() {
  const size = parseInt(process.argv[2] || '2000', 10);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-dbg-'));
  try {
    installer.initializeBrain(home);
    const oracle = SETUP.memories;
    const all = [...oracle, ...generateDistractors(size, 42), ...generateHardNegatives(oracle, SETUP.hard_negatives || 6, 43)];
    seedMemories(home, all, { associations: SETUP.associations || [], context: SETUP.context || null });
    for (const m of oracle.filter((m) => m.pin === true)) pinMemory(home, m.id, { scope: m.pin_scope || 'global', priority: m.pin_priority || 5 });

    const brainDir = path.join(home, '.brain');
    const idxCount = Object.keys(JSON.parse(fs.readFileSync(path.join(brainDir, 'index.json'), 'utf-8')).memories).length;
    const siPath = path.join(brainDir, 'search-index.json');
    const siDocs = (p) => { if (!fs.existsSync(p)) return 'absent'; const si = JSON.parse(fs.readFileSync(p, 'utf-8')); return si.doc_count != null ? si.doc_count : Object.keys(si.documents || {}).length; };
    console.log(`corpus=${all.length} indexMemories=${idxCount} searchIndexDocs(before recall)=${siDocs(siPath)}`);

    const ctx = SETUP.context;
    const ranked = await recall({ homeDir: home, query: SETUP.recall_query, project: ctx.project, topics: (ctx.topics || []).join(','), task: ctx.task_type, top: 20 });
    console.log(`searchIndexDocs(after recall)=${siDocs(siPath)}`);

    const oset = new Set(SETUP.oracle_memory_ids);
    console.log('\nTop 20 recall (★=oracle, ⚠=hardneg):');
    ranked.forEach((r, i) => {
      const tag = oset.has(r.id) ? '★' : String(r.id).startsWith('mem_hardneg') ? '⚠' : ' ';
      console.log(`${String(i + 1).padStart(2)} ${tag} ${r.score != null ? r.score.toFixed(3) : 'null'}  ${r.id}  [${r.type}]`);
    });
    const ids = ranked.map((r) => r.id);
    console.log('\noracle ranks:', SETUP.oracle_memory_ids.map((id) => { const i = ids.indexOf(id); return `${id}:${i === -1 ? '>20' : i + 1}`; }).join('  '));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
