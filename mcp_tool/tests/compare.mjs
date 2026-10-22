// Runs the web editor (html/ore_vfx_editor.html) for real in jsdom and compares its export with the headless core used
// by MCP: same graphs, same order, JSON must match character for character (optimizer off and on).
// The web editor may skip optimization because of its "check would take more than 3 s" rule (it measures real time).
// In that case its result (unoptimized JSON) is compared with the headless result with the optimizer off.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadOre } from '../src/ore-headless.mjs';
import { buildTestGraphs } from './graphs.mjs';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const HTML = fileURLToPath(new URL('../../html/ore_vfx_editor.html', import.meta.url));

export function openPage(file) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.stack || e.message) || e)));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      // Minimal stand-ins for browser features jsdom lacks (drawing output is not compared)
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => k === 'createImageData' || k === 'getImageData'
        ? (a, b) => ({ data: new Uint8ClampedArray(Math.max(1, (a.width || a) * (b || a.height || 1)) * 4) })
        : k === 'canvas' ? {} : () => {}, set: () => true });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.Element.prototype.scrollIntoView = () => {};
      w.confirm = () => true;
    },
  });
  return { dom, errors, w: dom.window };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const pageCompile = (w, graph, opt) => JSON.parse(w.eval(`(function(g,opt){
    state.nodes=g.nodes; state.wires=g.wires; state.nextId=g.nextId;
    _ctxShortMap = new Map();
    OreOpt.on = opt.optimize!==false;
    const r = generateAllParticleJSONs('ore:test');
    return JSON.stringify(r.errors?{errors:r.errors}:{results:r.results.map(x=>({identifier:x.identifier,json:x.json,skipped:!!(x.optStats&&/건너뜀|원본을 유지/.test(x.optStats.msg))}))});
  })(${JSON.stringify(graph)}, ${JSON.stringify(opt)})`));
  const pick = r => r.errors ? { errors: r.errors } : { results: r.results.map(x => ({ identifier: x.identifier, json: x.json })) };

  const ore = loadOre();
  const graphs = buildTestGraphs(ore);
  const page = openPage(HTML);
  console.log('Web editor load errors:', page.errors.length ? page.errors.slice(0, 3) : 'none');

  let bad = 0, n = 0, timing = 0;
  for (const opt of [{ optimize: false }, { optimize: true }]) {
    for (const { name, graph } of graphs) {
      const a = pageCompile(page.w, structuredClone(graph), opt);
      const c = ore.compile(structuredClone(graph), 'ore:test', opt);
      // The web editor skipped optimization because of time (not the 40KB size rule) → its result = the unoptimized result
      const tSkip = opt.optimize && a.results && a.results.some(r => r.skipped && JSON.stringify(r.json).length <= 40000);
      const ref = tSkip ? ore.compile(structuredClone(graph), 'ore:test', { optimize: false }) : c;
      const sa = JSON.stringify(pick(a)), sc = JSON.stringify(pick(ref));
      const ok = sa === sc;
      n++; if (!ok) bad++; if (tSkip) timing++;
      console.log(`${ok ? (tSkip ? 'OK* ' : 'OK  ') : 'DIFF'} opt=${opt.optimize ? 'on ' : 'off'} ${name.padEnd(26)} ${a.errors ? '(error graph)' : a.results.length + ' file(s) ' + sa.length + ' chars'}`);
    }
  }
  if (page.errors.length) console.log('Runtime errors:', page.errors.slice(0, 5));
  console.log(`\n${bad} of ${n} differ${timing ? ` (OK* ${timing}: the web editor skipped optimization for time, compared with optimizer-off results)` : ''}`);
  page.w.close();
  process.exit(bad || page.errors.length ? 1 : 0);
}
