// Extracts the calculation logic from the web editor (html/ore_vfx_editor.html) into core/ore-core.js.
//   npm run sync               → updates core/ore-core.js and core/node-descriptions.json
//   npm run sync -- --dry      → changes nothing, only shows what goes where
//   npm run sync -- --check    → only checks that core matches the HTML (exit code 1 if not; for tests/CI)
//   npm run sync -- <other HTML path>   → extract from that file instead of the default
//
// How statements are split (statement by statement, original text copied as is):
//   1) A named top-level declaration goes to core if that name was in core before, or to the screen side if it is
//      listed in tools/ui-names.json ("names"). Names listed under "core" in that file always go to core (for calculation
//      code that reads a window.* setting, e.g. pnum reads window.ORE_PREC).
//   2) A new statement goes to the screen side if it uses document/window as a variable; otherwise it goes with
//      the statement before it. A plain global setting `window.X = <value without DOM>;` does not count as screen
//      code (it becomes globalThis.X in core), so settings like window.ORE_PREC stay next to the code that reads them.
//   3) The ORE Sim block goes to core up to getResults; the ORE Opt block up to the generateAllParticleJSONs override.
// The screen side is dropped (the web editor uses the HTML itself). Added: window. → globalThis., the
// auto-generated notice, OreOpt.maxEstMs and the headless API at the end. Finally core is checked for DOM use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry'), CHECK = args.includes('--check');
const srcHtml = args.find(a => !a.startsWith('--')) || path.resolve(ROOT, '../html/ore_vfx_editor.html');
const CORE_FILE = path.join(ROOT, 'core/ore-core.js'), DESC_FILE = path.join(ROOT, 'core/node-descriptions.json');
const UI_FILE = path.join(ROOT, 'tools/ui-names.json');

const read = p => fs.readFileSync(p, 'utf8');
const html = read(srcHtml);
const curCore = read(CORE_FILE);
const uiList = JSON.parse(read(UI_FILE));

// ---- take the script out of the HTML (there must be exactly one script tag)
const sOpen = html.indexOf('<script>'), sClose = html.lastIndexOf('</script>');
if (sOpen < 0 || sClose < 0 || html.indexOf('\n<script>', sOpen + 1) !== -1) throw new Error('Expected a single HTML file with exactly one <script> tag.');
const head = html.slice(0, sOpen);
const code = html.slice(sOpen + '<script>'.length, sClose);
const parse = src => acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
const ast = parse(code);

const topNames = body => body.flatMap(n => n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration' ? [n.id.name]
  : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name) : []);
const FOOTER_MARK = '\n/* =========================================================================\n   Headless API';
const footerAt = curCore.indexOf(FOOTER_MARK);
if (footerAt < 0) throw new Error('Could not find the "Headless API" block in core/ore-core.js.');
const CORE_NAMES = new Set(topNames(parse(curCore.slice(0, footerAt)).body));
const UI_NAMES = new Set(uiList.names);
const CORE_FORCE = new Set(uiList.core || []);

const nameOf = n => n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration' ? n.id.name
  : n.type === 'VariableDeclaration' ? n.declarations[0].id.name
  : n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.type === 'Identifier' ? n.expression.left.name : null;
const isIIFE = n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.type === 'FunctionExpression';
// Screen code? Looks for document/window used as variables in the syntax tree (words inside strings or comments don't count — e.g. "window" in an English sentence)
function usesDomNode(node) {
  let hit = false;
  const visit = (n, parent, key) => {
    if (hit || !n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && (n.name === 'document' || n.name === 'window')) {
      const isProp = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed)
        || (parent.type === 'Property' && key === 'key' && !parent.computed));
      if (!isProp) { hit = true; return; }
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => visit(c, n, k)); else if (v && typeof v.type === 'string') visit(v, n, k);
    }
  };
  visit(node, null, null);
  return hit;
}
const usesDom = t => usesDomNode(parse(t));
const isGlobalSetting = n => n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression'
  && n.expression.left.type === 'MemberExpression' && !n.expression.left.computed
  && n.expression.left.object.type === 'Identifier' && n.expression.left.object.name === 'window'
  && !usesDomNode(n.expression.right);

let core = '', prev = 0, side = 'core';
const newNames = [], uiNow = [];
for (const n of ast.body) {
  const lead = code.slice(prev, n.start), text = code.slice(n.start, n.end);
  prev = n.end;
  if (isIIFE(n) && /ORE Sim v1/.test(lead)) {
    const body = n.expression.callee.body.body, fn = n.expression.callee.body;
    const cut = body.findIndex(s => s.type === 'FunctionDeclaration' && s.id.name === 'getResults');
    if (cut < 1) throw new Error('Could not find getResults in the ORE Sim block.');
    const cs = body.slice(0, cut);
    const exp = topNames(cs.filter(s => s.type !== 'VariableDeclaration' || s.kind === 'const'));
    core += lead + `const OreSimCore=(function(){${code.slice(fn.start + 1, cs[cs.length - 1].end)}\nreturn {${exp.join(',')}};\n})();\n`
      + `globalThis.OreSim={molang:OreSimCore.run,build:OreSimCore.build,evalAt:OreSimCore.evalAt,validate:OreSimCore.validate,MM:OreSimCore.MM,zip:OreSimCore.zip};`;
    side = 'ui'; continue;
  }
  if (isIIFE(n) && /ORE Opt v1/.test(lead)) {
    const body = n.expression.callee.body.body, fn = n.expression.callee.body;
    const cut = body.findIndex(s => s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' && s.expression.left.name === 'generateAllParticleJSONs') + 1;
    if (cut < 1) throw new Error('Could not find the generateAllParticleJSONs override in the ORE Opt block.');
    const cs = body.slice(0, cut);
    core += lead + `(function(){${code.slice(fn.start + 1, cs[cs.length - 1].end)}\n})();`;
    side = 'ui'; continue;
  }
  const nm = nameOf(n);
  if (nm && (CORE_NAMES.has(nm) || CORE_FORCE.has(nm))) side = 'core';
  else if (nm && UI_NAMES.has(nm)) side = 'ui';
  else {
    if (usesDomNode(n) && !isGlobalSetting(n)) side = 'ui';
    if (nm && n.type !== 'ExpressionStatement') newNames.push(`${nm} → ${side === 'core' ? 'core' : 'screen (left out)'}`);
  }
  if (side === 'core') core += lead + text;
  else if (n.type !== 'ExpressionStatement') uiNow.push(...topNames([n]));
}

// ---- additions
const notes = [];
core = core.replace(/\bwindow\./g, 'globalThis.');
// Replace the first two lines of the code map (about the single-file app) with the auto-generated notice
const MAP_LINES = /   The whole app is this one file \(HTML \+ CSS \+ JS\)\.[^\n]*\n[^\n]*\n/;
const NOTICE = [
  '   [Auto-generated file] mcp_tool/core/ore-core.js — do not edit by hand.',
  '     The calculation part of html/ore_vfx_editor.html (the web editor), extracted so it runs without a screen:',
  '     formula parser, node definitions, graph → Molang → JSON compiler, simulator (OreSim core), Molang optimizer',
  '     (OreOpt core) and the English text table (ORE_I18N_EN / oreT). After changing the HTML, run `npm run sync`',
  '     in mcp_tool (tools/sync-core.mjs). Added during extraction: window. → globalThis., the OreOpt.maxEstMs',
  '     setting and the headless API (OreCore) at the end. Section numbers refer to the HTML; UI sections are not here.',
].join('\n') + '\n';
if (MAP_LINES.test(core)) core = core.replace(MAP_LINES, NOTICE);
else notes.push('Could not find where to put the auto-generated notice in the code map; skipped (no effect on behavior)');
const optA = 'OPT=globalThis.OreOpt={on:true,level:2};';
const ei = curCore.indexOf('// maxEstMs:'), ej = curCore.indexOf('OPT.maxEstMs=3000;');
if (!core.includes(optA) || !core.includes('est>3000') || ei < 0 || ej < 0) throw new Error('Could not find where to set OreOpt.maxEstMs. Check whether the ORE Opt block changed.');
core = core.replace(optA, optA + '\n' + curCore.slice(ei, ej + 'OPT.maxEstMs=3000;'.length)).replace('est>3000', 'est>OPT.maxEstMs');
const ver = (/<title>[^<]*Release\s+([0-9][0-9.]*)/.exec(head) || [])[1];
let footer = curCore.slice(footerAt);
if (ver) footer = footer.replace(/version: '[^']*'/, `version: '${ver}'`);
core = core.replace(/\s*$/, '\n') + footer.replace(/^\n/, '');

if (usesDom(core)) throw new Error('The core ended up using document/window. Check whether a newly added calculation function uses screen code.');
parse(core);

// ---- node descriptions (palette text) for MCP's ore_list_node_types
// The palette text is Korean source text, so run the new core and translate it with its own table (oreT)
const ctx = vm.createContext({ console, performance, TextEncoder, TextDecoder, Blob, atob, btoa, crypto, URL, structuredClone });
vm.runInContext(core, ctx);
const tr = vm.runInContext('OreCore.translate', ctx);
const desc = {};
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
for (const m of html.matchAll(/data-add="([a-z_0-9]+)"><b>([^<]*)<\/b><span>([^<]*)<\/span>/g)) desc[m[1]] = { name: tr(unesc(m[2])), desc: tr(unesc(m[3])) };
const descJson = JSON.stringify(desc, null, 1) + '\n';

const gone = [...CORE_NAMES].filter(n => !topNames(ast.body).includes(n) && n !== 'OreSimCore');
if (CHECK) {
  const same = core === curCore && fs.existsSync(DESC_FILE) && read(DESC_FILE) === descJson;
  console.log(same ? `core matches the HTML (${ver || '?'}).` : 'core does not match the HTML. Run npm run sync in mcp_tool.');
  process.exit(same ? 0 : 1);
}
console.log(`HTML version ${ver || '(not found in the title)'} · core ${core.length} chars`);
if (newNames.length) console.log('New top-level names:\n  ' + newNames.join('\n  '));
if (gone.length) console.log('Names no longer in core: ' + gone.join(', '));
notes.forEach(n => console.log('Note: ' + n));
if (DRY) { console.log('(--dry: no files changed)'); process.exit(0); }
fs.writeFileSync(CORE_FILE, core);
fs.writeFileSync(DESC_FILE, descJson);
fs.writeFileSync(UI_FILE, JSON.stringify({ ...uiList, names: [...new Set(uiNow)] }, null, 1));
console.log(core === curCore ? 'core unchanged.' : 'core/ore-core.js updated. Run npm test to check results still match the web editor.');
