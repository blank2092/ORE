// Test graphs for the comparison tests, covering as many node types and options as possible.
// Returns [{name, graph:{nodes,wires,nextId}}]  (same structure as the web editor's 💾 save file)
export function buildTestGraphs(ore) {
  const out = [];
  const G = () => ({ nodes: {}, wires: {}, nextId: 1 });
  const add = (g, type, data = {}) => {
    const r = ore.createNode(g, type, 0, 0);
    Object.assign(g, r.graph);
    Object.assign(g.nodes[r.id].data, data);
    if (type === 'wall') Object.assign(g, ore.wallEnsure(g, r.id));
    return r.id;
  };
  const con = (g, a, as, b, bs) => { const r = ore.createWire(g, a, as, b, bs); Object.assign(g, r.graph); };
  const spiral = ore.substPreset('spiral');
  const base = (g, emData = {}) => {
    const em = add(g, 'emitter', Object.assign({ count: 60, lifetimeSeconds: 2 }, emData));
    const sh = add(g, 'shape', { exprX: spiral.x, exprY: spiral.y, exprZ: spiral.z });
    ['j', 'n', 'h', 'seed'].forEach(k => con(g, em, k, sh, k));
    const out = add(g, 'output');
    return { em, sh, out };
  };

  // 0) the same graph as the startup example
  { const g = G(); const { em, sh, out } = base(g, { count: 500, height: 5, seed: 42, lifetimeSeconds: 5 });
    const nz = add(g, 'noise3d', { rotateEnabled: true, rotateStep: 6 });
    const fr = add(g, 'math', { expr: '1+a' }), fg = add(g, 'math', { expr: '0.15+a' });
    ['x', 'y', 'z'].forEach(k => { con(g, sh, k, out, 'off' + k); con(g, sh, k, nz, k); });
    con(g, em, 'seed', nz, 'seed'); con(g, nz, 'n', fr, 'a'); con(g, fr, 'out', out, 'r');
    con(g, nz, 'n', fg, 'a'); con(g, fg, 'out', out, 'g'); con(g, fg, 'out', out, 'a');
    outPush('sample', g); }
  function outPush(name, g) { out.push({ name, graph: JSON.parse(JSON.stringify(g)) }); }

  // 1) every node type: shape position → node → offset / tint / size
  const single = ['noise3d', 'curlnoise', 'curlturb', 'vortexfield', 'attractorfield', 'directionalfield', 'windzone',
    'wall', 'dragfield', 'buoyancyfield', 'dissipationfield', 'constant', 'accumulate', 'remap', 'math', 'gradient',
    'curve', 'flipbook', 'threshold'];
  const types = ore.nodeTypes();
  for (const t of single) {
    const g = G(); const { em, sh, out } = base(g);
    const n = add(g, t);
    const def = types[t];
    ['x', 'y', 'z'].forEach(k => { if (def.inputs.some(s => s.k === k)) con(g, sh, k, n, k); });
    ['j', 'n', 'h', 'seed'].forEach(k => { if (def.inputs.some(s => s.k === k)) con(g, em, k, n, k); });
    if (def.inputs.some(s => s.k === 'in')) con(g, sh, 'x', n, 'in');
    if (def.inputs.some(s => s.k === 'a')) con(g, sh, 'y', n, 'a');
    const outs = def.outputs.map(s => s.k);
    ['offx', 'offy', 'offz'].forEach((k, i) => con(g, outs[i] ? n : sh, outs[i] || 'xyz'[i], out, k));
    con(g, n, outs[0], out, 'r'); con(g, n, outs[0], out, 'size_x'); con(g, sh, 'x', out, 'size_y');
    if (t === 'flipbook') ['uvx', 'uvy', 'uvw', 'uvh'].forEach((k, i) => con(g, n, outs[i], out, k));
    outPush('node-' + t, g);
  }
  // 2) noise types / options
  for (const nt of ['perlin', 'simplex', 'voronoi', 'fbm']) {
    const g = G(); const { em, sh, out } = base(g);
    const n = add(g, 'noise3d', { noiseType: nt, cycleOffsetEnabled: true, tiltX: 20, tiltY: 10 });
    ['x', 'y', 'z'].forEach(k => con(g, sh, k, n, k));
    con(g, n, 'n', out, 'offx'); con(g, sh, 'y', out, 'offy'); con(g, n, 'n', out, 'a');
    outPush('noise-' + nt, g);
  }
  // 3) physics: velocity/position Accumulate + attractor (second order) + wall feedback
  { const g = G(); const { em, sh, out } = base(g, { lifetimeSeconds: 4 });
    const at = add(g, 'attractorfield', { strength: 3, radius: 0, drag: 2 });
    const px = add(g, 'accumulate', { samples: 8 }), py = add(g, 'accumulate', { samples: 8 }), pz = add(g, 'accumulate', { samples: 8 });
    const vx = add(g, 'accumulate', { samples: 8, init: 0 }), vy = add(g, 'accumulate', { samples: 8 }), vz = add(g, 'accumulate', { samples: 8 });
    [[px, 'x', vx, 'fx'], [py, 'y', vy, 'fy'], [pz, 'z', vz, 'fz']].forEach(([p, k, v, f]) => {
      con(g, sh, k, p, 'init'); con(g, p, 'out', at, k); con(g, at, f, v, 'in'); con(g, v, 'out', p, 'in');
      con(g, v, 'out', at, 'v' + k); con(g, p, 'out', out, 'off' + k);
    });
    outPush('physics-attractor-2nd', g); }
  { const g = G(); const { em, sh, out } = base(g, { lifetimeSeconds: 6 });
    const vo = add(g, 'vortexfield', { orbitRadius: 1.5, inwardPull: 0.5 });
    const wl = add(g, 'wall', { wallCount: 2 });
    const acc = ['x', 'y', 'z'].map(k => add(g, 'accumulate', { samples: 10 }));
    const fm = ['x', 'y', 'z'].map(k => add(g, 'math', { expr: 'a+(b-c)/dt' }));
    ['x', 'y', 'z'].forEach((k, i) => {
      con(g, sh, k, acc[i], 'init'); con(g, acc[i], 'out', vo, k); con(g, acc[i], 'out', wl, k);
      con(g, vo, 'f' + k, fm[i], 'a'); con(g, wl, k, fm[i], 'b'); con(g, acc[i], 'out', fm[i], 'c');
      con(g, fm[i], 'out', acc[i], 'in'); con(g, wl, k, out, 'off' + k);
    });
    outPush('physics-vortex-wall-loop', g); }
  // 4) steady spawning + looping, split above 1000 particles
  { const g = G(); const { em, sh, out } = base(g, { emitMode: 'steady', spawnRate: 40, maxParticles: 150, particleLife: 1.5, steadyLoop: true });
    ['x', 'y', 'z'].forEach(k => con(g, sh, k, out, 'off' + k)); outPush('steady-loop', g); }
  { const g = G(); const { em, sh, out } = base(g, { count: 2400 });
    ['x', 'y', 'z'].forEach(k => con(g, sh, k, out, 'off' + k)); outPush('split-2400', g); }
  // 5) Sub Emitter · Event · Particle Event · local space · identifiers
  { const g = G(); const { em, sh, out } = base(g, { particleId: 'myns:boom', localSpace: true, lsRotation: true });
    ['x', 'y', 'z'].forEach(k => con(g, sh, k, out, 'off' + k));
    const ev = add(g, 'event', { condition: 'timeline', timelineTime: 0.5, copySeed: true });
    const pev = add(g, 'particle_event', { condition: 'expiration', sound: 'random.pop', expr: 'v.hit=1' });
    const sub = add(g, 'sub_emitter', { count: 20 });
    const sub2 = add(g, 'sub_emitter', { count: 10 });
    const ssh = add(g, 'shape', { exprX: '0', exprY: 'j/n', exprZ: '0' }), sout = add(g, 'output');
    const ssh2 = add(g, 'shape', { exprX: 'j/n', exprY: '0', exprZ: '0' }), sout2 = add(g, 'output');
    ['j', 'n', 'h', 'seed'].forEach(k => { con(g, sub, k, ssh, k); con(g, sub2, k, ssh2, k); });
    ['x', 'y', 'z'].forEach(k => { con(g, ssh, k, sout, 'off' + k); con(g, ssh2, k, sout2, 'off' + k); });
    con(g, em, 'bone', ev, 'trigger'); con(g, ev, 'fire', sub, 'trigger'); con(g, em, 'bone', sub, 'bone');
    con(g, em, 'bone', pev, 'trigger'); con(g, pev, 'fire', sub2, 'trigger');
    outPush('events-sub', g); }
  // 6) Constant v.name · detail inputs · direction/rotation/lifetime sockets
  { const g = G(); const { em, sh, out } = base(g, { facingMode: 'lookat_direction', billboardDirMode: 'custom' });
    const c = add(g, 'constant', { value: 'v.my_power', previewValue: 2 });
    const c2 = add(g, 'constant', { value: 1.5 });
    const vo = add(g, 'vortexfield');
    const wl = add(g, 'wall');
    ['x', 'y', 'z'].forEach(k => { con(g, sh, k, vo, k); con(g, sh, k, wl, k); con(g, wl, k, out, 'off' + k); });
    con(g, c, 'out', vo, 'strength'); con(g, c2, 'out', vo, 'cx'); con(g, c2, 'out', wl, 'w0:minX');
    con(g, vo, 'fx', out, 'dirx'); con(g, vo, 'fy', out, 'diry'); con(g, vo, 'fz', out, 'dirz');
    con(g, c2, 'out', out, 'rot'); con(g, c, 'out', out, 'life');
    outPush('detail-inputs-uservar', g); }
  // 7) image nodes (baked data filled in directly)
  { const g = G(); const { em, sh, out } = base(g);
    const circ = (cx, cy, r) => Array.from({ length: 40 }, (_, i) => [cx + r * Math.cos(i / 40 * 2 * Math.PI), cy + r * Math.sin(i / 40 * 2 * Math.PI)]);
    const efdList = ore.efdFromPolylines([circ(40, 64, 20), circ(90, 64, 12)], 6);
    const ic = add(g, 'shape_image_contour', { efdList, efd: efdList[0].efd, tracedPreview: { res: 128, mask: [], blobs: [] }, imageName: 'test.png' });
    ['j', 'n', 'h', 'seed'].forEach(k => con(g, em, k, ic, k));
    ['x', 'y', 'z'].forEach(k => con(g, ic, k, out, 'off' + k));
    const res = 4, grid = Array.from({ length: res * res }, (_, i) => { const a = i * 0.7; return [Math.cos(a), Math.sin(a)]; });
    const vf = add(g, 'vecfield_image', { resolution: res, bakedGrid: grid, fourierCoeffs: ore.fitFourier(grid, res, 8), imageName: 'f.png' });
    const vf2 = add(g, 'vecfield_image', { resolution: res, bakedGrid: grid, fourierCoeffs: ore.fitFourier(grid, res, 8), exportMode: 'lookup' });
    con(g, sh, 'x', vf, 'x'); con(g, sh, 'y', vf, 'y'); con(g, sh, 'x', vf2, 'x'); con(g, sh, 'z', vf2, 'y');
    con(g, vf, 'fx', out, 'r'); con(g, vf2, 'fy', out, 'g');
    outPush('image-nodes', g); }
  return out;
}
