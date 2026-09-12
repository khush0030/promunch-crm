// Read-only migration evidence. Run with node --env-file=.env.local.
// Never invokes a worker or sends a message. Output excludes customer data.
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const since = new Date(Date.now() - 24 * 3600_000).toISOString();
const [cron, events, oldHost, newHost] = await Promise.all([
  db.rpc('assistant_cron_status'),
  db.from('connector_events').select('connector,event,level,created_at')
    .gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
  fetch('https://promunch-crm.vercel.app/login').then(r => r.status).catch(() => null),
  fetch('https://admin.promunch.in/login').then(r => r.status).catch(() => null),
]);
const grouped = {};
for (const row of events.data ?? []) {
  const key = `${row.connector}:${row.event}:${row.level}`;
  grouped[key] ??= { count: 0, latest: row.created_at };
  grouped[key].count++;
}
const snapshot = {
  checkedAt: new Date().toISOString(), since, oldHost, newHost,
  cronError: cron.error?.code ?? null, jobs: cron.data ?? [],
  eventsError: events.error?.code ?? null, eventsMayBeTruncated: events.data?.length === 1000,
  events: grouped,
  limitations: 'Cron status is the latest scheduler result, not proof of HTTP success. Events are bounded to the latest 1000; inspect provider and HTTP logs before final sign-off.',
};
const output = process.argv[2];
if (output) {
  let history = [];
  try { history = JSON.parse(await readFile(output, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  history.push(snapshot);
  await writeFile(output, JSON.stringify(history, null, 2) + '\n');
}
console.log(JSON.stringify(snapshot, null, 2));
