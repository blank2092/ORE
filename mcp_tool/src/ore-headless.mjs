// ORE headless loader: runs core/ore-core.js (the calculation part extracted from the web editor HTML) in Node,
// without a screen. It is the same code as the web editor, so results are the same.
// The core is a classic browser script, so it runs in its own vm context (separate globals).
// Values always cross the boundary as JSON strings (arrays/objects from another context behave differently).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CORE = path.resolve(HERE, '../core/ore-core.js');

// Helper code that runs inside the context. Graphs arrive as JSON and are plugged into state with OreCore.withGraph.
const BRIDGE = String.raw`
globalThis.__oreBridge = {
  call(name, argsJson){
    const a = JSON.parse(argsJson);
    const r = this[name](...a);
    return r === undefined ? 'null' : JSON.stringify(r);
  },
  compile(graph, id, opt){
    opt = opt || {};
    const prevOn = OreOpt.on, prevLv = OreOpt.level;
    OreOpt.on = opt.optimize !== false;
    if (opt.level) OreOpt.level = opt.level;
    try{
      return OreCore.withGraph(graph, ()=>{
        if (opt.resetNaming !== false) OreCore.resetNaming();
        const r = OreCore.compile(id);
        if (!r || r.errors) return { errors: (r && r.errors) || ['Unknown error'] };
        return { results: r.results.map(x=>({ identifier:x.identifier, nodeId:x.nodeId, isSub:!!x.isSub, isSplit:!!x.isSplit,
          splitOf:x.splitOf||null, optStats:x.optStats?x.optStats.msg:null, json:x.json })), userVars: globalThis.__oreUserVarVals || {} };
      });
    } finally { OreOpt.on = prevOn; OreOpt.level = prevLv; }
  },
  validateJson(json, userVars){
    const prev = globalThis.__oreUserVarVals; globalThis.__oreUserVarVals = userVars || prev;
    try{ return OreSim.validate(json); } finally { globalThis.__oreUserVarVals = prev; }
  },
  // Runs a particle effect JSON directly and samples the particles at the given times (same simulator as the 3D preview).
  simulate(json, times, maxParticles, userVars){
    const prev = globalThis.__oreUserVarVals; globalThis.__oreUserVarVals = userVars || prev;
    try{
      const S = OreSim.build(json);
      return times.map(t=>{
        const ps = OreSim.evalAt(S, t);
        const alive = ps.filter(p=>p.alive), errs = ps.filter(p=>p.err);
        const r6 = v=>Math.round(v*1e4)/1e4;
        let mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity], sum=[0,0,0];
        alive.forEach(p=>{ for(let k=0;k<3;k++){ const v=p.pos[k]; if(v<mn[k])mn[k]=v; if(v>mx[k])mx[k]=v; sum[k]+=v; } });
        const step = Math.max(1, Math.ceil(alive.length / Math.max(1, maxParticles)));
        return {
          t, total: ps.length, alive: alive.length,
          errors: [...new Set(errs.map(p=>p.err))].slice(0,5),
          bounds: alive.length ? { min: mn.map(r6), max: mx.map(r6), center: sum.map(v=>r6(v/alive.length)) } : null,
          sample: alive.filter((_,i)=>i%step===0).slice(0, maxParticles).map(p=>({ i:p.i, pos:p.pos.map(r6), size:(p.size||[]).map(r6), color:(p.col||[]).map(r6), ...(typeof p.rot==='number' ? { rot:r6(p.rot) } : {}) })),
        };
      });
    } finally { globalThis.__oreUserVarVals = prev; }
  },
  translate(t){ return OreCore.translate(t); },
  // Node definitions and presets carry display text (socket labels…) in Korean source form — translate it (values and keys stay the same)
  nodeTypes(){ const T = OreCore.translate, o = {};
    for (const [k, d] of Object.entries(OreCore.NODE_DEFS)) o[k] = { ...d, label: T(d.label),
      inputs: (d.inputs || []).map(x => ({ ...x, label: T(x.label) })), outputs: (d.outputs || []).map(x => ({ ...x, label: T(x.label) })) };
    return o; },
  shapePresets(){ const T = OreCore.translate; return OreCore.SHAPE_PRESETS.map(p => ({ ...p, name: T(p.name), desc: T(p.desc) })); },
  detailInputs(){ return OreCore.DETAIL_INPUTS; },
  // Graph editing helpers: create a node (with defaults and automatic wall names), connect (one wire per input), check for cycles
  createNode(graph, type, x, y){ let id; OreCore.withGraph(graph, ()=>{ id = OreCore.createNode(type, x, y).id; }); return { graph, id }; },
  createWire(graph, a, as, b, bs){ let id; OreCore.withGraph(graph, ()=>{ id = OreCore.createWire(a, as, b, bs); }); return { graph, id }; },
  wallEnsure(graph, id){ OreCore.withGraph(graph, ()=>OreCore.wallEnsure(graph.nodes[id])); return graph; },
  allInputs(graph, id){ return OreCore.withGraph(graph, ()=>{ const n = graph.nodes[id]; return OreCore.nodeAllInputs(n.type, n).map(x => ({ ...x, label: OreCore.translate(x.label) })); }); },
  checkCycles(graph){ return OreCore.withGraph(graph, ()=>OreCore.validateNoCycles()); },
  normId(raw){ return OreCore.normParticleId(raw, 'ore:x'); },
  compileFormula(expr, vars){ return OreCore.compileFormula(expr, vars || {}); },
  substPreset(id){ const p = OreCore.SHAPE_PRESETS.find(q=>q.id===id); if(!p) return null;
    return { x:OreCore.substParams(p.x,p.params||{}), y:OreCore.substParams(p.y,p.params||{}), z:OreCore.substParams(p.z,p.params||{}) }; },
  efdFromPolylines(polys, order, res){
    // Builds an Image Contour node's efdList from outline point lists (same format as the web editor's bake result).
    const K = 120;
    const blobs = polys.map(p=>{ const rs = OreCore.resampleClosedPolyline(p, K); const efd = OreCore.ellipticFourierDescriptors(rs, order); return { efd, perimeter: efd.perimeter, resampled: rs }; });
    const tot = blobs.reduce((s,b)=>s+b.perimeter,0) || 1; let cum = 0;
    blobs.forEach(b=>{ b.weight=b.perimeter/tot; b.cumStart=cum; cum+=b.weight; b.cumEnd=cum; });
    blobs[blobs.length-1].cumEnd = 1;
    return blobs.map(b=>({ efd:b.efd, weight:b.weight, cumStart:b.cumStart, cumEnd:b.cumEnd, perimeter:b.perimeter }));
  },
  fitFourier(grid, res, terms){ return { fx: OreCore.fitFourier2D(grid, res, 0, terms), fy: OreCore.fitFourier2D(grid, res, 1, terms) }; },
};`;

export function loadOre({ coreFile = DEFAULT_CORE } = {}) {
  const ctx = vm.createContext({
    console, performance, TextEncoder, TextDecoder, Blob, atob, btoa, crypto, URL, structuredClone,
  });
  vm.runInContext(fs.readFileSync(coreFile, 'utf8'), ctx, { filename: coreFile });
  vm.runInContext(BRIDGE, ctx, { filename: 'ore-bridge.js' });
  // Turn off the time-based "skip optimization" rule so the same graph always gives the same file (the 40KB size rule still applies)
  vm.runInContext('OreOpt.maxEstMs = Infinity;', ctx);
  const bridge = ctx.__oreBridge;
  const call = (name, ...args) => JSON.parse(bridge.call(name, JSON.stringify(args)));
  return {
    version: vm.runInContext('OreCore.version', ctx),
    compile: (graph, id = 'ore:my_vfx', opt = {}) => call('compile', graph, id, opt),
    validateJson: (json, userVars) => call('validateJson', json, userVars),
    simulate: (json, times, maxParticles = 20, userVars) => call('simulate', json, times, maxParticles, userVars),
    nodeTypes: () => call('nodeTypes'),
    shapePresets: () => call('shapePresets'),
    detailInputs: () => call('detailInputs'),
    createNode: (graph, type, x = 0, y = 0) => call('createNode', graph, type, x, y),
    createWire: (graph, a, as, b, bs) => call('createWire', graph, a, as, b, bs),
    wallEnsure: (graph, id) => call('wallEnsure', graph, id),
    allInputs: (graph, id) => call('allInputs', graph, id),
    checkCycles: (graph) => call('checkCycles', graph),
    compileFormula: (expr, vars) => call('compileFormula', expr, vars),
    // English text for display (errors, check messages…) — unchanged if there is no translation
    t: (text) => call('translate', String(text)),
    _normId: (raw) => call('normId', raw),
    substPreset: (id) => call('substPreset', id),
    efdFromPolylines: (polys, order = 10, res = 128) => call('efdFromPolylines', polys, order, res),
    fitFourier: (grid, res, terms = 8) => call('fitFourier', grid, res, terms),
    // Build .mcpack (zip) bytes with the web editor's own zip function
    async zip(files) {
      const enc = JSON.stringify(files.map(f => f.bin ? { name: f.name, b64: Buffer.from(f.bin).toString('base64') } : f));
      const blob = vm.runInContext(`(function(fs){ fs=JSON.parse(fs).map(f=>f.b64?{name:f.name,bin:Uint8Array.from(atob(f.b64),c=>c.charCodeAt(0))}:f); return OreSim.zip(fs); })`, ctx)(enc);
      return Buffer.from(await blob.arrayBuffer());
    },
    _ctx: ctx,
  };
}
