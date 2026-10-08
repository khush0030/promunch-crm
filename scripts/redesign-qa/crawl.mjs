// Read-only parity crawl. Aborts every non-GET /api request. Usage: node crawl.mjs <port> <width> <routesFile> <outJson> [shotsDir]
import { chromium } from 'playwright';
import fs from 'fs';
const [,, port, width, routesFile, outJson, shots] = process.argv;
const routes = fs.readFileSync(routesFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const { uid, cookies } = JSON.parse(fs.readFileSync(process.env.QA_SESSION || new URL('./session.json', import.meta.url)));
const base = `http://localhost:${port}`;
const w = Number(width);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 } });
await ctx.addCookies(cookies);
await ctx.addInitScript(id => { try { localStorage.setItem('pm_onboarded_' + id, '1'); } catch {} }, uid);
const blocked = [];
await ctx.route('**/*', r => {
  const q = r.request();
  if (q.method() !== 'GET' && q.method() !== 'HEAD' && new URL(q.url()).pathname.startsWith('/api')) { blocked.push(q.method() + ' ' + q.url()); return r.abort(); }
  if (q.method() !== 'GET' && q.method() !== 'HEAD' && !q.url().startsWith(base)) { blocked.push(q.method() + ' ' + q.url()); return r.abort(); }
  return r.continue();
});
const p = await ctx.newPage();
let cur = null;
p.on('pageerror', e => cur && cur.pageErrors.push(e.message.slice(0, 300)));
p.on('console', m => { if (cur && m.type() === 'error') cur.consoleErrors.push(m.text().slice(0, 300)); });
p.on('response', r => { if (!cur) return; const u = new URL(r.url()); if (u.origin === base && u.pathname.startsWith('/api')) cur.api.push({ path: u.pathname + u.search, status: r.status(), method: r.request().method() }); });
p.on('requestfailed', r => { if (!cur) return; const u = new URL(r.url()); if (u.pathname.startsWith('/api') && r.method() === 'GET') cur.api.push({ path: u.pathname + u.search, status: 'FAILED:' + (r.failure()?.errorText || ''), method: 'GET' }); });
const results = [];
for (const route of routes) {
  cur = { route, api: [], pageErrors: [], consoleErrors: [] };
  const t0 = Date.now();
  try {
    const resp = await p.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 180000 });
    cur.httpStatus = resp?.status();
    await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => { cur.networkidleTimeout = true; });
    await p.waitForTimeout(1500);
    cur.finalUrl = p.url().replace(base, '');
    Object.assign(cur, await p.evaluate(() => {
      const t = document.body.innerText;
      const bad = [];
      for (const re of [/\bNaN\b/g, /\bundefined\b/g, /Invalid Date/g, /\[object Object\]/g, /Something went wrong/gi, /Application error/gi, /Unhandled Runtime Error/gi, /\bnull\b/g, /Infinity/g, /404|This page could not be found/g]) {
        const m = t.match(re); if (m) { const i = t.search(re); bad.push(m[0] + ' … ' + t.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ')); }
      }
      const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/dashboard'));
      const cut = [...document.querySelectorAll('button, a, h1, h2, h3, th, td, span, p')].filter(el => {
        const s = getComputedStyle(el); return el.scrollWidth > el.clientWidth + 2 && s.overflow !== 'visible' && s.textOverflow !== 'ellipsis' && el.clientWidth > 0 && el.innerText.trim();
      }).slice(0, 5).map(el => el.tagName + ':' + el.innerText.trim().slice(0, 40));
      return { textLen: t.length, bad, links: [...new Set(links)], hscroll: document.documentElement.scrollWidth - window.innerWidth, clipped: cut, title: (document.querySelector('h1')?.innerText || '').slice(0, 80) };
    }));
    if (shots) await p.screenshot({ path: `${shots}/${route.replace(/[^a-z0-9]+/gi, '_')}-${w}.png`, fullPage: true });
  } catch (e) { cur.error = e.message.slice(0, 200); }
  cur.ms = Date.now() - t0;
  results.push(cur);
  const fails = cur.api.filter(a => typeof a.status !== 'number' || a.status >= 400);
  console.log(`${route} -> ${cur.finalUrl} ${cur.ms}ms api=${cur.api.length} fail=${fails.length} perr=${cur.pageErrors.length} cerr=${cur.consoleErrors.length} bad=${(cur.bad||[]).length} hs=${cur.hscroll}${cur.error ? ' ERR ' + cur.error : ''}`);
  cur = null; fs.writeFileSync(outJson, JSON.stringify({ results, blocked: [...new Set(blocked)] }, null, 1));
}
fs.writeFileSync(outJson, JSON.stringify({ results, blocked: [...new Set(blocked)] }, null, 1));
await b.close();
