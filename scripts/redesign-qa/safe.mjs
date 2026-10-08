// SAFE browser for PROMUNCH CRM checks. Import this; never launch your own browser.
// - Blocks EVERY non-GET/HEAD request to ANY origin (API routes, server actions, Supabase REST, Meta, Resend...)
//   and records it in `log.writes` (method, url, body) so you can see what a button WOULD have done.
// - Blocks GETs whose path looks like it triggers work (send/sync/cron/run/scan/trigger/backfill/test/tick/poll).
// - Blocks service workers. Dismisses every native confirm()/alert() (=Cancel).
// Usage: import { openSafe } from './safe.mjs';
//        const { page, log, close } = await openSafe({ port: 3217, width: 1440 });  // 3217 = redesign branch, 3218 = main baseline
import { chromium } from 'playwright';
import fs from 'fs';
const RISKY_GET = /\/api\/[^?]*(\/send\b|sync|cron|\/run\b|scan|trigger|backfill|\/test\b|\btick\b|-tick|\bpoll\b|webhook|resend|dispatch)/i;
// allowReadOnlyPosts: exact pathnames of POST endpoints VERIFIED read-only (e.g. '/api/whatsapp/campaigns/audience-preview').
export async function openSafe({ port = 3217, width = 1440, height, allowReadOnlyPosts = [], allowGetPatterns = [] } = {}) {
  // allowGetPatterns: RegExps for GET paths VERIFIED read-only that RISKY_GET would otherwise block.
  const { uid, cookies } = JSON.parse(fs.readFileSync(process.env.QA_SESSION || new URL('./session.json', import.meta.url)));
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: height ?? (width < 500 ? 844 : 900) }, serviceWorkers: 'block' });
  await ctx.addCookies(cookies);
  await ctx.addInitScript(id => { try { localStorage.setItem('pm_onboarded_' + id, '1'); } catch {} }, uid);
  const log = { writes: [], blockedGets: [], apiErrors: [], pageErrors: [], dialogs: [] };
  await ctx.route('**/*', async r => {
    const q = r.request(); const m = q.method(); const u = q.url();
    if (m === 'POST' && allowReadOnlyPosts.includes(new URL(u).pathname)) { log.allowedPosts = (log.allowedPosts || []).concat(u.replace(base, '')); return r.continue(); }
    if (m !== 'GET' && m !== 'HEAD') { log.writes.push({ method: m, url: u.replace(base, ''), body: (q.postData() || '').slice(0, 400) }); return r.abort('blockedbyclient'); }
    if (RISKY_GET.test(new URL(u).pathname) && !allowGetPatterns.some(re => re.test(new URL(u).pathname))) { log.blockedGets.push(u.replace(base, '')); return r.abort('blockedbyclient'); }
    return r.continue();
  });
  const page = await ctx.newPage();
  page.on('dialog', d => { log.dialogs.push(d.type() + ': ' + d.message().slice(0, 120)); d.dismiss().catch(() => {}); });
  page.on('pageerror', e => log.pageErrors.push(e.message.slice(0, 300)));
  page.on('response', r => { const u = new URL(r.url()); if (u.origin === base && u.pathname.startsWith('/api') && r.status() >= 400) log.apiErrors.push(r.status() + ' ' + u.pathname + u.search); });
  const go = async path => { await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 180000 }); await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {}); await page.waitForTimeout(800); };
  return { browser, ctx, page, log, base, go, close: () => browser.close() };
}
