// Local pipeline test: enqueue one search, run N ticks, print a lead-quality report.
// Run: set -a && source .env.local && set +a && npx tsx scripts/leads-test-tick.ts [ticks]
import { tick } from '../src/lib/leads/engine';
import { supabaseAdmin } from '../src/lib/supabase-admin';

async function main() {
  const rounds = parseInt(process.argv[2] || '4');

  await supabaseAdmin.from('lead_searches').upsert(
    [{ category: 'corporate gifting company', city: 'Mumbai', query: 'corporate gifting company in Mumbai', status: 'pending' }],
    { onConflict: 'category,city', ignoreDuplicates: true },
  );

  for (let i = 1; i <= rounds; i++) {
    const s = await tick();
    console.log(`tick ${i}:`, JSON.stringify(s));
    if (!s.discovered && !s.crawled && !s.drafted && !s.errors.length) break;
  }

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('name, domain, status, city, lead_contacts(email, verify_status, confidence, is_primary, role_hint, kind)')
    .order('created_at', { ascending: true });

  console.log(`\n=== ${leads?.length ?? 0} leads ===`);
  for (const l of leads ?? []) {
    const contacts = (l.lead_contacts as { email: string; verify_status: string; confidence: string; is_primary: boolean }[]) ?? [];
    const c = contacts.find((x) => x.is_primary) ?? contacts[0];
    console.log(
      `${(l.status as string).padEnd(12)} ${(l.name as string).slice(0, 38).padEnd(40)} ${(l.domain ?? '—' as string)?.toString().padEnd(28)} ${
        c ? `${c.email} [${c.verify_status}/${c.confidence}]${contacts.length > 1 ? ` +${contacts.length - 1}` : ''}` : '—'
      }`,
    );
  }

  const byStatus: Record<string, number> = {};
  for (const l of leads ?? []) byStatus[l.status as string] = (byStatus[l.status as string] ?? 0) + 1;
  console.log('\nstatus counts:', byStatus);
}

main().then(() => process.exit(0));
