// Renders report.html -> PROMUNCH-Meta-Ads-Health-Check-2026-10-10.pdf (+ optional PNG previews).
// Usage: node render_pdf.mjs [--png <dir>]
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const here = path.dirname(fileURLToPath(import.meta.url));
const html = pathToFileURL(path.join(here, 'report.html')).href;
const pdf = path.join(here, 'PROMUNCH-Meta-Ads-Health-Check-2026-10-10.pdf');

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.goto(html, { waitUntil: 'networkidle' });
await page.pdf({ path: pdf, format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });

const pngIdx = process.argv.indexOf('--png');
if (pngIdx > -1) {
  const dir = process.argv[pngIdx + 1];
  const pages = await page.$$('section.page');
  for (let i = 0; i < pages.length; i++) {
    await pages[i].screenshot({ path: path.join(dir, `page-${i + 1}.png`) });
  }
}
await browser.close();
console.log('wrote', pdf);
