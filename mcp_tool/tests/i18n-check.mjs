// English screen check: opens the web editor in English and shows many screens (every node type · advanced settings ·
// export dialog · 3D preview · .mcpack dialog · tab menu · right-click menu · select mode), then lists any Korean left on screen.
// Also checks that switching language with the button keeps the open tabs.
//   node tests/i18n-check.mjs [HTML path] [--list]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const args = process.argv.slice(2);
const HTML = args.find(a => !a.startsWith('--')) || fileURLToPath(new URL('../../html/ore_vfx_editor.html', import.meta.url));
const LIST = args.includes('--list');
const KO = /[\uac00-\ud7a3]/;
const ALLOW = new Set(['\ud55c\uad6d\uc5b4', '\ud55c\uad6d\uc5b4\ub85c \ubcf4\uae30']); // the language button always shows "Korean" in Korean

function open(lang, session = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  // jsdom can't navigate, so location.reload() from the language switch reports "Not implemented: navigation" — not an editor error
  vc.on('jsdomError', e => { const m = String(e && (e.stack || e.message) || e); if (!/Not implemented: navigation/.test(m)) errors.push(m); });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dialogs = [];
  const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
    url: 'https://ore.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      if (lang) w.localStorage.setItem('ore.lang', lang);
      for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => k === 'createImageData' || k === 'getImageData'
        ? (a, b) => ({ data: new Uint8ClampedArray(Math.max(1, (a.width || a) * (b || a.height || 1)) * 4) })
        : k === 'canvas' ? {} : k === 'fillText' ? (s) => dialogs.push(['canvas', s])
        : () => ({ addColorStop() {}, width: 0 }), set: () => true });
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
      w.matchMedia = q => ({ matches: /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.Element.prototype.scrollIntoView = () => {};
      w.alert = m => dialogs.push(['alert', m]); w.confirm = m => { dialogs.push(['confirm', m]); return true; }; w.prompt = m => { dialogs.push(['prompt', m]); return null; };
    },
  });
  // jsdom does not implement location.reload, so calls are only recorded
  return { dom, w: dom.window, errors, dialogs };
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

function leftovers(w) {
  const found = new Map();
  const add = (s, where) => { s = s.replace(/\s+/g, ' ').trim(); if (s && KO.test(s) && !ALLOW.has(s)) found.set(s, where); };
  const tw = w.document.createTreeWalker(w.document.body, w.NodeFilter.SHOW_ELEMENT | w.NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) { const p = n.parentNode; if (p && /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.tagName)) continue; add(n.nodeValue, 'text'); }
    else for (const a of ['title', 'placeholder', 'aria-label']) { const v = n.getAttribute(a); if (v) add(v, '@' + a); }
  }
  for (const el of w.document.querySelectorAll('input')) if (el.value) add(el.value, 'input.value');
  return found;
}

const seen = new Map();
const snap = w => { for (const [k, v] of leftovers(w)) seen.set(k, v); };
async function exercise(w) {
  const d = w.document;
  await tick(100);
  // add every node type
  snap(w);
  // export the clean sample graph first (success path: optimizer summary), then close the dialog
  d.getElementById('btn-export').click(); await tick(); snap(w);
  const close = d.getElementById('em-close'); if (close) close.click();
  for (const el of d.querySelectorAll('[data-add]')) { if (el.dataset.add !== 'emitter') el.click(); }
  await tick(); snap(w);
  // open advanced settings (twice — opening adds rows)
  for (let k = 0; k < 2; k++) {
    for (const el of [...d.querySelectorAll('*')].filter(e => e.children.length === 0 && /Advanced settings|\uc790\uc138\ud788 \uc124\uc815/.test(e.textContent))) el.click();
    await tick();
  }
  // go through every drop-down option to show conditional hints
  for (const sel of [...d.querySelectorAll('#nodes-layer select')]) {
    for (const o of [...sel.options]) { sel.value = o.value; sel.dispatchEvent(new w.Event('change', { bubbles: true })); }
  }
  for (const cb of [...d.querySelectorAll('#nodes-layer input[type=checkbox]')]) { cb.click(); }
  await tick(); snap(w);
  // export dialog · 3D preview · pack dialog · tab menu · right-click menu · select mode · descriptions
  d.getElementById('btn-export').click(); await tick(); snap(w);
  const sim = d.getElementById('btn-sim'); if (sim) sim.click(); await tick(); snap(w);
  const fsel = d.getElementById('s-file'); if (fsel) for (const o of [...fsel.options]) { fsel.value = o.value; fsel.dispatchEvent(new w.Event('change')); await tick(); }
  if (w.OrePackDialog) w.OrePackDialog.open(); await tick(); snap(w);
  const hints = d.getElementById('btn-hints'); if (hints) { hints.click(); await tick(); }
  const tabEl = d.querySelector('#doc-tabs .dt.on'); if (tabEl) { tabEl.click(); await tick(); }
  const cw = d.getElementById('canvas-wrap');
  if (cw) { cw.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 })); await tick(); }
  const selb = d.getElementById('ed-selmode'); if (selb) { selb.click(); await tick(); }
  await tick(800); snap(w); // status bar (updates every 0.7 s)
}

const en = open('en');
await exercise(en.w);
const left = seen;
const dlg = en.dialogs.filter(([, m]) => KO.test(String(m)) && !ALLOW.has(String(m)));
console.log(`English screen: Korean phrases left ${left.size} · Korean dialogs/canvas text ${dlg.length} · page errors ${en.errors.length}`);
if (LIST || left.size) for (const [s, where] of left) console.log('  [' + where + '] ' + s.slice(0, 200));
for (const [k, m] of dlg) console.log('  [' + k + '] ' + String(m).slice(0, 200));
en.errors.slice(0, 5).forEach(e => console.log('  error:', e.slice(0, 300)));

// language switch: add a tab, switch → are the tabs restored?
en.w.OreTabs.newTab(); en.w.document.getElementById('fn-input').value = 'second_tab';
en.w.OreTabs.paint && en.w.OreTabs.paint();
const before = en.w.OreTabs.serialize(x => x).map(t => t.name + ':' + Object.keys(t.nodes).length).join(',');
try { en.w.OreI18n.switchTo('ko'); } catch (e) { /* jsdom: no location.reload */ }
const pending = en.w.sessionStorage.getItem('ore.pendingTabs');
const saved = en.w.localStorage.getItem('ore.lang');
en.w.close();
const ko = open(null, { 'ore.pendingTabs': pending });
ko.w.localStorage.setItem('ore.lang', saved);
await tick(100);
const ko2 = open(saved, { 'ore.pendingTabs': pending });
await tick(100);
const after = ko2.w.OreTabs.serialize(x => x).map(t => t.name + ':' + Object.keys(t.nodes).length).join(',');
const koOk = ko2.w.document.documentElement.lang === 'ko' && KO.test(ko2.w.document.getElementById('btn-export').textContent);
console.log(`Language switch: saved language=${saved} · tabs kept ${before === after ? 'yes' : 'no'} (${after}) · Korean screen ${koOk ? 'yes' : 'no'} · pending data cleared ${ko2.w.sessionStorage.getItem('ore.pendingTabs') === null ? 'yes' : 'no'}`);
ko.w.close(); ko2.w.close();
const checks = { noKoreanLeft: left.size === 0, noKoreanDialogs: dlg.length === 0, noPageErrors: en.errors.length === 0, tabsKept: before === after, koreanScreen: koOk, savedKo: saved === "ko" };
const ok = Object.values(checks).every(Boolean);
if (!ok) console.log("failed:", Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(", "), en.errors.map(e => e.slice(0, 200)));
process.exit(ok ? 0 : 1);
