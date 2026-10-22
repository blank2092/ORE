#!/usr/bin/env node
// ORE MCP server (stdio, runs on your own computer)
// An AI client edits node graphs; the same compiler as the web editor (core/ore-core.js, extracted from
// html/ore_vfx_editor.html) turns them into Bedrock particle JSON. There is no tool for editing the exported JSON
// directly. Graph files use the web editor's 💾 save format, so they open in the web editor as they are.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import fs from 'node:fs';
import path from 'node:path';
import * as S from './store.mjs';

const CHARACTER_LIMIT = 25000;
const text = t => ({ content: [{ type: 'text', text: t }] });
const json = o => { const t = JSON.stringify(o, null, 2); return { content: [{ type: 'text', text: t }], structuredContent: o }; };
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const FMT = z.enum(['markdown', 'json']).default('markdown').describe("'markdown' for a readable summary, 'json' for the full data");
const graphArg = z.string().min(1).describe('Graph name (see ore_list_graphs)');
const nodeArg = z.string().min(1).describe('Node id, e.g. "vortexfield_7"');
const paramsArg = z.record(z.string(), z.any()).default({}).describe('Fields to change and their values, e.g. {"strength":3,"radius":5}. Field names: ore_list_node_types(type=…)');

// ---------------------------------------------------------------- display helpers
const short = (v) => {
  if (typeof v === 'string') return v.startsWith('data:') ? '(image)' : v.length > 70 ? JSON.stringify(v.slice(0, 70)) + `…(${v.length} chars)` : JSON.stringify(v);
  if (v && typeof v === 'object') { const s = JSON.stringify(v); return s.length > 90 ? s.slice(0, 90) + '…' : s; }
  return String(v);
};
function changedParams(node) {
  const d = S.NODE_DEFS[node.type].defaults, out = [];
  for (const [k, v] of Object.entries(node.data || {})) {
    if (k.startsWith('_') || ['previewDensity', 'wallDetail', 'showPreview', 'tracedPreview', 'efd', 'generatedExprX', 'generatedExprZ', 'contourError'].includes(k)) continue;
    if (JSON.stringify(v) !== JSON.stringify(d[k])) out.push(`${k}=${short(v)}`);
  }
  return out;
}
function graphMarkdown(name) {
  const g = S.graphOf(name), nodes = Object.values(g.nodes), wires = Object.values(g.wires);
  const lines = [`# Graph ${name}`, `${nodes.length} nodes · ${wires.length} connections · default identifier ${S.baseIdentifier(name)}`, ''];
  for (const n of nodes) {
    const label = S.NODE_DESC[n.type]?.name || n.type;
    const ch = changedParams(n);
    lines.push(`## ${n.id} — ${label}${n.data.displayName ? ` · ${n.data.displayName}` : ''}`);
    if (ch.length) lines.push(`- values: ${ch.join(', ')}`);
    const inc = wires.filter(w => w.to.node === n.id).map(w => `${w.to.socket} ← ${w.from.node}.${w.from.socket}`);
    if (inc.length) lines.push(`- inputs: ${inc.join(' · ')}`);
  }
  if (!nodes.length) lines.push('(empty graph) Start with ore_add_node type="emitter". See ore_help(topic="basics").');
  return lines.join('\n');
}
function nodeTypeDetail(type) {
  const d = S.NODE_DEFS[type];
  const enums = S.ENUMS[type] || {}, formulas = (S.FORMULA_FIELDS[type] || {});
  const params = Object.entries(d.defaults).filter(([k]) => !['previewDensity', 'wallDetail', 'showPreview', 'tracedPreview', 'efd', 'efdList', 'imageDataUrl', 'bakedGrid', 'fourierCoeffs', 'contourError', 'generatedExprX', 'generatedExprZ', 'preset'].includes(k))
    .map(([k, v]) => ({ key: k, default: v, ...(enums[k] ? { options: enums[k] } : {}), ...(formulas[k] ? { formula_vars: formulas[k] } : {}) }));
  return {
    type, name: S.NODE_DESC[type]?.name || type, description: S.NODE_DESC[type]?.desc || '',
    inputs: d.inputs.map(s => ({ socket: s.k, label: s.label, ...(s.timing ? { timing: s.timing } : {}) })),
    detail_inputs: type === 'wall' ? 'Per wall, "w<number>:<field>" (e.g. w0:minX, w1:bounce). Fields: minX minY minZ maxX maxY maxZ friction bounce reboundLimit' : (S.DETAIL_INPUTS[type] || []),
    outputs: d.outputs.map(s => ({ socket: s.k, label: s.label })),
    params,
    ...(type === 'shape' ? { shape_presets: S.SHAPE_PRESETS.map(p => ({ id: p.id, name: p.name, desc: p.desc })) } : {}),
  };
}

// ---------------------------------------------------------------- help
const HELP = {
  basics: `# ORE graph basics
- One graph = one particle effect. Minimal setup: emitter → shape → output
  emitter.j/n/h/seed → shape.j/n/h/seed, shape.x/y/z → output.offx/offy/offz  (ore_new_graph template="basic" builds exactly this)
- emitter: particle count (count; above 1000 the export is split into several files automatically), lifetime (lifetimeSeconds), texture, spawn mode (burst/steady)
- output sockets
  offx/offy/offz: particle position. The position is computed directly by this formula every frame (it is not physics integration). To move over time, use time (pa, ea, a Formula's t) or integrate with Accumulate.
  r/g/b/a: color (0–1) · size_x/size_y: size · uvx/uvy/uvw/uvh: texture UV (connect a flipbook node) · rot: rotation in degrees, computed every frame (connect a time formula to keep it spinning, e.g. math expr="t*180" → output.rot) · life: the particle disappears at this age (s) · dirx/diry/dirz: direction (when facingMode is a direction mode)
- value nodes: constant (a number, or v.name so the game can control it), math (Formula, any expression), remap, threshold, curve, gradient, dissipationfield
- Each input takes one connection (connecting again replaces the old one).
- Recommended order: edit the graph → ore_validate → ore_simulate to check positions/colors → ore_save_graph (open it in the web editor to look at it) → ore_export_json or ore_build_mcpack`,
  formula: `# Formulas
${S.FORMULA_HELP}
- shape.exprX/Y/Z variables: j (particle index 0..n-1), n (count), h (emitter.height), seed. Example circle: x=2*cos(j/n*360), y=0, z=2*sin(j/n*360)
- math (Formula) expr variables: a, b, c, d (input sockets), t (time input; uses timeSource if not connected), dt (length of one Accumulate integration step)
- Any other name becomes a Molang variable v.name (0 unless the game sets it) — watch out for typos.`,
  physics: `# Motion and physics
- Positions are computed by formula every frame. To use a "force", integrate it with Accumulate.
- First order (force straight into position): three position Accumulates (x, y, z). init ← shape.x/y/z, in ← force node fx/fy/fz, out → output.offx/y/z
- Second order (force → velocity → position): velocity Accumulate.in ← force, position Accumulate.in ← velocity.out, position.init ← shape
- If the force depends on position (attractor, vortex, wall), feed position Accumulate.out back into the force node's x/y/z. Feedback is only allowed through an Accumulate's in/reset.
- To gather particles at an attractor: second order + velocity Accumulate.out → attractorfield.vx/vy/vz, with drag > 0
- To keep particles swirling in a vortex: vortexfield.orbitRadius > 0 (with 0 they are sucked into the axis and stop)
- Wall collisions inside an integration loop: position.out → wall.x/y/z, math expr="a+(b-c)/dt" (a = force, b = wall output, c = position.out) → position.in
- Higher Accumulate.samples (1–32) is more accurate but makes longer formulas. Above 55KB it is reduced automatically.`,
  events: `# Events and sub emitters
- Once for the whole emitter: emitter.bone → event.trigger, event.fire → sub_emitter.trigger. condition: creation / expiration / timeline (timelineTime seconds)
- For every particle: emitter.bone → particle_event.trigger, particle_event.fire → sub_emitter.trigger (fires once per particle, so it can multiply quickly). sound plays a sound
- A sub_emitter needs its own shape/output chain (sub_emitter.j/n/h/seed → shape → output). It is exported as a separate file.
- If event.bindToBone=true, connect the parent emitter.bone to the sub_emitter's bone input.`,
  limits: `# What MCP does not do
- Edit the exported JSON (Molang) directly: never. It is always compiled from the graph.
- Image processing for image nodes (shape_image_contour, vecfield_image): add the image in the web editor and save; MCP can then open and compile that file.
- particle_event.expr (unchecked Molang): blocked by default (allowed with ORE_ALLOW_RAW_MOLANG=1).
- Files are only read and written inside the work folder (ORE_WORKDIR): ${S.WORKDIR}
- ore_simulate runs the main emitter file only (not the web editor's ALL playback of sub emitters).`,
};

// ---------------------------------------------------------------- server
function createServer() {
  const server = new McpServer({ name: 'ore-vfx-mcp-server', version: '1.1.5' });
  const tool = (name, cfg, fn) => server.registerTool(name, cfg, async (args, ctx) => fn(args, ctx));

  tool('ore_help', {
    title: 'How to build ORE graphs',
    description: 'How to build ORE node graphs. Read basics first. topic: basics (setup and output sockets) | formula (formula syntax) | physics (forces, integration, feedback) | events (sub emitters) | limits (what MCP cannot do)',
    inputSchema: z.strictObject({ topic: z.enum(['basics', 'formula', 'physics', 'events', 'limits']).default('basics') }),
    annotations: RO,
  }, ({ topic }) => text(HELP[topic]));

  tool('ore_list_node_types', {
    title: 'Node types',
    description: 'Without type: the list of node types with a one-line description. With type: that node\'s input/output sockets, fields (defaults and options) and detail inputs (number fields you can connect another node to). Check this before adding or connecting nodes.',
    inputSchema: z.strictObject({ type: z.string().optional().describe('e.g. "vortexfield"') }),
    annotations: RO,
  }, ({ type }) => {
    if (type) { if (!S.NODE_DEFS[type]) throw new Error(`Unknown node type: ${type}`); return json(nodeTypeDetail(type)); }
    const lines = Object.keys(S.NODE_DEFS).map(t => `- **${t}** (${S.NODE_DESC[t]?.name || t}): ${(S.NODE_DESC[t]?.desc || '').slice(0, 140)}`);
    return text(`# ${lines.length} node types\n${lines.join('\n')}\n\nSockets and fields: ore_list_node_types(type="…")`);
  });

  tool('ore_new_graph', {
    title: 'New graph',
    description: 'Creates a new graph. The name becomes the default particle identifier (ore:name) and the tab name when saved. template="basic" also adds and connects emitter → shape (spiral) → output.',
    inputSchema: z.strictObject({ name: z.string().min(1).max(60).describe('Letters, digits, _ and - (e.g. "fire_burst")'), template: z.enum(['empty', 'basic']).default('basic') }),
    annotations: EDIT,
  }, ({ name, template }) => { const n = S.newGraph(name, template); return text(`Created graph "${n}".\n\n${graphMarkdown(n)}`); });

  tool('ore_open_graph', {
    title: 'Open a graph file',
    description: `Opens a progress file (.txt/.json) saved with the web editor's 💾 button. A file with several tabs opens as one graph per tab. Paths are relative to the work folder: ${S.WORKDIR}`,
    inputSchema: z.strictObject({ path: z.string().min(1).describe('e.g. "saves/ore_progress_2026-10-21.txt"') }),
    annotations: EDIT,
  }, ({ path: p }) => { const names = S.openGraphFile(p); return text(`Opened: ${names.join(', ')}\n\n` + names.map(graphMarkdown).join('\n\n').slice(0, CHARACTER_LIMIT)); });

  tool('ore_list_graphs', { title: 'Open graphs', description: 'Lists the graphs that are open now.', annotations: RO }, () => {
    const l = S.listGraphs();
    return text(l.length ? l.map(g => `- ${g.name}: ${g.nodes} nodes · ${g.wires} connections${g.file ? ` · file ${g.file}` : ''}`).join('\n') : 'No graphs are open. Use ore_new_graph or ore_open_graph.');
  });

  tool('ore_get_graph', {
    title: 'Show a graph',
    description: 'Shows the graph\'s nodes (only fields that differ from the defaults) and connections. response_format="json" returns the full data as in the save file (image data left out).',
    inputSchema: z.strictObject({ graph: graphArg, response_format: FMT }),
    annotations: RO,
  }, ({ graph, response_format }) => {
    if (response_format === 'json') {
      const g = S.clone(S.graphOf(graph));
      Object.values(g.nodes).forEach(n => { for (const k of Object.keys(n.data)) if (typeof n.data[k] === 'string' && n.data[k].startsWith('data:')) n.data[k] = '(image omitted)'; ['tracedPreview', 'bakedGrid', 'fourierCoeffs', 'efdList', 'efd'].forEach(k => { if (n.data[k]) n.data[k] = '(baked data omitted)'; }); });
      const t = JSON.stringify({ nodes: g.nodes, wires: g.wires }, null, 2);
      if (t.length > CHARACTER_LIMIT) return text(t.slice(0, CHARACTER_LIMIT) + '\n…(cut off: use the markdown format or ore_get_node)');
      return json({ nodes: g.nodes, wires: g.wires });
    }
    return text(graphMarkdown(graph));
  });

  tool('ore_get_node', {
    title: 'Show a node',
    description: 'All field values of one node, what is connected to each input socket, and where each output goes.',
    inputSchema: z.strictObject({ graph: graphArg, node: nodeArg }),
    annotations: RO,
  }, ({ graph, node }) => {
    const g = S.graphOf(graph), n = S.getNode(g, node), wires = Object.values(g.wires);
    const data = Object.fromEntries(Object.entries(n.data).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('data:') ? '(image)' : ['tracedPreview', 'bakedGrid', 'fourierCoeffs', 'efdList', 'efd'].includes(k) && v ? '(baked data)' : v]));
    const inputs = S.nodeInputs(graph, node).map(s => { const w = wires.find(w => w.to.node === node && w.to.socket === s.k); return { socket: s.k, ...(s.detail ? { detail: true } : {}), from: w ? `${w.from.node}.${w.from.socket}` : null }; });
    const outputs = S.NODE_DEFS[n.type].outputs.map(s => ({ socket: s.k, to: wires.filter(w => w.from.node === node && w.from.socket === s.k).map(w => `${w.to.node}.${w.to.socket}`) }));
    return json({ id: n.id, type: n.type, data, inputs, outputs });
  });

  tool('ore_add_node', {
    title: 'Add a node',
    description: 'Adds a node and returns its id. params sets starting values. For a shape, fill the formulas with shape_preset (spiral, sphere, disc, ring, cylinder, cone, cube, helix, wave, cloud) or write exprX/Y/Z in params. Without a position (x, y) the node is placed automatically by connection order when saved.',
    inputSchema: z.strictObject({
      graph: graphArg, type: z.string().min(1).describe('Node type, e.g. "noise3d"'), params: paramsArg,
      shape_preset: z.string().optional().describe('shape nodes only'),
      x: z.number().optional(), y: z.number().optional(),
    }),
    annotations: EDIT,
  }, ({ graph, type, params, shape_preset, x, y }) => {
    const r = S.addNode(graph, type, params, { x, y, shapePreset: shape_preset });
    const d = nodeTypeDetail(type);
    return text(`Added: ${r.id} (${type})\nInputs: ${d.inputs.map(s => s.socket).join(', ') || 'none'}\nOutputs: ${d.outputs.map(s => s.socket).join(', ') || 'none'}${r.warnings.length ? '\n⚠ ' + r.warnings.join('\n⚠ ') : ''}`);
  });

  tool('ore_set_params', {
    title: 'Change node values',
    description: 'Changes field values of a node. If any field name or value is wrong, nothing is changed. Formula fields (shape.exprX/Y/Z, math.expr) are syntax-checked. Special fields: gradient.stops=[{pos,color:"#rrggbb"}], curve.points=[{x,y}], wall.wallCount / wall.walls=[{minX..maxZ,friction,bounce,reboundLimit}]',
    inputSchema: z.strictObject({ graph: graphArg, node: nodeArg, params: paramsArg, shape_preset: z.string().optional().describe("Replace a shape node's formulas with this preset") }),
    annotations: EDIT,
  }, ({ graph, node, params, shape_preset }) => {
    const r = S.setParams(graph, node, params, shape_preset);
    const n = S.getNode(S.graphOf(graph), node);
    return text(`${node} updated: ${changedParams(n).join(', ') || '(same as defaults)'}${r.warnings.length ? '\n⚠ ' + r.warnings.join('\n⚠ ') : ''}`);
  });

  tool('ore_connect', {
    title: 'Connect',
    description: 'Connects an output socket to an input socket. An input takes only one connection, so an existing one is replaced. Connections that create a loop are refused (feedback is only allowed through an Accumulate\'s in/reset). Detail inputs (e.g. vortexfield.cx, wall.w0:minX) can be connected too.',
    inputSchema: z.strictObject({ graph: graphArg, from_node: nodeArg, from_socket: z.string().min(1), to_node: nodeArg, to_socket: z.string().min(1) }),
    annotations: EDIT,
  }, ({ graph, from_node, from_socket, to_node, to_socket }) => {
    const r = S.connect(graph, from_node, from_socket, to_node, to_socket);
    return text(`Connected: ${from_node}.${from_socket} → ${to_node}.${to_socket}${r.replaced ? ` (replaced the previous connection from ${r.replaced})` : ''}`);
  });

  tool('ore_disconnect', {
    title: 'Disconnect',
    description: 'Removes the connection going into an input socket.',
    inputSchema: z.strictObject({ graph: graphArg, to_node: nodeArg, to_socket: z.string().min(1) }),
    annotations: { ...EDIT, destructiveHint: true },
  }, ({ graph, to_node, to_socket }) => text(`Disconnected: ${S.disconnect(graph, to_node, to_socket)}`));

  tool('ore_remove_node', {
    title: 'Remove a node',
    description: 'Deletes a node and all of its connections.',
    inputSchema: z.strictObject({ graph: graphArg, node: nodeArg }),
    annotations: { ...EDIT, destructiveHint: true },
  }, ({ graph, node }) => text(`Removed ${node} (and ${S.removeNode(graph, node)} connections)`));

  tool('ore_set_texture', {
    title: 'Particle texture',
    description: 'Puts a PNG texture on an emitter/sub_emitter. When a .mcpack is built it goes into textures/particle/ and the texture path is updated automatically.',
    inputSchema: z.strictObject({ graph: graphArg, node: nodeArg, png_path: z.string().min(1).describe('PNG path relative to the work folder') }),
    annotations: EDIT,
  }, ({ graph, node, png_path }) => text(`Texture set on ${node} (${S.setTexture(graph, node, png_path)} bytes).`));

  tool('ore_validate', {
    title: 'Check',
    description: 'Compiles the graph the same way as the web editor\'s Export and checks the resulting particle JSON (required components, Molang syntax, undefined variables, simulation errors). Run it after every edit.',
    inputSchema: z.strictObject({ graph: graphArg, response_format: FMT }),
    annotations: RO,
  }, ({ graph, response_format }) => {
    const r = S.validateGraph(graph);
    if (response_format === 'json') return json(r);
    if (r.errors.length) return text(`# Export failed\n${r.errors.map(e => '- ✖ ' + e).join('\n')}`);
    const icon = { error: '✖', warn: '⚠', ok: '✔', info: '🎮' };
    return text(`# Check ${r.ok ? 'passed' : 'found errors'}\n` + r.files.map(f => `## ${f.identifier} (${f.kind})\n${f.issues.map(i => `- ${icon[i.level] || '-'} ${i.msg}`).join('\n')}${f.optimize ? `\n- ⚡ ${f.optimize}` : ''}`).join('\n'));
  });

  tool('ore_simulate', {
    title: 'Simulate',
    description: 'Runs the exported JSON in the same simulator as the 3D preview and returns, for each time, how many particles are alive, their bounds and center, and sample particles with position/size/color (and rotation angle if the rotation socket is connected). Use it to check with numbers that the effect looks as intended. Without times, 5 points from 0 to 98% of the emitter lifetime are used.',
    inputSchema: z.strictObject({
      graph: graphArg,
      times: z.array(z.number().min(0).max(600)).max(20).optional().describe('Times in seconds, e.g. [0,0.5,1,2]'),
      identifier: z.string().optional().describe('Which file to run when there are several (default: the first)'),
      max_particles: z.number().int().min(0).max(50).default(12).describe('How many sample particles to show per time'),
      response_format: FMT,
    }),
    annotations: RO,
  }, ({ graph, times, identifier, max_particles, response_format }) => {
    const r = S.simulateGraph(graph, { identifier, times, maxParticles: max_particles });
    if (response_format === 'json') return json(r);
    const f3 = a => a ? `(${a.map(v => v.toFixed(2)).join(', ')})` : '-';
    return text(`# Simulation ${r.identifier}\n` + r.frames.map(fr => [
      `## t=${fr.t}s — alive ${fr.alive}/${fr.total}`,
      fr.errors.length ? `- ✖ evaluation errors: ${fr.errors.join(' / ')}` : null,
      fr.bounds ? `- bounds min ${f3(fr.bounds.min)} max ${f3(fr.bounds.max)} · center ${f3(fr.bounds.center)}` : '- no particles alive',
      fr.sample.length ? '- samples: ' + fr.sample.map(p => `#${p.i} pos${f3(p.pos)} size${f3(p.size)} rgba${f3(p.color)}${p.rot !== undefined ? ` rot${p.rot.toFixed(1)}°` : ''}`).join('; ') : null,
    ].filter(Boolean).join('\n')).join('\n\n'));
  });

  tool('ore_preview_json', {
    title: 'Show exported JSON',
    description: 'Shows the compiled particle JSON, read-only (for checking; it can\'t be edited). Always make changes in the graph.',
    inputSchema: z.strictObject({ graph: graphArg, identifier: z.string().optional(), max_chars: z.number().int().min(500).max(CHARACTER_LIMIT).default(8000) }),
    annotations: RO,
  }, ({ graph, identifier, max_chars }) => {
    const r = S.compileGraph(graph);
    if (r.errors) throw new Error('Export failed: ' + r.errors.join(' / '));
    const f = identifier ? r.results.find(x => x.identifier === identifier) : r.results[0];
    if (!f) throw new Error(`No file ${identifier}. Files: ${r.results.map(x => x.identifier).join(', ')}`);
    const t = JSON.stringify(f.json, null, 2);
    return text(`${r.results.length} file(s): ${r.results.map(x => x.identifier).join(', ')}\n\n${t.length > max_chars ? t.slice(0, max_chars) + `\n…(showing ${max_chars} of ${t.length} characters)` : t}`);
  });

  tool('ore_save_graph', {
    title: 'Save graphs',
    description: 'Saves graphs as a progress file the web editor opens (with its 📂 button). One graph is added as a new tab in the web editor; several graphs make a tab bundle. Nodes without a position are placed automatically now.',
    inputSchema: z.strictObject({ graphs: z.array(z.string().min(1)).min(1).describe('Names of the graphs to save'), path: z.string().min(1).describe('Path relative to the work folder, e.g. "saves/fire.txt"'), overwrite: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ graphs, path: p, overwrite }) => text(`Saved: ${S.saveGraphs(graphs, p, overwrite)}`));

  tool('ore_auto_layout', {
    title: 'Auto layout',
    description: 'Re-arranges nodes left to right by connection depth (so they look tidy in the web editor). all=false only places nodes that have no position yet.',
    inputSchema: z.strictObject({ graph: graphArg, all: z.boolean().default(true) }),
    annotations: EDIT,
  }, ({ graph, all }) => text(`Placed ${S.layoutAuto(graph, all)} nodes.`));

  tool('ore_export_json', {
    title: 'Save particle JSON',
    description: 'Saves the compiled particle_effect JSON files to a folder (for a resource pack\'s particles folder). Sub emitter files and split files (above 1000 particles) are saved too.',
    inputSchema: z.strictObject({ graph: graphArg, dir: z.string().min(1).describe('Folder relative to the work folder, e.g. "out/particles"'), overwrite: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ graph, dir, overwrite }) => {
    const r = S.compileGraph(graph);
    if (r.errors) throw new Error('Export failed: ' + r.errors.join(' / '));
    const abs = S.resolvePath(dir); fs.mkdirSync(abs, { recursive: true });
    const files = r.results.map(x => path.join(abs, x.identifier.split(':')[1] + '.json'));
    if (!overwrite) { const ex = files.filter(f => fs.existsSync(f)); if (ex.length) throw new Error(`These files already exist: ${ex.join(', ')}. Use overwrite=true to replace them.`); }
    r.results.forEach((x, i) => fs.writeFileSync(files[i], JSON.stringify(x.json, null, 2)));
    return text(`Saved ${files.length} file(s):\n${files.map(f => '- ' + f).join('\n')}`);
  });

  tool('ore_build_mcpack', {
    title: 'Build a .mcpack',
    description: 'Builds a Minecraft resource pack (.mcpack) from one or more graphs. It contains the manifest, the particle JSON, emitter texture images and the pack icon.',
    inputSchema: z.strictObject({
      graphs: z.array(z.string().min(1)).min(1), path: z.string().min(1).describe('e.g. "out/my_vfx.mcpack"'),
      name: z.string().optional().describe('Pack name (default: the first particle name)'), description: z.string().optional(),
      icon_png: z.string().optional().describe('Pack icon PNG path (256×256 recommended)'), overwrite: z.boolean().default(false),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ graphs, path: p, name, description, icon_png, overwrite }) => {
    const r = await S.buildMcpack(graphs, p, { name, description, iconPng: icon_png, overwrite });
    return text(`Built: ${r.path}\nParticles: ${r.particles.join(', ')}\nFiles: ${r.files.join(', ')}`);
  });

  tool('ore_close_graph', {
    title: 'Close a graph',
    description: 'Closes an open graph (unsaved changes are lost).',
    inputSchema: z.strictObject({ graph: graphArg }),
    annotations: { ...EDIT, destructiveHint: true },
  }, ({ graph }) => { S.closeGraph(graph); return text(`Closed ${graph}`); });

  return server;
}

serveStdio(createServer);
console.error(`ore-vfx-mcp-server running (stdio) · work folder ${S.WORKDIR}`);
