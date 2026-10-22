// ORE MCP — graph storage and editing rules.
// The AI changes graphs only through the functions in this file. There is deliberately no way to edit the
// exported JSON (Molang) directly. Graphs use the same format as the web editor's 💾 save file:
// { nodes, wires, nextId, scale, panX, panY, pack }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOre } from './ore-headless.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ore = loadOre();
export const NODE_DEFS = ore.nodeTypes();
export const DETAIL_INPUTS = ore.detailInputs();
export const SHAPE_PRESETS = ore.shapePresets();
export const WORKDIR = path.resolve(process.env.ORE_WORKDIR || process.cwd());
export const ALLOW_RAW_MOLANG = process.env.ORE_ALLOW_RAW_MOLANG === '1';

// Node descriptions: the web editor's palette text, extracted (in English) by `npm run sync` into core/node-descriptions.json.
export const NODE_DESC = (() => {
  let out = {};
  try { out = JSON.parse(fs.readFileSync(path.resolve(HERE, '../core/node-descriptions.json'), 'utf8')); }
  catch { /* descriptions are optional */ }
  out.shape = { name: 'Shape', desc: 'Where particles are placed. Three formulas compute x/y/z from j (particle index), n (count), h (height) and seed. Start from a preset, then edit the formulas.' };
  return out;
})();

// Allowed values for choice fields (same lists as the web editor's drop-downs)
const TS = ['emitter_age', 'particle_age'];
export const ENUMS = {
  emitter: { material: ['particles_alpha', 'particles_blend', 'particles_add'],
    facingMode: ['rotate_xyz', 'rotate_y', 'lookat_xyz', 'lookat_y', 'lookat_direction', 'direction_x', 'direction_y', 'direction_z', 'emitter_transform_xy', 'emitter_transform_xz', 'emitter_transform_yz'],
    billboardDirMode: ['none', 'derive_from_velocity', 'custom'], emitMode: ['burst', 'steady'] },
  event: { condition: ['creation', 'expiration', 'timeline'] },
  particle_event: { condition: ['creation', 'expiration', 'timeline'], spawnType: ['emitter', 'emitter_bound'] },
  shape_image_contour: { traceMode: ['luminance', 'alpha', 'redchan', 'greenchan', 'bluechan'] },
  noise3d: { noiseType: ['perlin', 'simplex', 'voronoi', 'fbm'] },
  curlnoise: { flowTimeSource: TS }, curlturb: { flowTimeSource: TS },
  vortexfield: { pulseTimeSource: TS }, attractorfield: { pulseTimeSource: TS, falloffMode: ['linear', 'inverse'] },
  directionalfield: { gustTimeSource: TS }, windzone: { gustTimeSource: TS, shape: ['box', 'sphere'] },
  wall: { collisionMode: ['auto', 'nearest', 'origin'] },
  buoyancyfield: { timeSource: TS }, dissipationfield: { timeSource: TS, emitterMode: ['once', 'loop'] },
  accumulate: { mode: ['integrate', 'perframe'], limitMode: ['none', 'clamp', 'wrap'], timeSource: ['particle_age', 'emitter_age'], stepDist: ['auto', 'grid', 'end', 'uniform'] },
  vecfield_image: { mode: ['gradient', 'contour', 'flowmap'], exportMode: ['fourier', 'lookup'] },
  math: { timeSource: TS }, curve: { timeSource: TS, emitterMode: ['loop', 'once'] },
  flipbook: { timeSource: TS, loopMode: ['loop', 'once', 'pingpong'] },
};
ENUMS.sub_emitter = ENUMS.emitter;

// Formula fields and the variables they may use
export const FORMULA_FIELDS = {
  shape: { exprX: ['j', 'n', 'h', 'seed'], exprY: ['j', 'n', 'h', 'seed'], exprZ: ['j', 'n', 'h', 'seed'] },
  math: { expr: ['a', 'b', 'c', 'd', 't', 'dt'] },
  shape_image_contour: { yExpr: ['j', 'n', 'h', 'seed'] },
};
const BUILTIN_VARS = ['pa', 'ea', 'pr', 'pr1', 'pr2', 'pr3', 'pr4', 'er', 'er1', 'er2', 'er3', 'er4', 'pl', 'el'];
const FUNCS = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'sqrt', 'pow', 'floor', 'trunc', 'ceil', 'round', 'lerp', 'min', 'max', 'clamp', 'random', 'hermite', 'mod', 'ln', 'exp'];
export const FORMULA_HELP = `Formula syntax: + - * / ^ ( ), functions ${FUNCS.join(' ')} (trig functions use degrees).
Built-in variables: pa = particle age (s), ea = emitter age (s), pr/pr1–pr4 = per-particle random (0–1), er/er1–er4 = per-emitter random, pl = particle lifetime, el = emitter lifetime.`;

// Fields that can only be produced with a screen (image bake results) — never written through MCP
const LOCKED = new Set(['imageDataUrl', 'efd', 'efdList', 'tracedPreview', 'contourError', 'generatedExprX', 'generatedExprZ',
  'bakedGrid', 'fourierCoeffs', 'texImg', 'texPng']);

// ------------------------------------------------------------------ open graphs
const graphs = new Map(); // name -> { graph, file, autoPlaced:Set }
const clone = o => JSON.parse(JSON.stringify(o));
const safeName = s => String(s || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);

export function uniqueName(base) {
  let b = safeName(base) || 'my_vfx', n = b, i = 2;
  while (graphs.has(n)) n = `${b}_${i++}`;
  return n;
}
export function listGraphs() {
  return [...graphs.entries()].map(([name, g]) => ({ name, file: g.file || null, nodes: Object.keys(g.graph.nodes).length, wires: Object.keys(g.graph.wires).length }));
}
export function getEntry(name) {
  const e = graphs.get(name);
  if (!e) {
    const names = [...graphs.keys()];
    throw new Error(`No open graph named "${name}". ${names.length ? 'Open graphs: ' + names.join(', ') : 'Create or open one first with ore_new_graph or ore_open_graph.'}`);
  }
  return e;
}
const G = name => getEntry(name).graph;
function getNode(graph, id) {
  const n = graph.nodes[id];
  if (!n) throw new Error(`No node "${id}". Use ore_get_graph to see the node ids.`);
  return n;
}

export function newGraph(name, template = 'empty') {
  const n = uniqueName(name);
  const graph = { nodes: {}, wires: {}, nextId: 1, scale: 0.55, panX: 20, panY: 90, pack: { name: '', desc: '', icon: '' } };
  graphs.set(n, { graph, file: null, autoPlaced: new Set() });
  if (template === 'basic') {
    // The minimal setup: Emitter → Shape (spiral) → Output
    const em = addNode(n, 'emitter', {}, { x: 40, y: 40 }).id;
    const sh = addNode(n, 'shape', {}, { x: 340, y: 40, shapePreset: 'spiral' }).id;
    const out = addNode(n, 'output', {}, { x: 640, y: 40 }).id;
    ['j', 'n', 'h', 'seed'].forEach(k => connect(n, em, k, sh, k));
    ['x', 'y', 'z'].forEach(k => connect(n, sh, k, out, 'off' + k));
  }
  return n;
}
export function closeGraph(name) { getEntry(name); graphs.delete(name); }

// ------------------------------------------------------------------ files (inside the work folder only)
export function resolvePath(p) {
  const abs = path.resolve(WORKDIR, p);
  const rel = path.relative(WORKDIR, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Paths outside the work folder (${WORKDIR}) are not allowed: ${p}. Use a path relative to the work folder, or change the work folder with the ORE_WORKDIR environment variable.`);
  return abs;
}
const isGraphLike = o => o && typeof o.nodes === 'object' && typeof o.wires === 'object';
export function openGraphFile(file) {
  const abs = resolvePath(file);
  let snap;
  try { snap = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { throw new Error(`Could not read the file (${e.code === 'ENOENT' ? 'file not found' : 'not valid JSON'}): ${file}. It must be a .txt file saved with the web editor's 💾 button.`); }
  if (!isGraphLike(snap) && !Array.isArray(snap.tabs)) throw new Error('This is not an ORE progress file (no nodes/wires).');
  const tabs = Array.isArray(snap.tabs) && snap.tabs.length ? snap.tabs : [{ name: snap.tabName || path.basename(file).replace(/\.[^.]+$/, ''), ...snap }];
  return tabs.map(t => {
    const n = uniqueName(t.name || 'my_vfx');
    graphs.set(n, { graph: { nodes: t.nodes || {}, wires: t.wires || {}, nextId: t.nextId || 1, scale: num(t.scale, 1), panX: num(t.panX, -300), panY: num(t.panY, -80), pack: t.pack || { name: '', desc: '', icon: '' } }, file, autoPlaced: new Set() });
    return n;
  });
}
const num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
// Saves in the format the web editor reads. One graph = "single tab" format (loading it in the web editor adds a new tab);
// several graphs = a tab bundle (loading it replaces the open tabs with the file's tabs).
export function saveGraphs(names, file, overwrite) {
  const abs = resolvePath(file);
  if (fs.existsSync(abs) && !overwrite) throw new Error(`The file already exists: ${file}. Call again with overwrite=true to replace it.`);
  names.forEach(n => layoutAuto(n));
  const tab = n => { const g = G(n); return { name: n, nodes: g.nodes, wires: g.wires, nextId: g.nextId, scale: g.scale, panX: g.panX, panY: g.panY, pack: g.pack }; };
  const first = tab(names[0]);
  const snap = { __ore_progress_backup: true, savedAt: new Date().toISOString(), nodes: first.nodes, wires: first.wires, nextId: first.nextId,
    scale: first.scale, panX: first.panX, panY: first.panY, pack: first.pack, tabName: names[0],
    ...(names.length === 1 ? { __ore_single_tab: true } : { tabs: names.map(tab), activeTab: 0 }) };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(snap, null, 2));
  names.forEach(n => { getEntry(n).file = file; });
  return abs;
}

// ------------------------------------------------------------------ value checks
function unknownIdents(expr, allowed) {
  const ids = [...String(expr).matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b(?!\s*\()/g)].map(m => m[0].toLowerCase());
  return [...new Set(ids.filter(i => !allowed.includes(i) && !BUILTIN_VARS.includes(i) && !FUNCS.includes(i)))];
}
function checkFormula(type, key, value, warnings) {
  const allowed = FORMULA_FIELDS[type][key];
  const vars = Object.fromEntries(allowed.map(v => [v, '0']));
  try { ore.compileFormula(String(value), vars); }
  catch (e) { throw new Error(`${key} formula error: ${ore.t(e.message)}. Allowed variables: ${allowed.join(', ')}. ${FORMULA_HELP}`); }
  const unk = unknownIdents(value, allowed);
  if (unk.length) warnings.push(`${key}: ${unk.join(', ')} is not a known variable, so it becomes a Molang variable (v.${unk[0]} …) that is 0 unless the game sets it.`);
}
function coerce(type, key, value, def) {
  const enums = (ENUMS[type] || {})[key];
  if (enums) {
    if (!enums.includes(value)) throw new Error(`${key} must be one of ${enums.join(' | ')} (got ${JSON.stringify(value)}).`);
    return value;
  }
  if (typeof def === 'number') {
    const v = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${key} must be a number (got ${JSON.stringify(value)}).`);
    return v;
  }
  if (typeof def === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${key} must be true or false.`);
    return value;
  }
  if (typeof def === 'string') {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${key} must be a string.`);
    return String(value);
  }
  return value;
}
function checkStops(stops) {
  if (!Array.isArray(stops) || stops.length < 2) throw new Error('stops must be an array of at least 2 color stops, e.g. [{"pos":0,"color":"#ff9d4d"},{"pos":1,"color":"#3d1aff"}]');
  return stops.map((s, i) => {
    const pos = Number(s && s.pos), color = String(s && s.color || '');
    if (!(pos >= 0 && pos <= 1)) throw new Error(`stops[${i}].pos must be a number from 0 to 1.`);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`stops[${i}].color must be in #rrggbb format.`);
    return { pos, color: color.toLowerCase() };
  }).sort((a, b) => a.pos - b.pos);
}
function checkPoints(points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('points must be an array of at least 2 points, e.g. [{"x":0,"y":0},{"x":1,"y":1}] (x and y from 0 to 1)');
  return points.map((p, i) => {
    const x = Number(p && p.x), y = Number(p && p.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new Error(`points[${i}] x and y must be numbers from 0 to 1.`);
    return { x, y };
  });
}
const WALL_KEYS = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ', 'friction', 'bounce', 'reboundLimit'];
function checkWalls(node, walls) {
  if (!Array.isArray(walls)) throw new Error('walls must be an array, e.g. [{"minX":2,"maxX":3,"minY":-3,"maxY":3,"minZ":-3,"maxZ":3,"friction":0.2,"bounce":0.8}]');
  const cur = node.data.walls || [];
  return walls.map((w, i) => {
    const o = Object.assign({}, cur[i] || {});
    for (const [k, v] of Object.entries(w || {})) {
      if (k === 'name') continue; // wall names are automatic (kept unique)
      if (!WALL_KEYS.includes(k)) throw new Error(`walls[${i}].${k} is not a wall field. Fields: ${WALL_KEYS.join(', ')}`);
      if (typeof v !== 'number' || !isFinite(v)) throw new Error(`walls[${i}].${k} must be a number.`);
      o[k] = v;
    }
    return o;
  });
}

// Applies params to a node. Any bad key/value throws and changes nothing (all or nothing).
function applyParams(graphName, node, params, warnings) {
  const type = node.type, defs = NODE_DEFS[type].defaults, next = clone(node.data);
  for (const [key, raw] of Object.entries(params || {})) {
    if (LOCKED.has(key)) throw new Error(`${key} is the result of image processing and can't be changed through MCP. Do image work in the web editor${key.startsWith('tex') ? ' (for a particle texture use ore_set_texture)' : ''}.`);
    if (key === 'preset') throw new Error('Set a shape preset with the shape_preset argument.');
    if (!(key in defs)) throw new Error(`A ${type} node has no "${key}" field. Fields: ${Object.keys(defs).filter(k => !LOCKED.has(k) && k !== 'preset').join(', ')}`);
    let v;
    if (type === 'gradient' && key === 'stops') v = checkStops(raw);
    else if (type === 'curve' && key === 'points') v = checkPoints(raw);
    else if (type === 'wall' && key === 'walls') v = checkWalls(node, raw);
    else v = coerce(type, key, raw, defs[key]);
    if (FORMULA_FIELDS[type] && FORMULA_FIELDS[type][key]) checkFormula(type, key, v, warnings);
    if (type === 'particle_event' && key === 'expr' && String(v).trim() && !ALLOW_RAW_MOLANG)
      throw new Error('particle_event expr puts Molang into the JSON without any checks, so it is blocked in MCP. If you really need it, type it in the web editor, or run the server with ORE_ALLOW_RAW_MOLANG=1.');
    if ((type === 'emitter' || type === 'sub_emitter') && key === 'particleId' && String(v).trim()) {
      const r = ore._normId(String(v));
      if (r && r.error) throw new Error(`particleId: ${ore.t(r.error)}`);
    }
    if (type === 'constant' && key === 'value') {
      const s = String(v).trim(), m = /^(?:v|variable)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(s);
      if (m) { if (/^(n|h|j|i|seed|fri|kill|parent_[xyz]|particle_age|particle_lifetime|particle_random_[1-4]|emitter_age|emitter_lifetime|emitter_random_[1-4])$/.test(m[1])) throw new Error(`v.${m[1]} is a reserved name. Use something like v.my_${m[1]}`); }
      else if (!isFinite(Number(s))) throw new Error('A constant value must be a number or v.name (a variable the game sets).');
      else v = Number(s);
    }
    next[key] = v;
  }
  if (type === 'emitter' || type === 'sub_emitter') {
    if (next.count !== undefined) next.count = Math.max(1, Math.round(next.count));
    if (next.lsRotation) next.lsPosition = true; // same rule as the web editor: rotation needs position
  }
  if (type === 'accumulate' && params && 'samples' in params) next.samples = Math.max(1, Math.min(32, Math.round(next.samples)));
  node.data = next;
  if (type === 'wall') { const g = G(graphName); Object.assign(g, ore.wallEnsure(g, node.id)); }
}

// ------------------------------------------------------------------ editing
export function addNode(graphName, type, params = {}, opt = {}) {
  const g = G(graphName), warnings = [];
  if (!NODE_DEFS[type]) throw new Error(`Unknown node type: ${type}. See ore_list_node_types for the types.`);
  if (type === 'emitter' && Object.values(g.nodes).some(n => n.type === 'emitter'))
    throw new Error('A graph can have only one Emitter. Make extra particles with sub_emitter + event.');
  const hasPos = typeof opt.x === 'number' && typeof opt.y === 'number';
  const r = ore.createNode(g, type, hasPos ? opt.x : 0, hasPos ? opt.y : 0);
  Object.assign(g, r.graph);
  const node = g.nodes[r.id];
  try {
    if (type === 'shape') {
      const preset = opt.shapePreset || (params.exprX || params.exprY || params.exprZ ? null : 'spiral');
      if (preset) setShapePreset(graphName, r.id, preset);
    }
    applyParams(graphName, node, params, warnings);
  } catch (e) { delete g.nodes[r.id]; throw e; }
  if (!hasPos) getEntry(graphName).autoPlaced.add(r.id);
  return { id: r.id, warnings };
}
export function setShapePreset(graphName, id, preset) {
  const node = getNode(G(graphName), id);
  if (node.type !== 'shape') throw new Error('shape_preset only works on shape nodes.');
  const p = ore.substPreset(preset);
  if (!p) throw new Error(`Unknown preset: ${preset}. Presets: ${SHAPE_PRESETS.map(q => q.id).join(', ')}`);
  node.data.exprX = p.x; node.data.exprY = p.y; node.data.exprZ = p.z; node.data.preset = preset;
}
export function setParams(graphName, id, params, shapePreset) {
  const g = G(graphName), node = getNode(g, id), warnings = [], before = clone(node.data);
  try {
    if (shapePreset) setShapePreset(graphName, id, shapePreset);
    applyParams(graphName, node, params, warnings);
  } catch (e) { node.data = before; throw e; }
  return { warnings };
}
export function nodeInputs(graphName, id) {
  const g = G(graphName), n = getNode(g, id);
  return ore.allInputs(g, id);
}
export function connect(graphName, fromId, fromSock, toId, toSock) {
  const g = G(graphName), a = getNode(g, fromId), b = getNode(g, toId);
  if (fromId === toId) throw new Error("A node can't be connected to itself.");
  const outs = NODE_DEFS[a.type].outputs.map(s => s.k);
  if (!outs.includes(fromSock)) throw new Error(`${fromId} (${a.type}) has no output socket "${fromSock}". Outputs: ${outs.join(', ') || '(none)'}`);
  const ins = nodeInputs(graphName, toId).map(s => s.k);
  if (!ins.includes(toSock)) throw new Error(`${toId} (${b.type}) has no input socket "${toSock}". Inputs: ${ins.join(', ') || '(none)'}`);
  if (toSock === 'trigger' && !((a.type === 'event' || a.type === 'particle_event') ? b.type === 'sub_emitter' : (b.type === 'event' || b.type === 'particle_event')))
    throw new Error('trigger connections: emitter/sub_emitter.bone → event/particle_event.trigger, and event/particle_event.fire → sub_emitter.trigger');
  const replaced = Object.entries(g.wires).find(([, w]) => w.to.node === toId && w.to.socket === toSock);
  const backup = clone(g.wires), nextIdBefore = g.nextId;
  const r = ore.createWire(g, fromId, fromSock, toId, toSock);
  Object.assign(g, r.graph);
  const cyc = ore.checkCycles(g);
  if (cyc.length) { g.wires = backup; g.nextId = nextIdBefore; throw new Error(`Cancelled: this connection would create a loop. ${ore.t(cyc[0])} To feed a value back, go through an Accumulate's in/reset (it reads the previous step).`); }
  return { id: r.id, replaced: replaced ? `${replaced[1].from.node}.${replaced[1].from.socket}` : null };
}
export function disconnect(graphName, toId, toSock) {
  const g = G(graphName);
  const e = Object.entries(g.wires).find(([, w]) => w.to.node === toId && w.to.socket === toSock);
  if (!e) throw new Error(`Nothing is connected to ${toId}.${toSock}.`);
  delete g.wires[e[0]];
  return `${e[1].from.node}.${e[1].from.socket} → ${toId}.${toSock}`;
}
export function removeNode(graphName, id) {
  const g = G(graphName); getNode(g, id);
  let n = 0;
  for (const [wid, w] of Object.entries(g.wires)) if (w.from.node === id || w.to.node === id) { delete g.wires[wid]; n++; }
  delete g.nodes[id];
  getEntry(graphName).autoPlaced.delete(id);
  return n;
}

// Places nodes that were added without a position, left to right by connection depth. Nodes a person moved in the web editor are left alone.
export function layoutAuto(graphName, all = false) {
  const e = getEntry(graphName), g = e.graph;
  const targets = all ? new Set(Object.keys(g.nodes)) : e.autoPlaced;
  if (!targets.size) return 0;
  const depth = {}, ins = {};
  Object.values(g.wires).forEach(w => { (ins[w.to.node] = ins[w.to.node] || []).push(w.from.node); });
  const d = (id, seen = new Set()) => {
    if (depth[id] !== undefined) return depth[id];
    if (seen.has(id)) return 0; seen.add(id);
    const p = (ins[id] || []).filter(x => g.nodes[x]);
    return depth[id] = p.length ? 1 + Math.max(...p.map(x => d(x, seen))) : 0;
  };
  Object.keys(g.nodes).forEach(id => d(id));
  const colBottom = {};
  Object.values(g.nodes).forEach(n => { if (!targets.has(n.id)) { const c = Math.round((n.x - 40) / 300); colBottom[c] = Math.max(colBottom[c] || 0, n.y + 440); } });
  let moved = 0;
  Object.values(g.nodes).sort((a, b) => depth[a.id] - depth[b.id] || (a.id < b.id ? -1 : 1)).forEach(n => {
    if (!targets.has(n.id)) return;
    const c = depth[n.id];
    n.x = 40 + c * 300; n.y = colBottom[c] || 40; colBottom[c] = n.y + 440; moved++;
  });
  e.autoPlaced = new Set();
  return moved;
}

export function setTexture(graphName, id, pngFile) {
  const node = getNode(G(graphName), id);
  if (node.type !== 'emitter' && node.type !== 'sub_emitter') throw new Error('A texture image can only be set on an emitter or sub_emitter.');
  const buf = fs.readFileSync(resolvePath(pngFile));
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Only PNG files can be used.');
  const url = 'data:image/png;base64,' + buf.toString('base64');
  node.data.texPng = url; node.data.texImg = url;
  return buf.length;
}

// ------------------------------------------------------------------ compile · check · simulate
export const baseIdentifier = name => 'ore:' + String(name || 'my_vfx').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
// Messages from the compiler are Korean source text; ore.t() turns them into English.
export function compileGraph(graphName, opt = {}) {
  const r = ore.compile(clone(G(graphName)), baseIdentifier(graphName), opt);
  if (r.errors) r.errors = r.errors.map(ore.t);
  if (r.results) r.results.forEach(x => { if (x.optStats) x.optStats = ore.t(x.optStats); });
  return r;
}
export function validateGraph(graphName) {
  const r = compileGraph(graphName);
  if (r.errors) return { ok: false, errors: r.errors, files: [] };
  const files = r.results.map(x => ({ identifier: x.identifier, kind: x.isSplit ? 'split' : x.isSub ? 'sub_emitter' : 'main', optimize: x.optStats,
    issues: ore.validateJson(x.json, r.userVars).map(([level, msg]) => ({ level, msg: ore.t(msg) })) }));
  return { ok: files.every(f => f.issues.every(i => i.level !== 'error')), errors: [], files, userVars: r.userVars };
}
export function simulateGraph(graphName, { identifier, times, maxParticles = 12 } = {}) {
  const r = compileGraph(graphName);
  if (r.errors) throw new Error("Can't simulate because the graph doesn't compile: " + r.errors.join(' / '));
  const f = identifier ? r.results.find(x => x.identifier === identifier) : r.results[0];
  if (!f) throw new Error(`No file "${identifier}". Files: ${r.results.map(x => x.identifier).join(', ')}`);
  let ts = times;
  if (!ts || !ts.length) {
    const em = Object.values(G(graphName).nodes).find(n => n.id === f.nodeId);
    const life = Math.max(0.2, em ? Number(em.data.lifetimeSeconds) || 1 : 1);
    ts = [0, 0.25, 0.5, 0.75, 0.98].map(k => Math.round(life * k * 100) / 100);
  }
  ts = [...ts].sort((a, b) => a - b);
  const frames = ore.simulate(f.json, ts, maxParticles, r.userVars);
  frames.forEach(fr => { fr.errors = fr.errors.map(ore.t); });
  return { identifier: f.identifier, frames };
}

// Builds a .mcpack (resource pack) — same contents as the web editor's buildPack
export async function buildMcpack(graphNames, file, opt = {}) {
  const all = [], texFiles = [];
  for (const gn of graphNames) {
    const r = compileGraph(gn);
    if (r.errors) throw new Error(`[${gn}] does not compile: ${r.errors.join(' / ')}`);
    const g = G(gn), texOf = {};
    for (const x of r.results) {
      let j = x.json; const n = g.nodes[x.nodeId], u = n && n.data && (n.data.texPng || n.data.texImg);
      if (u) {
        if (!texOf[x.nodeId]) { const p = 'textures/particle/ore_' + x.identifier.split(':')[1]; texOf[x.nodeId] = p; texFiles.push({ name: p + '.png', bin: Buffer.from(u.split(',')[1], 'base64') }); }
        j = clone(j); j.particle_effect.description.basic_render_parameters.texture = texOf[x.nodeId];
      }
      all.push({ identifier: x.identifier, json: j });
    }
  }
  const seen = new Set();
  for (const x of all) { if (seen.has(x.identifier)) throw new Error(`Several graphs use the same identifier: ${x.identifier}. Rename a graph or change the emitter's particleId.`); seen.add(x.identifier); }
  const g0 = G(graphNames[0]), nm = all[0].identifier.split(':')[1];
  const name = opt.name || (g0.pack && g0.pack.name) || nm, desc = opt.description || (g0.pack && g0.pack.desc) || 'ORE VFX';
  const man = { format_version: 2, header: { name, description: desc, uuid: crypto.randomUUID(), version: [1, 0, 0], min_engine_version: [1, 20, 0] },
    modules: [{ type: 'resources', uuid: crypto.randomUUID(), version: [1, 0, 0] }] };
  const files = [{ name: 'manifest.json', data: JSON.stringify(man, null, 2) }];
  if (opt.iconPng) {
    const buf = fs.readFileSync(resolvePath(opt.iconPng));
    if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('The icon must be a PNG file.');
    files.push({ name: 'pack_icon.png', bin: buf });
  } else if (g0.pack && g0.pack.icon) files.push({ name: 'pack_icon.png', bin: Buffer.from(g0.pack.icon.split(',')[1], 'base64') });
  files.push(...texFiles);
  all.forEach(x => files.push({ name: 'particles/' + x.identifier.split(':')[1] + '.particle.json', data: JSON.stringify(x.json, null, 2) }));
  const abs = resolvePath(file.endsWith('.mcpack') ? file : file + '.mcpack');
  if (fs.existsSync(abs) && !opt.overwrite) throw new Error(`The file already exists: ${file}. Use overwrite=true to replace it.`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, await ore.zip(files));
  return { path: abs, particles: all.map(x => x.identifier), files: files.map(f => f.name) };
}

export { G as graphOf, getNode, clone };
