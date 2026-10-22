// English check for compiler/checker messages: builds deliberately broken graphs to get real messages, then checks
// that no Korean is left after translation (MCP and the web editor's English mode share the same table).
import { loadOre } from '../src/ore-headless.mjs';
import { buildTestGraphs } from './graphs.mjs';
const ore = loadOre();
const KO = /[\uac00-\ud7a3]/;
const G = () => ({ nodes: {}, wires: {}, nextId: 1 });
const add = (g, type, data = {}) => { const r = ore.createNode(g, type, 0, 0); Object.assign(g, r.graph); Object.assign(g.nodes[r.id].data, data); if (type === 'wall') Object.assign(g, ore.wallEnsure(g, r.id)); return r.id; };
const con = (g, a, as, b, bs) => { const r = ore.createWire(g, a, as, b, bs); Object.assign(g, r.graph); };
const basic = (g, emData = {}, shData = {}) => {
  const em = add(g, 'emitter', emData), sh = add(g, 'shape', Object.assign({ exprX: 'j/n', exprY: '0', exprZ: '0' }, shData)), out = add(g, 'output');
  ['j', 'n', 'h', 'seed'].forEach(k => con(g, em, k, sh, k)); ['x', 'y', 'z'].forEach(k => con(g, sh, k, out, 'off' + k));
  return { em, sh, out };
};
const cases = {
  'no emitter': G(),
  'no output': (() => { const g = G(); add(g, 'emitter'); return g; })(),
  'shape formula': (() => { const g = G(); basic(g, {}, { exprX: '1+(' }); return g; })(),
  'unknown function': (() => { const g = G(); basic(g, {}, { exprX: 'foo(j)' }); return g; })(),
  'math formula': (() => { const g = G(); const { sh, out } = basic(g); const m = add(g, 'math', { expr: 'a+*2' }); con(g, sh, 'x', m, 'a'); con(g, m, 'out', out, 'r'); return g; })(),
  'bad identifier': (() => { const g = G(); basic(g, { particleId: 'Bad Name!' }); return g; })(),
  'reserved var': (() => { const g = G(); const { out } = basic(g); const c = add(g, 'constant', { value: 'v.seed' }); con(g, c, 'out', out, 'r'); return g; })(),
  'internal var clash': (() => { const g = G(); const { out } = basic(g); const c = add(g, 'constant', { value: 'v.ore_rot' }); con(g, c, 'out', out, 'r'); return g; })(),
  'contour no image': (() => { const g = G(); const em = add(g, 'emitter'), ic = add(g, 'shape_image_contour'), out = add(g, 'output'); ['j', 'n', 'h', 'seed'].forEach(k => con(g, em, k, ic, k)); ['x', 'y', 'z'].forEach(k => con(g, ic, k, out, 'off' + k)); return g; })(),
  'vecfield no image': (() => { const g = G(); const { sh, out } = basic(g); const v = add(g, 'vecfield_image'); con(g, sh, 'x', v, 'x'); con(g, v, 'fx', out, 'r'); return g; })(),
  'direction needed': (() => { const g = G(); basic(g, { facingMode: 'lookat_direction' }); return g; })(),
  'custom direction': (() => { const g = G(); basic(g, { billboardDirMode: 'custom' }); return g; })(),
  'acc timesource': (() => { const g = G(); const { sh, out } = basic(g); const a = add(g, 'accumulate', { timeSource: 'particle_age' }), b = add(g, 'accumulate', { timeSource: 'emitter_age' });
    con(g, sh, 'x', a, 'init'); con(g, a, 'out', b, 'in'); con(g, b, 'out', a, 'in'); con(g, a, 'out', out, 'offx'); return g; })(),
  'sub emitter bone': (() => { const g = G(); const { em } = basic(g); const ev = add(g, 'event', { bindToBone: true }), sub = add(g, 'sub_emitter'), ssh = add(g, 'shape', { exprX: '0', exprY: '0', exprZ: '0' }), so = add(g, 'output');
    ['j', 'n', 'h', 'seed'].forEach(k => con(g, sub, k, ssh, k)); ['x', 'y', 'z'].forEach(k => con(g, ssh, k, so, 'off' + k)); con(g, em, 'bone', ev, 'trigger'); con(g, ev, 'fire', sub, 'trigger'); return g; })(),
};
const msgs = new Set();
for (const [name, g] of Object.entries(cases)) {
  const r = ore.compile(g, 'ore:t', { optimize: true });
  (r.errors || []).forEach(m => msgs.add(m));
  (r.results || []).forEach(x => { if (x.optStats) msgs.add(x.optStats); ore.validateJson(x.json, r.userVars).forEach(([, m]) => msgs.add(m)); });
}
for (const { graph } of buildTestGraphs(ore)) {
  const r = ore.compile(graph, 'ore:t', { optimize: true });
  (r.errors || []).forEach(m => msgs.add(m));
  (r.results || []).forEach(x => { if (x.optStats) msgs.add(x.optStats); ore.validateJson(x.json, r.userVars).forEach(([, m]) => msgs.add(m)); });
}
for (const e of ['1+(', 'foo(1)', 'a+*2', '', '1)', '#']) { try { ore.compileFormula(e, { a: '0' }); } catch (err) { msgs.add(err.message); } }
// Text the 3D preview shows as one block: icons in front, several lines
msgs.add('✔ 검사 통과: 구조·Molang 문법·변수·평가값 이상 없음');
msgs.add('✔ ⚡ 연산 노드 755→670 (11% 감소) · 글자수 3694→3084 · 평가시간 17.6→18.1ms · 최대오차 3.3e-16 · 식검증 14/15 (원본유지 1)');
msgs.add('  나이 1.300s  생존\n위치 0.100, 0.200, 0.300\n방향 0.000, 1.000, 0.000\n크기 0.200, 0.200\n색상 1.000, 0.500, 0.200, 1.000\nUV 0, 0, 1, 1\nv.seed = 42.0000');
let bad = 0;
const korean = [...msgs].filter(m => KO.test(m));
for (const m of korean) {
  const t = ore.t(m);
  const ok = !KO.test(t);
  if (!ok) bad++;
  if (!ok || process.argv.includes('--list')) console.log((ok ? 'OK  ' : 'KO  ') + m.slice(0, 140) + '\n      → ' + t.slice(0, 160));
}
console.log(`${msgs.size} messages, ${korean.length} in Korean source form · not fully translated: ${bad}`);
process.exit(bad ? 1 : 0);
