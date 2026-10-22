// MCP server self-check: starts the real server and calls its tools as a client would. Exits with code 1 on failure.
// Run: npm run check
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ore-mcp-'));
const client = new Client({ name: 'ore-selfcheck', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
  env: { ...getDefaultEnvironment(), ORE_WORKDIR: work },
}));
const T = (t) => (t.content || []).map(c => c.text).join('\n');
async function call(name, args, expectError = false) {
  const r = await client.callTool({ name, arguments: args });
  if (expectError) assert.equal(r.isError, true, `${name} should have failed: ${T(r)}`);
  else assert.ok(!r.isError, `${name} failed: ${T(r)}`);
  return r;
}
const step = (m) => console.error('✔', m);

const { tools } = await client.listTools();
console.error(tools.length, 'tools:', tools.map(t => t.name).join(', '));
assert.ok(tools.length >= 18);

// 1) basic graph + noise color
await call('ore_new_graph', { name: 'test_fire', template: 'basic' });
let g = (await call('ore_get_graph', { graph: 'test_fire', response_format: 'json' })).structuredContent;
const id = t => Object.values(g.nodes).find(n => n.type === t).id;
const sh = id('shape'), out = id('output');
const nz = T(await call('ore_add_node', { graph: 'test_fire', type: 'noise3d', params: { noiseType: 'fbm', amplitude: 0.5 } })).match(/Added: (\S+)/)[1];
const fm = T(await call('ore_add_node', { graph: 'test_fire', type: 'math', params: { expr: '1+a' } })).match(/Added: (\S+)/)[1];
for (const k of ['x', 'y', 'z']) await call('ore_connect', { graph: 'test_fire', from_node: sh, from_socket: k, to_node: nz, to_socket: k });
await call('ore_connect', { graph: 'test_fire', from_node: nz, from_socket: 'n', to_node: fm, to_socket: 'a' });
await call('ore_connect', { graph: 'test_fire', from_node: fm, from_socket: 'out', to_node: out, to_socket: 'r' });
step('add and connect nodes');

// 2) bad input is refused and the graph stays as it was
await call('ore_set_params', { graph: 'test_fire', node: nz, params: { nope: 1 } }, true);
await call('ore_set_params', { graph: 'test_fire', node: nz, params: { noiseType: 'blue' } }, true);
await call('ore_set_params', { graph: 'test_fire', node: fm, params: { expr: '1+(a' } }, true);
await call('ore_set_params', { graph: 'test_fire', node: nz, params: { amplitude: 0.7, seed: 'x' } }, true);
await call('ore_connect', { graph: 'test_fire', from_node: nz, from_socket: 'zz', to_node: out, to_socket: 'g' }, true);
await call('ore_connect', { graph: 'test_fire', from_node: fm, from_socket: 'out', to_node: nz, to_socket: 'seed' }, true); // loop
await call('ore_add_node', { graph: 'test_fire', type: 'emitter' }, true); // second emitter
const pe = T(await call('ore_add_node', { graph: 'test_fire', type: 'particle_event' })).match(/Added: (\S+)/)[1];
await call('ore_set_params', { graph: 'test_fire', node: pe, params: { expr: 'v.x=1' } }, true); // raw Molang blocked
await call('ore_remove_node', { graph: 'test_fire', node: pe });
const node = (await call('ore_get_node', { graph: 'test_fire', node: nz })).structuredContent;
assert.equal(node.data.amplitude, 0.5, 'a failed change must not apply anything');
assert.equal(node.data.noiseType, 'fbm');
const warn = T(await call('ore_set_params', { graph: 'test_fire', node: fm, params: { expr: '1+a*powr' } }));
assert.match(warn, /powr/, 'warn about undefined names');
await call('ore_set_params', { graph: 'test_fire', node: fm, params: { expr: '1+a' } });
const noWarn = T(await call('ore_set_params', { graph: 'test_fire', node: fm, params: { expr: '1+a*cos(t*90)+sin (a)' } }));
assert.doesNotMatch(noWarn, /⚠/, 'function names (cos, sin) must not be flagged as variables: ' + noWarn);
await call('ore_set_params', { graph: 'test_fire', node: fm, params: { expr: '1+a' } });
step('bad input refused (field names, options, formulas, types, sockets, loops, second emitter, raw Molang)');

// 3) check and simulate
let v = T(await call('ore_validate', { graph: 'test_fire' }));
assert.match(v, /Check passed/, v);
const sim = (await call('ore_simulate', { graph: 'test_fire', times: [0, 0.5], response_format: 'json' })).structuredContent;
assert.equal(sim.frames[0].alive, 200);
step('check passed · simulation ' + sim.frames.map(f => `t=${f.t}: ${f.alive} particles`).join(', '));

// 3-1) [v1.1.3] the rotation socket is computed every frame — with a time formula the angle must change between times
const rm = T(await call('ore_add_node', { graph: 'test_fire', type: 'math', params: { expr: 't*90' } })).match(/Added: (\S+)/)[1];
await call('ore_connect', { graph: 'test_fire', from_node: rm, from_socket: 'out', to_node: out, to_socket: 'rot' });
assert.match(T(await call('ore_validate', { graph: 'test_fire' })), /Check passed/);
const rs = (await call('ore_simulate', { graph: 'test_fire', times: [0, 0.5, 0.9], max_particles: 1, response_format: 'json' })).structuredContent;
const rots = rs.frames.map(f => f.sample[0].rot);
assert.ok(rots.every(r => typeof r === 'number') && rots[0] !== rots[1] && rots[1] !== rots[2], 'rotation must change over time: ' + rots.join(', '));
await call('ore_remove_node', { graph: 'test_fire', node: rm });
step('rotation every frame: ' + rots.map(r => r.toFixed(1) + '°').join(' → '));

// 4) physics: attractor (second order) — particles must gather at the center over time
await call('ore_new_graph', { name: 'gather', template: 'basic' });
g = (await call('ore_get_graph', { graph: 'gather', response_format: 'json' })).structuredContent;
const gsh = id('shape'), gout = id('output'), gem = id('emitter');
await call('ore_set_params', { graph: 'gather', node: gem, params: { count: 100, lifetimeSeconds: 6 } });
await call('ore_set_params', { graph: 'gather', node: gsh, params: {}, shape_preset: 'sphere' });
const at = T(await call('ore_add_node', { graph: 'gather', type: 'attractorfield', params: { strength: 4, radius: 0, drag: 3 } })).match(/Added: (\S+)/)[1];
for (const k of ['x', 'y', 'z']) {
  const p = T(await call('ore_add_node', { graph: 'gather', type: 'accumulate', params: { samples: 12 } })).match(/Added: (\S+)/)[1];
  const vv = T(await call('ore_add_node', { graph: 'gather', type: 'accumulate', params: { samples: 12 } })).match(/Added: (\S+)/)[1];
  await call('ore_connect', { graph: 'gather', from_node: gsh, from_socket: k, to_node: p, to_socket: 'init' });
  await call('ore_connect', { graph: 'gather', from_node: p, from_socket: 'out', to_node: at, to_socket: k });
  await call('ore_connect', { graph: 'gather', from_node: at, from_socket: 'f' + k, to_node: vv, to_socket: 'in' });
  await call('ore_connect', { graph: 'gather', from_node: vv, from_socket: 'out', to_node: p, to_socket: 'in' });
  await call('ore_connect', { graph: 'gather', from_node: vv, from_socket: 'out', to_node: at, to_socket: 'v' + k });
  await call('ore_connect', { graph: 'gather', from_node: p, from_socket: 'out', to_node: gout, to_socket: 'off' + k });
}
v = T(await call('ore_validate', { graph: 'gather' }));
assert.match(v, /Check passed/, v);
const gs = (await call('ore_simulate', { graph: 'gather', times: [0, 1, 3, 5.5], response_format: 'json' })).structuredContent;
const ext = f => Math.max(...f.bounds.max.map((m, i) => Math.max(Math.abs(m), Math.abs(f.bounds.min[i]))));
const e = gs.frames.map(ext);
assert.ok(e[3] < e[0] * 0.3, `particles should gather at the center: ${e.map(x => x.toFixed(2)).join(' → ')}`);
step('attractor physics: max distance from origin ' + e.map(x => x.toFixed(2)).join(' → '));

// 5) save → web format / reopen / file output
await call('ore_save_graph', { graphs: ['test_fire'], path: 'saves/fire.txt' });
await call('ore_save_graph', { graphs: ['test_fire'], path: 'saves/fire.txt' }, true); // must not overwrite
await call('ore_save_graph', { graphs: ['test_fire', 'gather'], path: 'saves/both.txt' });
const saved = JSON.parse(fs.readFileSync(path.join(work, 'saves/fire.txt'), 'utf8'));
assert.ok(saved.__ore_progress_backup && saved.__ore_single_tab && saved.nodes && saved.wires);
assert.ok(Object.values(saved.nodes).every(n => n.x > 0 && n.y > 0), 'automatic layout');
const both = JSON.parse(fs.readFileSync(path.join(work, 'saves/both.txt'), 'utf8'));
assert.equal(both.tabs.length, 2);
const opened = T(await call('ore_open_graph', { path: 'saves/both.txt' }));
assert.match(opened, /test_fire_2, gather_2/);
await call('ore_save_graph', { graphs: ['test_fire'], path: '../escape.txt' }, true); // outside the work folder: refused
await call('ore_export_json', { graph: 'test_fire', dir: 'out/particles' });
assert.ok(fs.existsSync(path.join(work, 'out/particles/test_fire.json')));
await call('ore_build_mcpack', { graphs: ['test_fire', 'gather'], path: 'out/pack.mcpack', name: 'Test Pack' });
// File names inside the .mcpack (zip), read from the zip central directory (works on Windows, which has no unzip command)
const zbuf = fs.readFileSync(path.join(work, 'out/pack.mcpack')), names = [];
for (let i = 0; i + 46 <= zbuf.length; i++) if (zbuf.readUInt32LE(i) === 0x02014b50) { const nl = zbuf.readUInt16LE(i + 28); names.push(zbuf.toString('utf8', i + 46, i + 46 + nl)); }
const list = names.join('\n');
assert.match(list, /manifest\.json/); assert.match(list, /particles\/test_fire\.particle\.json/); assert.match(list, /particles\/gather\.particle\.json/);
step('save (web format), reopen, outside-folder refusal, JSON output, .mcpack');

// 6) preview the exported JSON (headless = web editor results are guaranteed by tests/compare.mjs)
const pj = (await call('ore_preview_json', { graph: 'test_fire', max_chars: 25000 }));
assert.match(T(pj), /"identifier": "ore:test_fire"/);
const tmpDir = fileURLToPath(new URL('./.tmp/', import.meta.url)); fs.mkdirSync(tmpDir, { recursive: true });
fs.writeFileSync(path.join(tmpDir, 'saved-fire.txt'), fs.readFileSync(path.join(work, 'saves/fire.txt')));
step('preview exported JSON');

await client.close();
console.error('\nSelf-check passed · work folder', work);
