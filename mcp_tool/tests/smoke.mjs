import { loadOre } from '../src/ore-headless.mjs';
import { buildTestGraphs } from './graphs.mjs';
const ore = loadOre();
const gs = buildTestGraphs(ore);
for (const { name, graph } of gs) {
  const t0 = Date.now();
  const r = ore.compile(graph, 'ore:test');
  console.log(name.padEnd(28), r.errors ? 'ERR ' + r.errors.join(' | ') : `${r.results.length} files, ${JSON.stringify(r.results.map(x=>x.json)).length} chars, ${Date.now()-t0}ms  ${r.results.map(x=>x.optStats||'').join(' / ').slice(0,90)}`);
}
