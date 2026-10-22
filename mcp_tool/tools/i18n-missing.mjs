// Lists Korean text in html/ore_vfx_editor.html that has no English entry in ORE_I18N_EN yet.
//   npm run i18n:missing            → list of missing phrases (exit code 1 if any)
//   npm run i18n:missing -- --json  → the same as a JSON skeleton you can paste into ORE_I18N_EN
// It reads the page markup (text and title/placeholder) and every string, template and '+' chain in the script.
// Values inside templates become {0}, {1}… — keep them in the English text.
// Note: messages built at run time from pieces that contain no Korean themselves are not visible here;
// tests/i18n-check.mjs and tests/i18n-messages.mjs catch those on real screens and messages.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = process.argv.slice(2).find(a => !a.startsWith('--')) || path.resolve(ROOT, '../html/ore_vfx_editor.html');
const html = fs.readFileSync(HTML, 'utf8');
const KO = /[가-힣]/;
const so = html.indexOf('<script>') + 8, sc = html.lastIndexOf('</script>');
const code = html.slice(so, sc);

// The translator from the HTML itself (run its language block in isolation)
const core = fs.readFileSync(path.join(ROOT, 'core/ore-core.js'), 'utf8');
const ctx = vm.createContext({ console, performance, TextEncoder, TextDecoder, Blob, atob, btoa, crypto, URL, structuredClone });
vm.runInContext(core, ctx);
const t = vm.runInContext('OreCore.translate', ctx);
const DICT = vm.runInContext('ORE_I18N_EN', ctx);

const found = new Map(); // phrase -> where
const ent = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const add = (k, where) => { k = ent(k).replace(/\s+/g, ' ').trim(); if (KO.test(k) && !found.has(k)) found.set(k, where); };
function splitHtml(s, where) {
  if (!/<[a-zA-Z\/!]/.test(s)) { add(s, where); return; }
  s = s.replace(/<style[\s\S]*?<\/style>/g, '');
  const tagRe = /<[^<>]*>/g; let last = 0, m;
  while ((m = tagRe.exec(s))) {
    add(s.slice(last, m.index), where);
    for (const a of m[0].matchAll(/\b(title|placeholder|aria-label)\s*=\s*("([^"]*)"|'([^']*)')/g)) add(a[3] ?? a[4], where);
    last = m.index + m[0].length;
  }
  add(s.slice(last), where);
}
splitHtml((html.slice(0, so - 8) + html.slice(sc)).replace(/<head>[\s\S]*?<\/head>/, '').replace(/<!--[\s\S]*?-->/g, ''), 'markup');

const ast = acorn.parse(code, { ecmaVersion: 'latest', locations: true });
const lineBase = html.slice(0, so).split('\n').length - 1;
const at = n => 'line ' + (lineBase + n.loc.start.line);
const tpl = n => n.quasis.map((q, i) => q.value.cooked + (i < n.expressions.length ? '{' + i + '}' : '')).join('');
const skipTpl = new Set();
(function visit(n, parent) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'VariableDeclarator' && n.id && n.id.name === 'ORE_I18N_EN') return; // the table itself
  if (n.type === 'TaggedTemplateExpression') skipTpl.add(n.quasi); // String.raw CSS etc.
  if (n.type === 'Literal' && typeof n.value === 'string' && KO.test(n.value)) splitHtml(n.value, at(n));
  if (n.type === 'TemplateLiteral' && !skipTpl.has(n) && n.quasis.some(q => KO.test(q.value.cooked))) splitHtml(tpl(n), at(n));
  if (n.type === 'BinaryExpression' && n.operator === '+' && !(parent && parent.type === 'BinaryExpression' && parent.operator === '+')) {
    const parts = []; const flat = x => { if (x.type === 'BinaryExpression' && x.operator === '+') { flat(x.left); flat(x.right); } else parts.push(x); };
    flat(n);
    if (parts.some(p => p.type === 'Literal' && typeof p.value === 'string' && KO.test(p.value))) {
      let s = '', k = 0; parts.forEach(p => { s += p.type === 'Literal' && typeof p.value === 'string' ? p.value : '{' + (k++) + '}'; });
      splitHtml(s, at(n));
    }
  }
  for (const key in n) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const v = n[key];
    if (Array.isArray(v)) v.forEach(c => visit(c, n)); else if (v && typeof v.type === 'string') visit(v, n);
  }
})({ type: 'Program', body: ast.body.filter((n, i) => {
  // The language switch deliberately shows Korean labels to English users ("한국어"), so it is not checked
  const lead = code.slice(i ? ast.body[i - 1].end : 0, n.start);
  return !/ORE i18n: language switch/.test(lead);
}) }, null);

// A phrase is covered if it has an entry, or translates fully (e.g. through a pattern or nested entries)
const missing = [...found].filter(([k]) => !(k in DICT) && KO.test(t(k)));
// Partial pieces of a '+' chain often appear on their own too; keep the list short by hiding a piece
// when a longer phrase that contains it is also missing.
const shown = missing.filter(([k]) => !missing.some(([o]) => o !== k && o.includes(k)));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(shown.map(([k]) => [k, ''])), null, 2));
} else {
  console.log(`Korean phrases in the HTML: ${found.size} · without English: ${shown.length}`);
  for (const [k, where] of shown) console.log(`  [${where}] ${k}`);
  if (shown.length) console.log('\nAdd them to ORE_I18N_EN in html/ore_vfx_editor.html ("Korean": "English", same {n} placeholders), then run npm run sync.');
}
process.exit(shown.length ? 1 : 0);
