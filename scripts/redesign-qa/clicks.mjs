// Read-only interaction sweep: clicks safe controls (tabs, filters, toggles of view, drawers) on each page.
// Every non-GET request is aborted in-browser AND logged as a finding (a "safe" click should never write).
import fs from 'fs';
const [,, port, width, routesFile, outJson] = process.argv;
const routes = fs.readFileSync(routesFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const base = `http://localhost:${port}`, w = Number(width);
const DENY = /send|confirm|approve|save|delete|remove|cancel|resolve|take over|hand back|publish|sync|import|export|upload|disconnect|invite|sign ?out|log ?out|replace|add key|\btest\b|retry|scan|pause|switch on|turn on|turn off|activate|schedule|duplicate|merge|rename|resend|\bcall\b|mark|assign|refresh|create|submit|apply|reject|unsubscribe|archive|move|copy|refund|ghost|reply|draft with|generate|\brun\b|start|stop|enable|disable|tour|share|approve|ask maya|new |add |edit|update|reset|clear all|close ticket|done|connect|save|launch|go live|book|pay|order now|use in/i;
import { openSafe } from './safe.mjs';
let cur = null;
const S = await openSafe({ port: Number(port), width: w });
const p = S.page;
// route writes/blocked GETs into the current page record
const _w = S.log.writes, _g = S.log.blockedGets;
p.on('dialog', d => { if (cur) cur.dialogs.push(cur.lastClick + ' => ' + d.message().slice(0, 80)); });
p.on('pageerror', e => cur && cur.pageErrors.push((cur.lastClick || 'load') + ' => ' + e.message.slice(0, 200)));
p.on('response', r => { if (!cur) return; const u = new URL(r.url()); if (u.origin === base && u.pathname.startsWith('/api') && r.status() >= 400) cur.apiFails.push((cur.lastClick || 'load') + ' => ' + r.status() + ' ' + u.pathname + u.search); });
const results = [];
for (const route of routes) {
  _w.length = 0; _g.length = 0;
  cur = { route, clicks: 0, writes: [], dialogs: [], pageErrors: [], apiFails: [], navs: [], skipped: 0, lastClick: '' };
  try {
    await p.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    const seen = new Set();
    for (let i = 0; i < 45; i++) {
      // fresh candidate list each time (DOM changes after clicks)
      const cands = await p.$$eval('main button, main [role=tab], main summary, main a[href^="?"], main a[href*="?tab="], main [role=button], [role=dialog] [role=tab]', els => els.map((el, idx) => {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
        return { idx, txt, vis: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.disabled, type: el.getAttribute('type'), sw: el.getAttribute('role') === 'switch' || el.getAttribute('aria-checked') != null };
      })).catch(() => []);
      const next = cands.find(c => c.vis && c.txt && !c.sw && c.type !== 'submit' && !seen.has(c.txt) && !DENY.test(c.txt));
      if (!next) break;
      seen.add(next.txt);
      cur.lastClick = next.txt; cur.clicks++;
      const before = p.url();
      try {
        const el = (await p.$$('main button, main [role=tab], main summary, main a[href^="?"], main a[href*="?tab="], main [role=button], [role=dialog] [role=tab]'))[next.idx];
        await el.click({ timeout: 4000 });
        await p.waitForTimeout(900);
        await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      } catch (e) { cur.pageErrors.push(next.txt + ' => click failed: ' + e.message.split('\n')[0].slice(0, 100)); }
      const hs = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
      if (hs > 0) cur.pageErrors.push(next.txt + ' => HSCROLL+' + hs);
      if (p.url() !== before) { cur.navs.push(next.txt + ' -> ' + p.url().replace(base, '')); }
      await p.keyboard.press('Escape').catch(() => {});
      if (!p.url().startsWith(base + route.split('#')[0].split('?')[0])) { await p.goto(base + route, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800); }
    }
  } catch (e) { cur.pageErrors.push('ROUTE ERR ' + e.message.slice(0, 150)); }
  cur.writes = _w.map(x => x.method + ' ' + x.url); cur.blockedGets = [..._g];
  results.push(cur);
  console.log(`${route} clicks=${cur.clicks} writes=${cur.writes.length} dialogs=${cur.dialogs.length} perr=${cur.pageErrors.length} apifail=${cur.apiFails.length}`);
  cur = null;
  fs.writeFileSync(outJson, JSON.stringify(results, null, 1));
}
await S.close();
